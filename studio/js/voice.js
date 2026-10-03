// @ts-check
// Voice Studio: Sprachaufnahmen und Jingles schneiden und aufbereiten. Wellenform mit Auswahl, Herausschneiden /
// Nur behalten, Stille entfernen, Rauschentfernung, EQ, Kompressor, Gate, Lautstärke, Fades. Gerechnet wird auf dem
// Server (ffmpeg); Vorhören rendert eine Vorschau, Speichern legt einen neuen Titel an (das Original bleibt).
// Musikbett: das fertige Ergebnis im KI-Studio unter „Spot-Werkstatt“ über ein Bett legen.

import { fmt, h, icon, run, status } from './ui.js';
import { openMic } from './audio.js';

const CATEGORIES = /** @type {[string, string][]} */ ([
  ['voice_track', 'Voice Track'], ['jingle', 'Jingle'], ['ad', 'Werbung'], ['news', 'Ansage / News'], ['sweeper', 'Sweeper'],
  ['station_id', 'Station-ID'], ['drop', 'Drop'], ['tts', 'TTS'],
]);

/**
 * Eingabe der Bearbeitungen in die Server-Angabe umwandeln (Schnitte in Dateizeit).
 * @param {{ type: 'cut'|'keep', fromMs: number, toMs: number }[]} edits
 * @returns {{ keep: { fromMs: number, toMs: number }|null, cuts: { fromMs: number, toMs: number }[] }}
 */
export function editsToSpec(edits) {
  /** @type {{ fromMs: number, toMs: number }|null} */
  let keep = null;
  for (const e of edits) {
    if (e.type !== 'keep') continue;
    // mehrere „Nur behalten“ ergeben den Schnitt der Bereiche
    keep = keep ? { fromMs: Math.max(keep.fromMs, e.fromMs), toMs: Math.min(keep.toMs, e.toMs) } : { fromMs: e.fromMs, toMs: e.toMs };
  }
  return { keep, cuts: edits.filter((e) => e.type === 'cut').map((e) => ({ fromMs: e.fromMs, toMs: e.toMs })) };
}

/** @param {number} ms */
const fmtMs = (ms) => `${fmt(ms)}.${String(Math.round(ms % 1000)).padStart(3, '0').slice(0, 1)}`;

