// @ts-check
// Playlistverwaltung (Masterprompt V1 Beta, Abschnitt 11-14): eigener Arbeitsbereich - Medienverwaltung
// besitzt die Medien, Playlistverwaltung organisiert sie, Sendeplan plant sie ein, Automation spielt sie
// ab. Nutzt dieselben Server-Endpunkte/dasselbe Datenmodell wie die kompakte Playlist-Liste im Sendeplan
// (keine zweite Playlist-Engine); die Kurzansicht dort bleibt bestehen, weil Playlists von dort direkt in
// den Sendeplan gezogen werden.

import { formDialog, h, mediaTitle, fmt, run, status } from './ui.js';
import { panel, iconBtn } from './planning.js';

/** @typedef {{ api: import('./api.js').Api, url: (p: string) => string, library: () => any[], folders: () => Promise<string[]> }} Ctx */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountPlaylistManagement(root, ctx) {
  /** @type {any[]} */ let playlists = [];
  /** @type {string[]} */ let folders = [];
  /** @type {string|null} */ let openPl = null;
  /** @type {HTMLElement|null} */ let lifehackResult = null;
  /** @type {Set<string>} */ const deleteSelection = new Set();

  async function load() {
    [playlists, folders] = await Promise.all([ctx.api.get(ctx.url('/playlists')), ctx.folders()]);
    render();
  }

  const libMap = () => new Map(ctx.library().map((/** @type {any} */ m) => [m.id, m]));
  const plOptions = () => /** @type {[string,string][]} */ ([['', 'Playlist wählen…'], ...playlists.map((p) => [p.id, p.name])]);

  const move = (/** @type {string[]} */ arr, /** @type {number} */ a, /** @type {number} */ b) => {
    const c = [...arr];
    const [x] = c.splice(a, 1);
    c.splice(b, 0, /** @type {string} */ (x));
    return c;
  };

  const saveItems = (/** @type {any} */ p, /** @type {string[]} */ items) => run(async () => { await ctx.api.patch(ctx.url(`/playlists/${p.id}`), { items }); await load(); });
  const saveMode = (/** @type {any} */ p, /** @type {string} */ mode) => run(async () => { await ctx.api.patch(ctx.url(`/playlists/${p.id}`), { mode }); await load(); });
  const reshuffle = (/** @type {any} */ p) => run(async () => { await ctx.api.post(ctx.url(`/playlists/${p.id}/shuffle`)); status(`„${p.name}“ neu gemischt`); await load(); });

  /** @param {any} p */
  function playlistItemRow(p, /** @type {string[]} */ order, /** @type {Map<string,any>} */ byId, /** @type {string} */ id, /** @type {number} */ i) {
    return h('li', {},
      h('span', {}, mediaTitle(byId.get(id))), h('span', { class: 'muted num' }, fmt(byId.get(id)?.durationMs)),
      h('span', { class: 'act' },
        p.mode === 'shuffle' || i === 0 ? null : iconBtn('Nach oben', '↑', () => saveItems(p, move(p.items, i, i - 1))),
        p.mode === 'shuffle' || i >= order.length - 1 ? null : iconBtn('Nach unten', '↓', () => saveItems(p, move(p.items, i, i + 1))),
        iconBtn('Entfernen', '✕', () => saveItems(p, p.items.filter((/** @type {string} */ x) => x !== id)))));
  }

  /** @param {any} p @param {Map<string,any>} byId */
  function playlistCard(p, byId) {
    const open = openPl === p.id;
    const order = p.mode === 'shuffle' && p.shuffleOrder?.length === p.items.length ? p.shuffleOrder : p.items;
    const totalMs = p.items.reduce((/** @type {number} */ a, /** @type {string} */ id) => a + (byId.get(id)?.durationMs ?? 0), 0);
    const head = h('div', { class: 'pl-head' },
      h('span', { class: 'pl-dot', style: `background:${p.color}` }),
      h('button', { class: 'pl-name', onclick: () => { openPl = open ? null : p.id; render(); } }, `${open ? '▾' : '▸'} ${p.name}`),
      h('span', { class: 'muted' }, `${p.items.length} Titel · ${fmt(totalMs)}`),
      h('select', {
        title: 'Wiedergabe-Modus', value: p.mode ?? 'manual',
        onchange: (/** @type {Event} */ e) => saveMode(p, /** @type {HTMLSelectElement} */ (e.target).value),
      }, h('option', { value: 'manual', selected: (p.mode ?? 'manual') === 'manual' }, 'Manuell'), h('option', { value: 'shuffle', selected: p.mode === 'shuffle' }, 'Shuffle')),
      p.mode === 'shuffle' ? iconBtn('Jetzt neu mischen', '🔀', () => reshuffle(p)) : null,
      h('span', { class: 'act' },
        iconBtn('Abspielen (ersetzt die Queue)', '▶', () => run(async () => { await ctx.api.post(ctx.url(`/playlists/${p.id}/play`)); status(`Playlist „${p.name}“ läuft${p.mode === 'shuffle' ? ' (gemischt)' : ''}`); })),
        iconBtn('Titel hinzufügen', '＋', () => addItems(p)),
        iconBtn('Umbenennen/Farbe', '✎', () => editMeta(p)),
        iconBtn('Duplizieren', '⧉', () => duplicate(p)),
        iconBtn('Löschen', '✕', () => confirm(`Playlist „${p.name}“ löschen?`) && run(async () => { await ctx.api.del(ctx.url(`/playlists/${p.id}`)); await load(); }))));
    const items = open ? h('ol', { class: 'pl-items' }, ...order.map((/** @type {string} */ id, /** @type {number} */ i) => playlistItemRow(p, order, byId, id, i))) : null;
    return h('div', { class: 'pl' }, head, items);
  }

  function render() {
    const byId = new Map(ctx.library().map((/** @type {any} */ m) => [m.id, m]));
    const cards = playlists.length
      ? playlists.map((p) => playlistCard(p, byId))
      : [h('div', { class: 'empty' }, 'Noch keine Playlists. Über „＋ Playlist“ anlegen oder in der Medienverwaltung Titel zu einer Playlist hinzufügen.')];
    const workspace = panel('Playlists', [
      h('button', { class: 'btn small primary', onclick: newPlaylist }, '＋ Playlist'),
    ], h('div', { class: 'playlist-cards' }, ...cards));
    workspace.classList.add('playlist-workspace');
    root.replaceChildren(
      h('div', { class: 'playlist-hero' },
        h('div', {},
          h('span', { class: 'ov-kicker' }, 'PLAYLIST & ROTATION'),
          h('h1', {}, 'Playlistverwaltung'),
          h('p', {}, 'Playlists anlegen, sortieren, mischen und direkt in Queue oder Sendeplan verwenden.')),
        h('div', { class: 'playlist-hero-stats' },
          h('span', {}, `${playlists.length} Playlist${playlists.length === 1 ? '' : 's'}`))),
      workspace,
      lifehacksPanel()
    );
  }

  // ---------- Lifehacks: Funktionen, die der normale Betrieb nicht bietet ----------

  function lifehackBtn(label, fn) {
    return h('button', { class: 'btn small', onclick: () => run(fn) }, label);
  }

  function showResult(node) {
    lifehackResult = h('div', { class: 'lifehack-result' }, node);
    render();
  }

  async function runHealthCheck() {
    const r = await ctx.api.get(ctx.url('/lifehacks/health'));
    const line = (/** @type {string} */ t, /** @type {any[]} */ items, /** @type {(x:any)=>string} */ fmtItem) =>
      h('div', {}, h('strong', {}, `${t} (${items.length})`), items.length ? h('ul', {}, ...items.slice(0, 20).map((x) => h('li', {}, fmtItem(x)))) : h('p', { class: 'muted' }, 'Keine Funde.'));
    showResult(h('div', { class: 'lifehack-health' },
      line('Duplikate', r.duplicates, (/** @type {any} */ d) => `${d.artist} – ${d.title} (${d.ids.length}×)`),
      line('Ohne Metadaten', r.noMetadata, (/** @type {any} */ d) => `${d.artist || '–'} – ${d.title || '–'}: fehlt ${d.missing.join(', ')}`),
      line('Zu kurz (<60 s)', r.tooShort, (/** @type {any} */ d) => `${d.artist} – ${d.title} (${fmt(d.durationMs)})`),
      line('Nicht in einer Playlist', r.unassigned, (/** @type {any} */ d) => `${d.artist} – ${d.title}`)));
  }

  async function calcRuntime() {
    const v = await formDialog('Laufzeit-Kalkulator', [
      { name: 'playlistId', label: 'Playlist', value: '', options: plOptions() },
      { name: 'adBufferPct', label: 'Werbepuffer (%)', type: 'number', value: 0 },
    ], 'Berechnen');
    if (!v || !v.playlistId) return;
    const r = await ctx.api.get(ctx.url(`/lifehacks/runtime/${v.playlistId}?adBufferPct=${Number(v.adBufferPct) || 0}`));
    showResult(h('p', {}, `${r.trackCount} Titel · Gesamtlänge ${fmt(r.totalMs)}${v.adBufferPct ? ` · mit Puffer ${fmt(r.withBufferMs)}` : ''}`));
  }

  async function mergePlaylists() {
    const v = await formDialog('Playlisten zusammenführen', [
      { name: 'targetId', label: 'Ziel (A)', value: '', options: plOptions() },
      { name: 'sourceId', label: 'Quelle (B)', value: '', options: plOptions() },
    ], 'Zusammenführen');
    if (!v || !v.targetId || !v.sourceId) return;
    const r = await ctx.api.post(ctx.url('/lifehacks/merge'), v);
    status(`${r.added} Titel übernommen, ${r.skipped} Duplikate übersprungen`);
    await load();
  }

  async function createTopPlaylist() {
    const v = await formDialog('Top-Tracks → neue Playlist', [
      { name: 'n', label: 'Anzahl Top-Tracks', type: 'number', value: 20 },
      { name: 'hours', label: 'Zeitraum (Stunden)', type: 'number', value: 24 },
      { name: 'name', label: 'Name der neuen Playlist', value: '' },
    ], 'Playlist erstellen');
    if (!v) return;
    const pl = await ctx.api.post(ctx.url('/lifehacks/top-tracks'), v);
    status(`Playlist „${pl.name}“ mit ${pl.items.length} Titeln erstellt`);
    await load();
  }

  async function massTagger() {
    const v = await formDialog('Massen-Tagger', [
      { name: 'playlistId', label: 'Playlist', value: '', options: plOptions() },
      { name: 'tags', label: 'Tags (kommagetrennt)', value: '' },
      { name: 'mode', label: 'Aktion', value: 'add', options: [['add', 'Hinzufügen'], ['remove', 'Entfernen']] },
    ], 'Anwenden');
    if (!v || !v.playlistId || !v.tags) return;
    const tags = v.tags.split(',').map((/** @type {string} */ t) => t.trim()).filter(Boolean);
    const r = await ctx.api.post(ctx.url('/lifehacks/mass-tag'), { playlistId: v.playlistId, tags, mode: v.mode });
    status(`${r.changed} Titel aktualisiert`);
    await load();
  }

  async function analyzePlaylist() {
    const v = await formDialog('Playlist-Analyse', [{ name: 'playlistId', label: 'Playlist', value: '', options: plOptions() }], 'Analysieren');
    if (!v || !v.playlistId) return;
    const r = await ctx.api.get(ctx.url(`/lifehacks/analyze/${v.playlistId}`));
    const list = (/** @type {string} */ label, /** @type {any[]} */ items, /** @type {(x:any)=>string} */ fmtItem) =>
      h('div', {}, h('strong', {}, label), items.length ? h('ul', {}, ...items.map((x) => h('li', {}, fmtItem(x)))) : h('p', { class: 'muted' }, '–'));
    showResult(h('div', { class: 'lifehack-analysis' },
      h('p', {}, `${r.trackCount} Titel · Ø-Länge ${fmt(r.avgDurationMs)}`),
      list('Genre-Mix', r.genreMix, (/** @type {any} */ g) => `${g.genre}: ${g.count}`),
      list('Jahrzehnte', r.decades, (/** @type {any} */ d) => `${d.decade}: ${d.count}`),
      list('Beliebteste Artists', r.topArtists, (/** @type {any} */ a) => `${a.artist}: ${a.count}`)));
  }

  async function trackFinder() {
    const v = await formDialog('Globale Track-Suche', [{ name: 'q', label: 'Artist oder Titel', value: '' }], 'Suchen');
    if (!v || !v.q) return;
    const hits = await ctx.api.get(ctx.url(`/lifehacks/find?q=${encodeURIComponent(v.q)}`));
    showResult(hits.length
      ? h('ul', {}, ...hits.map((/** @type {any} */ x) => h('li', {}, `${mediaTitle(x.media)} — in: ${x.playlists.map((/** @type {any} */ p) => p.name).join(', ') || '(keiner Playlist zugewiesen)'}`)))
      : h('p', { class: 'muted' }, 'Kein Treffer.'));
  }

  async function batchFillYear() {
    const v = await formDialog('Erscheinungsjahr Batch-Füllen', [
      { name: 'playlistId', label: 'Playlist', value: '', options: plOptions() },
      { name: 'year', label: 'Jahr', type: 'number', value: new Date().getFullYear() },
    ], 'Jahr eintragen');
    if (!v || !v.playlistId || !v.year) return;
    const r = await ctx.api.post(ctx.url('/lifehacks/fill-year'), v);
    status(`${r.filled} Titel gefüllt, ${r.skipped} hatten bereits ein Jahr`);
    await load();
  }

  async function comparePlaylists() {
    const v = await formDialog('Playlist-Vergleich', [
      { name: 'a', label: 'Playlist A', value: '', options: plOptions() },
      { name: 'b', label: 'Playlist B', value: '', options: plOptions() },
    ], 'Vergleichen');
    if (!v || !v.a || !v.b) return;
    const r = await ctx.api.get(ctx.url(`/lifehacks/compare?a=${v.a}&b=${v.b}`));
    showResult(h('div', {},
      h('div', {}, h('strong', {}, `Nur in A (${r.onlyA.length})`), r.onlyA.length ? h('ul', {}, ...r.onlyA.map((/** @type {any} */ m) => h('li', {}, mediaTitle(m)))) : h('p', { class: 'muted' }, '–')),
      h('div', {}, h('strong', {}, `Nur in B (${r.onlyB.length})`), r.onlyB.length ? h('ul', {}, ...r.onlyB.map((/** @type {any} */ m) => h('li', {}, mediaTitle(m)))) : h('p', { class: 'muted' }, '–'))));
  }

  function toggleDeleteSel(/** @type {string} */ id) {
    if (deleteSelection.has(id)) deleteSelection.delete(id); else deleteSelection.add(id);
    render();
  }

  async function deleteSelectedPlaylists() {
    if (!deleteSelection.size) return;
    if (!confirm(`${deleteSelection.size} Playlist(en) dauerhaft löschen? Titel bleiben in der Bibliothek erhalten.`)) return;
    const r = await ctx.api.post(ctx.url('/lifehacks/delete-many'), { ids: [...deleteSelection] });
    deleteSelection.clear();
    status(`${r.deleted.length} Playlist(en) gelöscht`);
    await load();
  }

  function deletePlaylistsSection() {
    return h('div', { class: 'lifehack-card' },
      h('h4', {}, 'Playlisten löschen'),
      h('p', { class: 'muted' }, 'Titel bleiben in der Bibliothek erhalten.'),
      h('div', { class: 'lifehack-delete-list' }, ...playlists.map((p) =>
        h('label', {}, h('input', { type: 'checkbox', checked: deleteSelection.has(p.id), onchange: () => toggleDeleteSel(p.id) }), ` ${p.name}`))),
      h('button', { class: 'btn small danger', onclick: deleteSelectedPlaylists }, 'Ausgewählte löschen'));
  }

  function lifehacksPanel() {
    const grid = h('div', { class: 'lifehack-grid' },
      lifehackBtn('🩺 Gesundheitscheck', runHealthCheck),
      lifehackBtn('⏱ Laufzeit-Kalkulator', calcRuntime),
      lifehackBtn('🔀 Zusammenführen', mergePlaylists),
      lifehackBtn('🏆 Top-Tracks → Playlist', createTopPlaylist),
      lifehackBtn('🏷 Massen-Tagger', massTagger),
      lifehackBtn('📊 Playlist-Analyse', analyzePlaylist),
      lifehackBtn('🔎 Globale Track-Suche', trackFinder),
      lifehackBtn('📅 Jahr Batch-Füllen', batchFillYear),
      lifehackBtn('🔁 Playlist-Vergleich', comparePlaylists));
    return panel('Lifehacks ✨', [], h('div', {},
      h('p', { class: 'muted' }, 'Funktionen, die die normale Playlistverwaltung nicht bietet.'),
      grid,
      lifehackResult,
      deletePlaylistsSection()));
  }

  async function newPlaylist() {
    const v = await formDialog('Neue Playlist', [
      { name: 'name', label: 'Name', value: '', required: true },
      { name: 'color', label: 'Farbe', type: 'color', value: '#19c3e6' },
    ]);
    if (v) await run(async () => { await ctx.api.post(ctx.url('/playlists'), v); await load(); });
  }

  /** @param {any} p */
  async function editMeta(p) {
    const v = await formDialog('Playlist bearbeiten', [
      { name: 'name', label: 'Name', value: p.name, required: true },
      { name: 'color', label: 'Farbe', type: 'color', value: p.color },
    ]);
    if (v) await run(async () => { await ctx.api.patch(ctx.url(`/playlists/${p.id}`), v); await load(); });
  }

  /** @param {any} p */
  async function duplicate(p) {
    await run(async () => { await ctx.api.post(ctx.url('/playlists'), { name: `${p.name} (Kopie)`, color: p.color, items: p.items }); await load(); });
  }

  /** @param {any} p */
  async function addItems(p) {
    const lib = [...ctx.library()].sort((a, b) => mediaTitle(a).localeCompare(mediaTitle(b), 'de'));
    const v = await formDialog(`Zu „${p.name}“ hinzufügen`, [
      { name: 'folder', label: 'Ganzen Ordner hinzufügen', value: '', options: [['', '– kein Ordner –'], ...folders.map((f) => /** @type {[string,string]} */ ([f, f]))] },
      { name: 'mediaId', label: 'oder einzelnen Titel', value: '', options: [['', '–'], ...lib.map((/** @type {any} */ m) => /** @type {[string,string]} */ ([m.id, mediaTitle(m)]))] },
    ], 'Hinzufügen');
    if (!v) return;
    const add = v.folder ? lib.filter((/** @type {any} */ m) => (m.folder ?? '') === v.folder).map((/** @type {any} */ m) => m.id) : v.mediaId ? [v.mediaId] : [];
    if (add.length) await saveItems(p, [...p.items, ...add]);
  }

  return { show: () => run(load), onEvent: (/** @type {string} */ t) => { if (['playlists.changed', 'library.changed'].includes(t) && root.isConnected && !root.hidden) run(load); } };
}
