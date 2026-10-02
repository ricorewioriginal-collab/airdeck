// @ts-check
// "Jingles & IDs" - nach der Seite "Jingles, Sender-IDs, Sweeper & Werbung" im AnMaCha Control Center:
// Sendeelemente werden in eigenen Ordnern (= Medienkategorien) verwaltet. Pro Art legt man fest, WANN sie
// laufen: nach jeweils N Songs (Rotation = Kategorien-Takt der Sendeuhr) und/oder zu bestimmten Minuten
// jeder Stunde (Sendeuhr = Uhr-Event mit kind "category"). Nutzt ausschließlich die vorhandene Bibliothek,
// die Sendeuhr-Vorlage (/automation.clock) und die Uhr-Events (/clock-events) - keine zweite Datenhaltung.

import { CATEGORY_STYLE, fmt, h, icon, mediaTitle, run, status } from './ui.js';

const KINDS = /** @type {{ cat: string, label: string, hint: string, mode: 'fx'|'track' }[]} */ ([
  { cat: 'jingle', label: 'Jingles', hint: 'kurze Sender-Jingles zwischen den Titeln', mode: 'fx' },
  { cat: 'sweeper', label: 'Sweeper', hint: 'Übergänge und Stinger über dem Musik-Anfang', mode: 'fx' },
  { cat: 'station_id', label: 'Sender-IDs (Station-ID)', hint: 'Senderkennung, z. B. zur vollen Stunde', mode: 'fx' },
  { cat: 'ad', label: 'Werbung / Spots', hint: 'Werbespots laufen als eigener Titel, nicht über der Musik', mode: 'track' },
  { cat: 'news', label: 'Ansagen & Nachrichten', hint: 'Ansagen, Nachrichten, Wetter als eigener Titel', mode: 'track' },
  { cat: 'drop', label: 'Drops', hint: 'kurze Effekte und Drops über der Musik', mode: 'fx' },
]);

const SLOT_COUNT = 48;

/**
 * Sendeuhr-Takt aus den Einstellungen "alle N Songs" je Kategorie bauen: nach jedem N-ten Musiktitel folgt
 * das Element. Deterministisch, damit die Vorlage in der Planung nachvollziehbar bleibt.
 * @param {Record<string, number>} every  Kategorie → N (0/fehlend = aus)
 */
export function buildSlots(every) {
  /** @type {string[]} */ const slots = [];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    slots.push('music');
    for (const k of KINDS) {
      const n = every[k.cat] ?? 0;
      if (n > 0 && i % n === 0) slots.push(k.cat);
    }
  }
  return slots;
}

/**
 * Umkehrung: aus einer bestehenden Vorlage je Kategorie "alle N Songs" ablesen (Durchschnitt der Musiktitel
 * zwischen zwei Vorkommen); 0 = kommt nicht vor.
 * @param {string[]} slots
 */
export function readEvery(slots) {
  /** @type {Record<string, number>} */ const out = {};
  const music = slots.filter((s) => s === 'music').length;
  for (const k of KINDS) {
    const hits = slots.filter((s) => s === k.cat).length;
    out[k.cat] = hits ? Math.max(1, Math.round(music / hits)) : 0;
  }
  return out;
}

/** @param {string} s */
function parseMinutes(s) {
  return [...new Set(s.split(/[,\s;]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 59))].sort((a, b) => a - b);
}

