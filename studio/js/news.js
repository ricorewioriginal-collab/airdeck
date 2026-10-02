// @ts-check
// "Nachrichten & Wetter" - nach news-center.js im AnMaCha Control Center: laut.fm erzeugt stündlich drei
// Beiträge (Kombi, Nachrichten, Wetter). Hier: Zugang anzeigen/wählen, aktuelle Dateien anhören, herunterladen,
// sofort senden und per Stunden-Chip-Raster in der Sendeuhr einplanen (Uhr-Event kind "news").

import { h, run, status } from './ui.js';

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ICON = /** @type {Record<number,string>} */ ({ 1: '📰☁️', 2: '📰', 3: '☁️' });
const NAMES = /** @type {Record<number,string>} */ ({ 1: 'Nachrichten + Wetter (Kombi)', 2: 'Nachrichten', 3: 'Wetter' });
const DAY_HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

/** @param {number} t */
const hhmm = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
/** @param {number} t */
const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : `vor ${Math.floor(m / 60)} Std. ${m % 60} Min.`; };

/** Stundenliste lesbar: [6..21] → "6–21 Uhr", [] → "jede Stunde" @param {number[]} hs */
export function hoursStr(hs) {
  if (!hs.length || hs.length === 24) return 'jede Stunde';
  /** @type {string[]} */ const runs = [];
  let a = hs[0], b = hs[0];
  for (let i = 1; i <= hs.length; i++) {
    if (hs[i] === b + 1) { b = hs[i]; continue; }
    runs.push(a === b ? `${a} Uhr` : `${a}–${b} Uhr`);
    a = hs[i]; b = hs[i];
  }
  return runs.join(', ');
}

/** @param {number[]} ds  0 = Montag … 6 = Sonntag */
export function daysStr(ds) {
  return !ds.length || ds.length === 7 ? 'täglich' : ds.map((d) => DAYS[d]).join(' ');
}

