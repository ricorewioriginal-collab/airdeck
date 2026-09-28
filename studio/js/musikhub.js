// @ts-check
// MusikHub Phase 1: echter, serverseitig gefilterter Katalog mit Sammlungen und
// expliziten Freigaben. Audio-Transfer und Cloud-Sync folgen in eigenen Phasen.
import { formDialog, h, run, status } from './ui.js';

/** @typedef {{api: import('./api.js').Api, stationId: () => string, library: () => any[]}} Ctx */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountMusicHub(root, ctx) {
  let query = '';
  let filter = 'all';
  let page = 0;
  /** @type {any[]} */ let items = [];
  /** @type {any[]} */ let collections = [];
  let total = 0;

  const station = () => ctx.stationId();
  /** @param {string} p */
  const url = (p) => `/music-hub${p}`;

  async function load() {
    const sid = station();
    const [catalog, groups] = await Promise.all([
      ctx.api.get(url(`/items?station=${encodeURIComponent(sid)}&q=${encodeURIComponent(query)}&offset=${page * 50}&limit=50`)),
      ctx.api.get(url(`/collections?station=${encodeURIComponent(sid)}`)),
    ]);
    items = catalog.items;
    total = catalog.total;
    collections = groups;
    render();
  }

  async function register(media) {
    const result = await run(() => ctx.api.post(url('/items'), { stationId: station(), mediaId: media.id }));
    if (!result) return;
    status(`„${media.title}“ im MusikHub katalogisiert`);
    await run(load);
  }

  async function createCollection() {
    const value = await formDialog('Sender-Sammlung anlegen', [{ name: 'name', label: 'Name', required: true }], 'Anlegen');
    if (!value) return;
    const result = await run(() => ctx.api.post(url('/collections'), { owner: { kind: 'station', id: station() }, name: value.name }));
    if (!result) return;
    status(`Sammlung „${result.name}“ angelegt`);
    await run(load);
  }

  async function addToCollection(item) {
    const own = collections.filter((c) => c.owner.kind === 'station' && c.owner.id === station() && c.actions.includes('media.upload'));
    if (!own.length) return status('Lege zuerst eine Sender-Sammlung an.', true);
    const value = await formDialog('Titel in Sammlung aufnehmen', [
      { name: 'collection', label: 'Sammlung', options: own.map((c) => [c.id, c.name]) },
    ], 'Aufnehmen');
    if (!value) return;
    const selected = own.find((c) => c.id === value.collection);
    if (!selected) return;
    const result = await run(() => ctx.api.put(url(`/collections/${encodeURIComponent(selected.id)}/items`), {
      stationId: station(), revision: selected.revision, itemIds: [...new Set([...selected.itemIds, item.id])],
    }));
    if (!result) return;
    status(`„${item.title}“ in „${selected.name}“ aufgenommen`);
    await run(load);
  }

  async function shareCollection(collection) {
    const search = await formDialog('Empfänger suchen', [{ name: 'q', label: 'Nutzer- oder Sendername (mindestens 2 Zeichen)', required: true }], 'Suchen');
    if (!search) return;
    const found = await run(() => ctx.api.get(url(`/recipients?q=${encodeURIComponent(search.q)}`)));
    if (!found) return;
    const options = [...found.users.map((u) => [`user:${u.id}`, `${u.name} (@${u.username})`]), ...found.stations.map((s) => [`station:${s.id}`, `Sender: ${s.name}`])];
    if (!options.length) return status('Kein bestehender Empfänger gefunden.', true);
    const directory = await run(() => ctx.api.get(url('/recipients')));
    if (!directory) return;
    const choice = await formDialog('Katalogfreigabe', [
      { name: 'recipient', label: 'Empfänger', options },
      { name: 'target', label: 'Gültig für Sender', options: directory.stations.map((s) => [s.id, s.name]), hint: 'Freigabe gilt nur in diesem Senderkontext. Neue Mitglieder einer Sender-Sammlung erben sie.' },
    ], 'Freigeben');
    if (!choice) return;
    const [kind, id] = choice.recipient.split(':');
    const target = kind === 'station' ? id : choice.target;
    const result = await run(() => ctx.api.post(url(`/collection/${encodeURIComponent(collection.id)}/grants`), {
      stationId: station(), recipient: { kind, id }, targetStationIds: [target], actions: ['catalog.read'],
    }));
    if (!result) return;
    status(`„${collection.name}“ für den Katalog freigegeben`);
    await run(load);
  }

  async function manageGrants(collection) {
    const grants = await run(() => ctx.api.get(url(`/collection/${encodeURIComponent(collection.id)}/grants?station=${encodeURIComponent(station())}`)));
    if (!grants) return;
    const active = grants.filter((g) => g.revokedAt === null);
    if (!active.length) return status('Diese Sammlung hat keine aktiven Freigaben.');
    const value = await formDialog('Freigabe widerrufen', [{ name: 'grant', label: 'Aktive Freigabe', options: active.map((g) => [g.id, `${g.recipient.kind === 'station' ? 'Sender' : 'Nutzer'} ${g.recipient.id} · ${g.targetStationIds.join(', ')}`]) }], 'Widerrufen');
    if (!value || !confirm('Neue Zugriffe über diese Freigabe sofort beenden? Bereits exportierte Dateien bleiben beim Empfänger.')) return;
    const result = await run(() => ctx.api.del(url(`/grants/${encodeURIComponent(value.grant)}?station=${encodeURIComponent(station())}`)));
    if (result === undefined) return;
    status('Freigabe widerrufen');
    await run(load);
  }

  function render() {
    const sid = station();
    const visible = items.filter((item) => filter === 'all' || filter === 'station' && item.owner.kind === 'station' && item.owner.id === sid || filter === 'shared' && (item.owner.kind !== 'station' || item.owner.id !== sid));
    const ownCollections = collections.filter((c) => c.owner.kind === 'station' && c.owner.id === sid);
    const unregistered = ctx.library().filter((m) => !m.url && !items.some((item) => item.source?.stationId === sid && item.source?.mediaId === m.id));
    const first = total ? page * 50 + 1 : 0;
    const last = Math.min((page + 1) * 50, total);
    root.replaceChildren(
      h('div', { class: 'row mh-toolbar' },
        h('input', { type: 'search', value: query, placeholder: 'Titel oder Interpret suchen', 'aria-label': 'MusikHub durchsuchen', oninput: (e) => { query = /** @type {HTMLInputElement} */ (e.target).value; page = 0; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); void run(load); } } }),
        h('button', { class: 'btn small', onclick: () => run(load) }, 'Suchen / Aktualisieren'),
        h('span', { class: 'muted', role: 'status' }, `${total} sichtbare Titel insgesamt`)),
      h('div', { class: 'row mh-filters' },
        ...[['all', 'Alle'], ['station', 'Senderarchiv'], ['shared', 'Mit mir geteilt']].map(([id, label]) => h('button', { class: `btn small${filter === id ? ' primary' : ''}`, 'aria-pressed': String(filter === id), onclick: () => { filter = id; render(); } }, label))),
      h('div', { class: 'mh-grid' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Sammlungen'), h('button', { class: 'btn small', onclick: createCollection }, '＋ Neu')),
          collections.length ? h('ul', { class: 'plain-list' }, ...collections.map((c) => h('li', { class: 'mh-entry' },
            h('strong', {}, c.name), h('span', { class: 'muted' }, ` · ${c.itemIds.length} Titel`),
            ownCollections.includes(c) && c.actions.includes('shares.manage') ? h('div', { class: 'row mh-actions' },
              h('button', { class: 'btn small', onclick: () => shareCollection(c) }, 'Freigeben'),
              h('button', { class: 'btn small', onclick: () => manageGrants(c) }, 'Freigaben ansehen')) : null))) : h('p', { class: 'muted' }, 'Noch keine sichtbaren Sammlungen.')),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Katalog')),
          h('p', { class: 'muted mh-page-info' }, `Titel ${first}–${last} von ${total} · ${visible.length} auf dieser Seite im gewählten Filter`),
          visible.length ? h('ul', { class: 'plain-list' }, ...visible.map((item) => h('li', { class: 'mh-entry' },
            h('strong', {}, `${item.artist ? item.artist + ' – ' : ''}${item.title}`),
            h('span', { class: 'muted' }, ` · ${item.owner.kind === 'station' ? `Sender ${item.owner.id}` : 'Persönlich'}`),
            item.owner.kind === 'station' && item.owner.id === sid && item.actions.includes('media.upload') ? h('button', { class: 'btn small', onclick: () => addToCollection(item) }, 'In Sammlung') : null))) : h('p', { class: 'muted' }, total ? 'Auf dieser Seite entspricht kein Titel dem gewählten Filter.' : 'Keine freigegebenen Titel gefunden.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', disabled: page === 0, onclick: () => { page--; void run(load); } }, 'Zurück'),
            h('button', { class: 'btn small', disabled: (page + 1) * 50 >= total, onclick: () => { page++; void run(load); } }, 'Weiter')))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Sender-Titel katalogisieren')),
        h('p', { class: 'muted' }, 'Die vorhandene Senderdatei bleibt an ihrem Speicherort. Eine Katalogfreigabe stellt noch keinen Dateiabruf und keine Sendebereitstellung für andere Sender bereit.'),
        unregistered.length ? h('ul', { class: 'plain-list' }, ...unregistered.slice(0, 100).map((m) => h('li', { class: 'mh-entry' }, `${m.artist ? m.artist + ' – ' : ''}${m.title} `, h('button', { class: 'btn small', onclick: () => register(m) }, 'Katalogisieren')))) : h('p', { class: 'muted' }, 'Keine weiteren Titel in der aktuellen Senderbibliothek.')));
  }

  async function show() { await run(load); }
  return { show };
}