/**
 * @typedef {{ api: import('./api.js').Api, url: (p: string) => string, library: () => any[], upload: (files: File[], category?: string) => Promise<any[]> }} Ctx
 */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountJingles(root, ctx) {
  /** @type {any} */ let automation = { clock: { slots: [] } };
  /** @type {any[]} */ let events = [];
  /** @type {any[]} */ let items = [];
  /** @type {Record<string, number>} */ let every = {};

  async function load() {
    const [a, p, m] = await Promise.all([
      ctx.api.get(ctx.url('/automation')),
      ctx.api.get(ctx.url('/planning')).catch(() => null),
      ctx.api.get(ctx.url('/media')),
    ]);
    automation = a;
    events = p?.clockEvents ?? [];
    items = m;
    every = readEvery(automation.clock?.slots ?? []);
    render();
  }

  async function saveRotation() {
    await run(async () => {
      automation = await ctx.api.patch(ctx.url('/automation'), { clock: { id: 'custom', name: 'Sendeuhr', slots: buildSlots(every) } });
      status('Rotation gespeichert - Sendeuhr-Takt aktualisiert');
    });
    render();
  }

  /** @param {typeof KINDS[number]} k @param {string} minutesText */
  async function addClockEvent(k, minutesText) {
    const minutes = parseMinutes(minutesText);
    if (!minutes.length) { status('Minute(n) 0–59 angeben, z. B. 0,30', true); return; }
    await run(async () => {
      await ctx.api.post(ctx.url('/clock-events'), { kind: 'category', category: k.cat, mode: k.mode, minutes, hours: [], days: [], label: `${k.label} · Minute ${minutes.join(',')}` });
      status(`${k.label}: Sendeuhr-Eintrag angelegt`);
    });
    await load();
  }

  /** @param {typeof KINDS[number]} k */
  function card(k) {
    const list = items.filter((m) => m.category === k.cat);
    const evs = events.filter((e) => e.kind === 'category' && e.category === k.cat);
    const style = CATEGORY_STYLE[k.cat] ?? { icon: 'music', color: '#38bdf8' };
    const nInput = h('input', { type: 'number', min: '1', max: '50', value: String(every[k.cat] || 4), class: 'jg-num' });
    const onChk = h('input', { type: 'checkbox', checked: (every[k.cat] ?? 0) > 0 });
    const minInput = h('input', { type: 'text', placeholder: '0,30', class: 'jg-min' });
    const fileInput = h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true, onchange: async () => {
      const files = [...(/** @type {HTMLInputElement} */ (fileInput).files ?? [])];
      if (files.length) { await ctx.upload(files, k.cat); await load(); }
    } });
    return h('section', { class: 'panel jg-card', style: `--c:${style.color}` },
      h('div', { class: 'jg-head' },
        h('span', { class: 'jg-ico' }, icon(style.icon, 16)),
        h('strong', {}, k.label), h('span', { class: 'muted' }, ` · ${list.length}`),
        h('span', { class: 'muted jg-hint' }, k.hint),
        h('button', { class: 'btn small primary', onclick: () => fileInput.click() }, '⬆ Hochladen'), fileInput),
      h('div', { class: 'jg-row' },
        h('span', { class: 'jg-lbl' }, '🔁 Rotation: alle'), nInput, h('span', {}, 'Songs'),
        h('label', { class: 'chk' }, onChk, ' an'),
        h('button', { class: 'btn small', onclick: () => { every[k.cat] = /** @type {HTMLInputElement} */ (onChk).checked ? Math.max(1, Number(/** @type {HTMLInputElement} */ (nInput).value) || 4) : 0; saveRotation(); } }, 'Speichern'),
        h('span', { class: 'jg-sep' }),
        h('span', { class: 'jg-lbl' }, '🕒 Sendeuhr: Minute(n)'), minInput,
        h('button', { class: 'btn small', onclick: () => addClockEvent(k, /** @type {HTMLInputElement} */ (minInput).value) }, 'Anlegen')),
      evs.length ? h('div', { class: 'jg-events' }, ...evs.map((e) => h('span', { class: 'pill active' }, `Minute ${e.minutes.join(',')}`,
        h('button', { class: 'jg-x', title: 'Entfernen', onclick: () => run(async () => { await ctx.api.del(ctx.url(`/clock-events/${e.id}`)); await load(); }) }, '✕')))) : null,
      list.length
        ? h('div', { class: 'jg-list' }, ...list.slice(0, 12).map((m) => h('div', { class: 'jg-item' },
            h('span', { class: 'jg-title' }, mediaTitle(m)), h('span', { class: 'muted num' }, fmt(m.durationMs ?? 0)),
            h('button', { class: 'btn small', title: 'Jetzt abspielen', onclick: () => run(async () => { await ctx.api.post(ctx.url(`/quick/${k.cat}`), { mode: k.mode }); status(`${k.label}: gestartet`); }) }, '▶'))),
          list.length > 12 ? h('div', { class: 'muted small' }, `… und ${list.length - 12} weitere - alle unter Tracks (Kategorie ${k.label})`) : null)
        : h('div', { class: 'muted jg-empty' }, 'Noch nichts hochgeladen.'));
  }

  function render() {
    root.replaceChildren(
      h('div', { class: 'listener-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'MUSIK & INHALTE'), h('h1', {}, 'Jingles, Sender-IDs, Sweeper & Werbung'),
          h('p', {}, 'Sendeelemente werden in eigenen Ordnern verwaltet. Pro Art legst du fest, wann sie laufen: nach jeweils N Songs (Rotation) und/oder zu bestimmten Minuten jeder Stunde (Sendeuhr).')),
        h('div', { class: 'listener-hero-actions' }, h('button', { class: 'btn small', onclick: () => run(load) }, '⟳'))),
      h('div', { class: 'jg-grid' }, ...KINDS.map(card)));
  }

  return { show: () => run(load), onEvent: (/** @type {string} */ t) => { if (['library.changed', 'planning.changed', 'automation.state_changed'].includes(t) && !root.hidden) run(load); } };
}