/**
 * @typedef {{ api: import('./api.js').Api, url: (p: string) => string, library: () => any[], mediaUrl: (id: string) => string, upload: (files: File[], category?: string) => Promise<any[]> }} Ctx
 */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountVoice(root, ctx) {
  /** @type {any} */ let media = null;
  /** @type {number[]} */ let peaks = [];
  let durationMs = 0;
  /** @type {{ type: 'cut'|'keep', fromMs: number, toMs: number }[]} */ let edits = [];
  /** @type {{ fromMs: number, toMs: number }|null} */ let sel = null;
  let playheadMs = 0;
  /** @type {HTMLAudioElement|null} */ let original = null;
  /** @type {HTMLAudioElement|null} */ let result = null;
  /** @type {MediaRecorder|null} */ let rec = null;
  /** @type {BlobPart[]} */ let recChunks = [];

  const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'vs-wave', width: '1200', height: '160' }));
  const selInfo = h('span', { class: 'muted' }, 'Keine Auswahl – in der Wellenform ziehen');
  const editList = h('div', { class: 'vs-edits' });
  const source = /** @type {HTMLSelectElement} */ (h('select', {}));
  const title = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Titel des Ergebnisses' }));
  const category = /** @type {HTMLSelectElement} */ (h('select', {}, ...CATEGORIES.map(([v, l]) => h('option', { value: v }, l))));
  const recBtn = h('button', { class: 'btn', onclick: () => void toggleRecord() }, icon('record', 14), ' Aufnehmen');
  const info = h('div', { class: 'muted' }, 'Titel wählen oder aufnehmen.');

  const opt = (/** @type {string[][]} */ list) => list.map(([v, l]) => h('option', { value: v }, l));
  const denoise = /** @type {HTMLSelectElement} */ (h('select', {}, ...opt([['off', 'aus'], ['light', 'leicht'], ['strong', 'stark (Brummen + Rauschen)']])));
  const eq = /** @type {HTMLSelectElement} */ (h('select', {}, ...opt([['off', 'aus'], ['voice', 'Sprache klarer'], ['warm', 'Warm'], ['bright', 'Hell'], ['phone', 'Telefon']])));
  const comp = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
  const gate = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
  const strip = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
  const norm = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
  const gain = /** @type {HTMLInputElement} */ (h('input', { type: 'range', min: '-12', max: '12', step: '0.5', value: '0' }));
  const gainVal = h('span', { class: 'muted' }, '0 dB');
  gain.addEventListener('input', () => (gainVal.textContent = `${Number(gain.value) > 0 ? '+' : ''}${gain.value} dB`));
  const fadeIn = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '0', max: '30000', step: '50', value: '0' }));
  const fadeOut = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '0', max: '30000', step: '50', value: '0' }));

  function spec() {
    return {
      ...editsToSpec(edits),
      stripSilence: strip.checked, denoise: denoise.value, eq: eq.value, compressor: comp.checked, gate: gate.checked,
      gainDb: Number(gain.value), normalize: norm.checked, fadeInMs: Number(fadeIn.value) || 0, fadeOutMs: Number(fadeOut.value) || 0,
    };
  }

  // ---------- Wellenform ----------
  const xOf = (/** @type {number} */ ms) => (durationMs ? (ms / durationMs) * canvas.width : 0);
  const msOf = (/** @type {number} */ x) => Math.max(0, Math.min(durationMs, (x / canvas.width) * durationMs));

  function draw() {
    const g = canvas.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue('--accent').trim() || '#19c3e6';
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(255,255,255,.04)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!peaks.length) return;
    const w = canvas.width / peaks.length;
    g.fillStyle = accent;
    peaks.forEach((p, i) => {
      const hgt = Math.max(1, (p / 100) * canvas.height * 0.95);
      g.fillRect(i * w, (canvas.height - hgt) / 2, Math.max(1, w - 0.6), hgt);
    });
    // Schnitte rot, „Nur behalten“ hebt den Rest ab
    for (const e of edits) {
      g.fillStyle = e.type === 'cut' ? 'rgba(255,70,70,.35)' : 'rgba(0,0,0,.45)';
      if (e.type === 'cut') g.fillRect(xOf(e.fromMs), 0, xOf(e.toMs) - xOf(e.fromMs), canvas.height);
      else {
        g.fillRect(0, 0, xOf(e.fromMs), canvas.height);
        g.fillRect(xOf(e.toMs), 0, canvas.width - xOf(e.toMs), canvas.height);
      }
    }
    if (sel) {
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.fillRect(xOf(sel.fromMs), 0, xOf(sel.toMs) - xOf(sel.fromMs), canvas.height);
      g.strokeStyle = '#fff';
      g.strokeRect(xOf(sel.fromMs) + 0.5, 0.5, xOf(sel.toMs) - xOf(sel.fromMs), canvas.height - 1);
    }
    g.fillStyle = '#fff';
    g.fillRect(xOf(playheadMs) - 1, 0, 2, canvas.height);
  }

  /** @type {number|null} */ let dragStart = null;
  const posMs = (/** @type {PointerEvent} */ e) => msOf(((e.clientX - canvas.getBoundingClientRect().left) / canvas.getBoundingClientRect().width) * canvas.width);
  canvas.addEventListener('pointerdown', (e) => {
    if (!durationMs) return;
    canvas.setPointerCapture(e.pointerId);
    dragStart = posMs(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragStart === null) return;
    const now = posMs(e);
    if (Math.abs(now - dragStart) > durationMs / 400) {
      sel = { fromMs: Math.min(dragStart, now), toMs: Math.max(dragStart, now) };
      updateSel();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragStart === null) return;
    const now = posMs(e);
    if (!sel || Math.abs(now - dragStart) <= durationMs / 400) {
      // Klick ohne Ziehen: Abspielposition setzen
      sel = null;
      playheadMs = now;
      if (original) original.currentTime = now / 1000;
      updateSel();
    }
    dragStart = null;
  });

  function updateSel() {
    selInfo.textContent = sel ? `Auswahl ${fmtMs(sel.fromMs)} – ${fmtMs(sel.toMs)} (${((sel.toMs - sel.fromMs) / 1000).toFixed(1)} s)` : 'Keine Auswahl – in der Wellenform ziehen';
    for (const b of root.querySelectorAll('[data-needs-sel]')) /** @type {HTMLButtonElement} */ (b).disabled = !sel;
    draw();
  }

  function renderEdits() {
    editList.replaceChildren(...edits.map((e, i) => h('span', { class: 'tag' },
      `${e.type === 'cut' ? 'Schnitt' : 'Behalten'} ${fmtMs(e.fromMs)}–${fmtMs(e.toMs)} `,
      h('button', { title: 'Entfernen', onclick: () => { edits.splice(i, 1); renderEdits(); draw(); } }, '✕'))));
    if (!edits.length) editList.replaceChildren(h('span', { class: 'muted' }, 'Noch keine Schnitte.'));
  }

  // ---------- Quelle ----------
  function fillSources(/** @type {string} */ select = '') {
    const files = ctx.library().filter((m) => !m.url);
    source.replaceChildren(h('option', { value: '' }, '– Titel wählen –'), ...files.map((m) => h('option', { value: m.id }, `${m.artist ? m.artist + ' – ' : ''}${m.title}`)));
    source.value = select;
  }

  async function choose(/** @type {string} */ id) {
    original?.pause();
    result?.pause();
    media = ctx.library().find((m) => m.id === id) ?? null;
    edits = [];
    sel = null;
    peaks = [];
    playheadMs = 0;
    renderEdits();
    updateSel();
    if (!media) return void (info.textContent = 'Titel wählen oder aufnehmen.');
    title.value = `${media.title} (bearbeitet)`;
    category.value = CATEGORIES.some(([v]) => v === media.category) ? media.category : 'voice_track';
    original = new Audio(ctx.mediaUrl(id));
    original.addEventListener('timeupdate', () => {
      playheadMs = (original?.currentTime ?? 0) * 1000;
      if (stopAt != null && playheadMs >= stopAt) { original?.pause(); stopAt = null; }
      draw();
    });
    original.addEventListener('loadedmetadata', () => { if (!durationMs && original) { durationMs = original.duration * 1000; draw(); } });
    durationMs = media.durationMs ?? 0;
    info.textContent = 'Wellenform wird berechnet …';
    const r = await run(() => ctx.api.get(ctx.url(`/media/${encodeURIComponent(id)}/waveform`)));
    peaks = r?.peaks ?? [];
    info.textContent = peaks.length ? `${media.title} · ${fmt(durationMs)}` : 'Keine Wellenform verfügbar (ffmpeg nötig).';
    draw();
  }
  /** @type {number|null} */ let stopAt = null;

  // ---------- Aufnahme ----------
  async function toggleRecord() {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await openMic();
      recChunks = [];
      const mr = new MediaRecorder(stream);
      rec = mr;
      mr.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        rec = null;
        recBtn.replaceChildren(icon('record', 14), ' Aufnehmen');
        const type = mr.mimeType || 'audio/webm';
        const file = new File([new Blob(recChunks, { type })], `aufnahme-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'}`, { type });
        const [item] = (await run(() => ctx.upload([file], 'voice_track'))) ?? [];
        if (item) { await refresh(item.id); status('Aufnahme gespeichert und geladen'); }
      };
      mr.start();
      recBtn.replaceChildren(icon('stop', 14), ' Aufnahme beenden');
    } catch (e) {
      status(`Mikrofon nicht verfügbar: ${e instanceof Error ? e.message : e}`, true);
    }
  }

  // ---------- Aktionen ----------
  function addEdit(/** @type {'cut'|'keep'} */ type) {
    if (!sel) return;
    edits.push({ type, fromMs: Math.round(sel.fromMs), toMs: Math.round(sel.toMs) });
    sel = null;
    renderEdits();
    updateSel();
  }

  function playSelection() {
    if (!original || !sel) return;
    original.currentTime = sel.fromMs / 1000;
    stopAt = sel.toMs;
    void original.play();
  }

  async function previewResult() {
    if (!media) return status('Zuerst einen Titel wählen', true);
    original?.pause();
    info.textContent = 'Vorschau wird gerechnet …';
    const blob = await run(() => ctx.api.blobPost(ctx.url(`/media/${encodeURIComponent(media.id)}/voice-edit`), { ...spec(), preview: true }));
    info.textContent = media.title;
    if (!blob) return;
    result?.pause();
    result = new Audio(URL.createObjectURL(blob));
    void result.play();
  }

  async function save() {
    if (!media) return status('Zuerst einen Titel wählen', true);
    const item = await run(() => ctx.api.post(ctx.url(`/media/${encodeURIComponent(media.id)}/voice-edit`), { ...spec(), title: title.value.trim(), category: category.value }));
    if (!item) return;
    status(`„${item.title}“ in der Bibliothek gespeichert (${fmt(item.durationMs)})`);
    await refresh(item.id);
  }

  async function refresh(/** @type {string} */ select = '') {
    const lib = await run(() => ctx.api.get(ctx.url('/media')));
    if (lib) { ctx.library().splice(0, ctx.library().length, ...lib); }
    fillSources(select);
    if (select) await choose(select);
  }

  source.addEventListener('change', () => void choose(source.value));

  const row = (/** @type {string} */ label, /** @type {Node[]} */ ...c) => h('label', { class: 'vs-row' }, h('span', { class: 'muted' }, label), ...c);

  root.replaceChildren(
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Voice Studio')),
      h('p', { class: 'muted' }, 'Sprachaufnahmen und Jingles schneiden und aufbereiten. Das Original bleibt erhalten, das Ergebnis wird ein neuer Titel.'),
      h('div', { class: 'row-btns' }, source, recBtn),
      info, canvas,
      h('div', { class: 'row-btns' },
        selInfo,
        h('button', { class: 'btn small', 'data-needs-sel': '', disabled: true, onclick: playSelection }, icon('play', 12), ' Auswahl hören'),
        h('button', { class: 'btn small danger', 'data-needs-sel': '', disabled: true, onclick: () => addEdit('cut') }, 'Herausschneiden'),
        h('button', { class: 'btn small', 'data-needs-sel': '', disabled: true, onclick: () => addEdit('keep') }, 'Nur behalten'),
        h('button', { class: 'btn small', onclick: () => { original?.paused === false ? original.pause() : void original?.play(); } }, 'Original ▶/⏸')),
      h('div', { class: 'row-btns' }, editList,
        h('button', { class: 'btn small', onclick: () => { edits.pop(); renderEdits(); draw(); } }, 'Rückgängig'),
        h('button', { class: 'btn small', onclick: () => { edits = []; renderEdits(); draw(); } }, 'Alle zurücksetzen'))),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Aufbereitung')),
      h('div', { class: 'vs-grid' },
        row('Rauschentfernung', denoise), row('EQ', eq),
        row('Kompressor (gleichmäßiger)', comp), row('Gate (Grundrauschen in Pausen)', gate),
        row('Lange Pausen entfernen', strip), row('Normalisieren (−16 LUFS)', norm),
        row('Lautstärke', gain, gainVal), row('Einblenden (ms)', fadeIn), row('Ausblenden (ms)', fadeOut))),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Ergebnis')),
      h('div', { class: 'row-btns' }, title, category),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn', onclick: () => void previewResult() }, icon('headphones', 14), ' Ergebnis vorhören'),
        h('button', { class: 'btn primary', onclick: () => void save() }, 'Als neuen Titel speichern')),
      h('p', { class: 'muted' }, 'Musikbett: das gespeicherte Ergebnis im KI-Studio unter „Spot-Werkstatt“ über ein Bett legen (mit automatischem Absenken unter der Stimme).')),
  );
  renderEdits();
  fillSources();
  draw();
  return { show: () => void refresh(media?.id ?? '') };
}