/** @param {string} s */
export function parseMinutes(s) {
  return [...new Set(s.split(/[,\s;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 59))].sort((a, b) => a - b);
}

/**
 * @typedef {{ api: import('./api.js').Api, url: (p: string) => string }} Ctx
 */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountNews(root, ctx) {
  /** @type {any} */ let S = null;
  /** @type {any[]} */ let sched = [];
  const picked = { hours: new Set(DAY_HOURS), days: new Set([0, 1, 2, 3, 4, 5, 6]) };
  const form = { kind: 2, minutes: '0', mode: 'track', label: '' };
  /** @type {string} */ let audioUrl = '';

  async function load() {
    const [s, p] = await Promise.all([ctx.api.get(ctx.url('/news')).catch(() => null), ctx.api.get(ctx.url('/planning')).catch(() => null)]);
    S = s;
    sched = (p?.clockEvents ?? []).filter((/** @type {any} */ e) => e.kind === 'news');
    render();
  }

  function credsLine() {
    if (!S) return h('span', { class: 'nw-bad' }, 'Nicht erreichbar');
    if (!S.creds?.ok) return h('span', {}, h('span', { class: 'nw-bad' }, 'Kein laut.fm-Zugang. '), h('span', { class: 'muted' }, 'Lege unter „Verbreitung“ den laut.fm-Live-Stream (Sendername + Live-Passwort) als Ausgang an – daraus holt sich AnMaCha Cast die Beiträge.'));
    return h('span', {}, h('span', { class: 'nw-ok' }, '● Zugang vorhanden'), ' – Sender ', h('b', {}, S.creds.station), h('span', { class: 'muted' }, ` (Ausgang „${S.creds.outputName}“)`));
  }

  /** @param {number} id */
  async function play(id) {
    await run(async () => {
      const res = await fetch(`${ctx.api.base}/api/v1${ctx.url(`/news/${id}/file`)}?token=${encodeURIComponent(ctx.api.token)}`);
      if (!res.ok) { let m = `Fehler ${res.status}`; try { m = (await res.json()).message || m; } catch { /* kein JSON */ } throw new Error(m); }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(await res.blob());
      const box = root.querySelector('#nw-audio');
      if (box) box.replaceChildren(h('div', { class: 'muted small' }, `${ICON[id]} ${NAMES[id]}`), h('audio', { controls: true, autoplay: true, src: audioUrl }));
    });
  }

  /** @param {number} id */
  async function download(id) {
    await run(async () => {
      const res = await fetch(`${ctx.api.base}/api/v1${ctx.url(`/news/${id}/file`)}?dl=1&token=${encodeURIComponent(ctx.api.token)}`);
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      const u = URL.createObjectURL(await res.blob());
      const a = h('a', { href: u, download: (res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]) ?? `news-${id}.mp3` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 8000);
      status('Download gestartet');
    });
  }

  function fileRows() {
    const ok = !!S?.creds?.ok;
    return (S?.files ?? [1, 2, 3].map((id) => ({ id, have: false }))).map((/** @type {any} */ f) => h('div', { class: 'nw-row' },
      h('div', { class: 'nw-file' }, h('b', {}, `${ICON[f.id]} ${NAMES[f.id]}`), h('br'),
        f.have
          ? h('span', { class: 'muted small' }, `Stand ${hhmm(f.changedAt)} Uhr · geprüft ${ago(f.t)}`, f.err ? h('span', { class: 'nw-bad' }, ` (${f.err})`) : null)
          : h('span', { class: 'muted small' }, f.err ? h('span', { class: 'nw-bad' }, f.err) : 'noch nicht geladen')),
      h('div', { class: 'nw-actions' },
        h('button', { class: 'btn small', disabled: !ok, onclick: () => play(f.id) }, '▶ Anhören'),
        h('button', { class: 'btn small', disabled: !ok, onclick: () => download(f.id) }, '⬇ Herunterladen'),
        h('button', { class: 'btn small', disabled: !ok, title: 'Jetzt frisch bei laut.fm abrufen', onclick: () => run(async () => { await ctx.api.post(ctx.url(`/news/${f.id}/fetch`), {}); status('Aktuell'); await load(); }) }, '⟳'),
        h('button', { class: 'btn small primary', disabled: !ok, title: 'Jetzt auf Sendung – nach dem laufenden Titel', onclick: () => run(async () => { await ctx.api.post(ctx.url(`/news/${f.id}/air`), { mode: 'track' }); status(`${NAMES[f.id]}: läuft nach dem aktuellen Titel`); }) }, '📡 Jetzt senden'))));
  }

  /** @param {Set<number>} set @param {[number,string][]} list */
  function chips(set, list) {
    return list.map(([v, l]) => h('span', { class: `nw-chip${set.has(v) ? ' on' : ''}`, onclick: () => { set.has(v) ? set.delete(v) : set.add(v); render(); } }, l));
  }

  /** @param {{ newsId: number, minutes: number[], label?: string }[]} jobs */
  async function addJobs(jobs) {
    if (!picked.hours.size) { status('Bitte Stunden wählen', true); return; }
    const hours = [...picked.hours].sort((a, b) => a - b);
    const days = picked.days.size === 7 ? [] : [...picked.days].sort((a, b) => a - b);
    const sig = (/** @type {any} */ x) => [x.newsId, (x.minutes ?? []).join(), (x.hours ?? []).join(), (x.days ?? []).join(), x.mode].join('|');
    const have = new Set(sched.map(sig));
    const fresh = jobs.map((j) => ({ kind: 'news', newsId: j.newsId, minutes: j.minutes, hours: hours.length === 24 ? [] : hours, days, mode: form.mode, label: j.label || form.label || NAMES[j.newsId] })).filter((j) => !have.has(sig(j)));
    if (!fresh.length) { status('Diesen Zeitplan gibt es schon'); return; }
    await run(async () => {
      for (const j of fresh) await ctx.api.post(ctx.url('/clock-events'), j);
      status(fresh.length > 1 ? `${fresh.length} Einträge angelegt` : 'Zeitplan angelegt');
    });
    await load();
  }

  function planRows() {
    if (!sched.length) return [h('div', { class: 'muted small' }, 'Noch nichts geplant.')];
    return sched.map((e) => h('div', { class: 'nw-row' },
      h('div', { class: 'nw-file' }, h('b', {}, `${ICON[e.newsId] ?? '📰'} ${e.label || NAMES[e.newsId]}`), h('br'),
        h('span', { class: 'muted small' }, `:${e.minutes.map((/** @type {number} */ m) => String(m).padStart(2, '0')).join(' :')} · ${hoursStr(e.hours)} · ${daysStr(e.days)}${e.mode === 'track' ? ' · nach dem Titel' : ' · sofort (Crossfade)'}`)),
      h('div', { class: 'nw-actions' },
        h('button', { class: 'btn small', onclick: () => run(async () => { await ctx.api.patch(ctx.url(`/clock-events/${e.id}`), { ...e, enabled: e.enabled === false }); await load(); }) }, e.enabled === false ? '⏸ aus' : '✔ an'),
        h('button', { class: 'btn small', title: 'Jetzt testen', onclick: () => run(async () => { await ctx.api.post(ctx.url(`/clock-events/${e.id}/fire`), {}); status('Ausgelöst'); }) }, '▶'),
        h('button', { class: 'btn small danger', onclick: () => { if (confirm('Eintrag löschen?')) run(async () => { await ctx.api.del(ctx.url(`/clock-events/${e.id}`)); await load(); }); } }, '🗑'))));
  }

  function render() {
    const hs = /** @type {[number,string][]} */ (Array.from({ length: 24 }, (_, i) => [i, String(i).padStart(2, '0')]));
    const ds = /** @type {[number,string][]} */ (DAYS.map((d, i) => [i, d]));
    const sources = S?.sources ?? [];
    const kindSel = h('select', { onchange: (/** @type {Event} */ ev) => { form.kind = Number(/** @type {HTMLSelectElement} */ (ev.target).value); } },
      ...[2, 3, 1].map((id) => h('option', { value: String(id), selected: form.kind === id }, NAMES[id])));
    const minInput = h('input', { type: 'text', value: form.minutes, class: 'nw-min', title: 'z. B. 0 oder 0,30', oninput: (/** @type {Event} */ ev) => { form.minutes = /** @type {HTMLInputElement} */ (ev.target).value; } });
    const modeSel = h('select', { onchange: (/** @type {Event} */ ev) => { form.mode = /** @type {HTMLSelectElement} */ (ev.target).value; } },
      h('option', { value: 'track', selected: form.mode === 'track' }, 'nach dem laufenden Titel'), h('option', { value: 'now', selected: form.mode === 'now' }, 'sofort (Crossfade)'));
    const labelInput = h('input', { type: 'text', value: form.label, placeholder: 'Bezeichnung (optional)', class: 'nw-label', oninput: (/** @type {Event} */ ev) => { form.label = /** @type {HTMLInputElement} */ (ev.target).value; } });
    root.replaceChildren(
      h('div', { class: 'listener-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'PROGRAMM PLANEN'), h('h1', {}, 'Nachrichten & Wetter'),
          h('p', {}, 'laut.fm erzeugt die Beiträge stündlich neu – Update immer 10 Minuten vor der vollen Stunde. Hier liegt immer die aktuellste Datei bereit, auch wenn gerade keine Sendung läuft.')),
        h('div', { class: 'listener-hero-actions' }, h('button', { class: 'btn small', onclick: () => run(load) }, '⟳'))),
      h('section', { class: 'panel nw-card' },
        h('h3', {}, '📰 Zugang (laut.fm)'),
        h('div', {}, credsLine()),
        h('div', { class: 'muted small nw-note' }, `Nächstes Update bei laut.fm: ${S ? hhmm(S.nextUpdate) : '–'} Uhr. Lizenz: nur zur Verbreitung über laut.fm – Datei und Zugangsdaten nicht weitergeben.`),
        sources.length > 1 ? h('div', { class: 'nw-row' }, h('span', { class: 'muted' }, 'Quelle der Zugangsdaten:'),
          h('select', { onchange: (/** @type {Event} */ ev) => run(async () => { await ctx.api.patch(ctx.url('/news'), { outputId: /** @type {HTMLSelectElement} */ (ev.target).value }); status('Quelle gespeichert'); await load(); }) },
            h('option', { value: '', selected: !S.selected }, 'Automatisch (erster laut.fm-Ausgang)'),
            ...sources.map((/** @type {any} */ s) => h('option', { value: s.outputId, selected: S.selected === s.outputId }, `${s.station} – ${s.name}`)))) : null),
      h('section', { class: 'panel nw-card' }, h('h3', {}, 'Aktuelle Dateien'), ...fileRows(), h('div', { id: 'nw-audio' })),
      h('section', { class: 'panel nw-card' },
        h('h3', {}, 'Automatisch senden – nach Uhrzeit planen'),
        h('div', { class: 'muted small nw-note' }, 'Legt einen Eintrag in der Sendeuhr an. Der laufende Titel wird nie unterbrochen: Die Nachrichten starten erst, wenn er zu Ende ist (mit deiner Überblendzeit). Die Datei wird zur Startzeit frisch geholt.'),
        h('div', { class: 'nw-row nw-form' }, h('span', { class: 'muted' }, 'Inhalt'), kindSel, h('span', { class: 'muted' }, 'Minute(n)'), minInput, h('span', { class: 'muted' }, 'Ablauf'), modeSel),
        h('div', { class: 'nw-chips' }, h('span', { class: 'muted' }, 'Stunden'), ...chips(picked.hours, hs),
          h('button', { class: 'btn small', onclick: () => { picked.hours = new Set(hs.map((x) => x[0])); render(); } }, 'alle'),
          h('button', { class: 'btn small', onclick: () => { picked.hours = new Set(DAY_HOURS); render(); } }, '6–22'),
          h('button', { class: 'btn small', onclick: () => { picked.hours = new Set(); render(); } }, 'keine')),
        h('div', { class: 'nw-chips' }, h('span', { class: 'muted' }, 'Tage'), ...chips(picked.days, ds)),
        h('div', { class: 'nw-row nw-form' }, labelInput,
          h('button', { class: 'btn small primary', onclick: () => { const m = parseMinutes(form.minutes); if (!m.length) { status('Bitte mindestens eine Minute (0–59) angeben', true); return; } addJobs([{ newsId: form.kind, minutes: m }]); } }, '＋ Zeitplan anlegen'),
          h('span', { class: 'muted' }, 'Schnell:'),
          h('button', { class: 'btn small', onclick: () => addJobs([{ newsId: 2, minutes: [0], label: 'Nachrichten' }]) }, 'Nachrichten stündlich :00'),
          h('button', { class: 'btn small', onclick: () => addJobs([{ newsId: 2, minutes: [0], label: 'Nachrichten' }, { newsId: 3, minutes: [30], label: 'Wetter' }]) }, 'Nachrichten :00 + Wetter :30'),
          h('button', { class: 'btn small', onclick: () => addJobs([{ newsId: 1, minutes: [0], label: 'Nachrichten + Wetter' }]) }, 'Kombi zu jeder vollen Stunde'))),
      h('section', { class: 'panel nw-card' }, h('h3', {}, 'Geplant'), ...planRows()));
  }

  return { show: () => run(load), onEvent: (/** @type {string} */ t) => { if (['planning.changed', 'stream.state_changed', 'playout_started', 'playout_stopped'].includes(t) && !root.hidden && !root.querySelector('#nw-audio audio')) run(load); } };
}
