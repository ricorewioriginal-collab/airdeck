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
  /** @type {any[]} */ let cloudSources = [];
  /** @type {Map<string, any[]>} */ const cloudIndexes = new Map();
  let total = 0;

  const station = () => ctx.stationId();
  /** @param {string} p */
  const url = (p) => `/music-hub${p}`;

  async function load() {
    const sid = station();
    const [catalog, groups, sources] = await Promise.all([
      ctx.api.get(url(`/items?station=${encodeURIComponent(sid)}&q=${encodeURIComponent(query)}&offset=${page * 50}&limit=50`)),
      ctx.api.get(url(`/collections?station=${encodeURIComponent(sid)}`)),
      ctx.api.get(`/stations/${encodeURIComponent(sid)}/music-hub/nextcloud/sources`),
    ]);
    items = catalog.items;
    total = catalog.total;
    collections = groups;
    cloudSources = sources;
    render();
  }

  async function editCloudSource(source = null) {
    const value = await formDialog(source ? 'Nextcloud-Quelle bearbeiten' : 'Nextcloud-Quelle anlegen', [
      { name: 'ownerKind', label: 'Eigentum', options: [['user', 'Persönlich'], ['station', 'Aktueller Sender']], value: source?.owner?.kind || 'user' },
      { name: 'name', label: 'Name', value: source?.name || 'Nextcloud', required: true },
      { name: 'url', label: 'Nextcloud-Adresse', value: source?.url || '', placeholder: 'https://cloud.example.de', required: true },
      { name: 'user', label: 'Nextcloud-Benutzer', value: source?.user || '', required: true },
      { name: 'root', label: 'Startordner', value: source?.root || '/', required: true },
      { name: 'password', label: source?.hasPassword ? 'Neues App-Passwort (leer = behalten)' : 'App-Passwort', type: 'password', value: '' },
      { name: 'allowPrivateNetwork', label: 'Privates/LAN-Netz erlauben (nur Admin)', type: 'checkbox', value: source?.allowPrivateNetwork === true },
    ], 'Speichern');
    if (!value) return;
    const sid = station();
    const body = {
      ownerKind: value.ownerKind,
      name: value.name,
      url: value.url,
      user: value.user,
      root: value.root,
      allowPrivateNetwork: value.allowPrivateNetwork === true,
      ...(value.password ? { password: value.password } : {}),
      ...(source ? { revision: source.revision } : {}),
    };
    const result = await run(() => source
      ? ctx.api.patch(`/stations/${encodeURIComponent(sid)}/music-hub/nextcloud/sources/${encodeURIComponent(source.id)}`, body)
      : ctx.api.post(`/stations/${encodeURIComponent(sid)}/music-hub/nextcloud/sources`, body));
    if (!result) return;
    status(`Cloud-Quelle „${result.name}“ gespeichert`);
    cloudIndexes.delete(result.id);
    await run(load);
  }

  async function scanCloudSource(source) {
    const sid = station();
    const job = await run(() => ctx.api.post(
      `/stations/${encodeURIComponent(sid)}/music-hub/nextcloud/sources/${encodeURIComponent(source.id)}/scan`,
      {},
    ));
    if (!job) return;
    status(`Nextcloud-Scan abgeschlossen: ${job.files} Audiodateien indexiert`);
    cloudIndexes.delete(source.id);
    await run(load);
  }

  async function toggleCloudIndex(source) {
    if (cloudIndexes.has(source.id)) {
      cloudIndexes.delete(source.id);
      render();
      return;
    }
    const sid = station();
    const entries = await run(() => ctx.api.get(
      `/stations/${encodeURIComponent(sid)}/music-hub/nextcloud/sources/${encodeURIComponent(source.id)}/index`,
    ));
    if (!entries) return;
    cloudIndexes.set(source.id, entries);
    render();
  }

  async function retrieveCloudEntry(source, entry) {
    const sid = station();
    const result = await run(() => ctx.api.post(
      `/stations/${encodeURIComponent(sid)}/music-hub/nextcloud/sources/${encodeURIComponent(source.id)}/retrieve`,
      { path: entry.path },
    ));
    if (!result) return;
    status(`„${result.item.title}“ aus Nextcloud in den MusicHub übernommen`);
    await run(load);
  }

  async function deleteCloudSource(source) {
    if (!confirm(`Cloud-Quelle „${source.name}“ wirklich entfernen? Index und gespeichertes App-Passwort werden gelöscht.`)) return;
    const sid = station();
    const result = await run(() => ctx.api.del(
      `/stations/${encodeURIComponent(sid)}/music-hub/nextcloud/sources/${encodeURIComponent(source.id)}`,
    ));
    if (result === undefined) return;
    cloudIndexes.delete(source.id);
    status('Cloud-Quelle entfernt');
    await run(load);
  }

  async function register(media) {
    const result = await run(() => ctx.api.post(url('/items'), { stationId: station(), mediaId: media.id }));
    if (!result) return;
    status(`„${media.title}“ im MusikHub katalogisiert`);
    await run(load);
  }

  async function createCollection() {
    const value = await formDialog('Sammlung anlegen', [
      { name: 'owner', label: 'Eigentum', options: [['station', 'Aktueller Sender'], ['user', 'Persönlich']] },
      { name: 'name', label: 'Name', required: true },
    ], 'Anlegen');
    if (!value) return;
    const me = await run(() => ctx.api.get('/me'));
    if (!me) return;
    if (value.owner === 'user' && !me.user?.id) return status('Persönliche Sammlungen benötigen eine Benutzeranmeldung.', true);
    const owner = value.owner === 'user' ? { kind: 'user', id: me.user.id } : { kind: 'station', id: station() };
    const result = await run(() => ctx.api.post(url('/collections'), { owner, name: value.name }));
    if (!result) return;
    status(`Sammlung „${result.name}“ angelegt`);
    await run(load);
  }

  async function uploadPersonal(file) {
    if (!file) return;
    const result = await run(() => ctx.api.req(
      'PUT',
      url(`/personal?station=${encodeURIComponent(station())}&name=${encodeURIComponent(file.name)}`),
      file,
      { 'Content-Type': file.type || 'application/octet-stream' },
    ));
    if (!result) return;
    status(`„${result.title}“ als persönliche Musik hochgeladen`);
    await run(load);
  }

  async function preview(item) {
    const blob = await run(() => ctx.api.blob(url(`/items/${encodeURIComponent(item.id)}/preview?station=${encodeURIComponent(station())}`)));
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.addEventListener('ended', () => URL.revokeObjectURL(objectUrl), { once: true });
    audio.addEventListener('error', () => URL.revokeObjectURL(objectUrl), { once: true });
    await audio.play().catch(() => {
      URL.revokeObjectURL(objectUrl);
      status('Vorhören konnte vom Browser nicht gestartet werden.', true);
    });
  }

  async function download(item) {
    const blob = await run(() => ctx.api.blob(url(`/items/${encodeURIComponent(item.id)}/download?station=${encodeURIComponent(station())}`)));
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = item.source?.originalName || `${item.artist ? item.artist + ' - ' : ''}${item.title}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function editMetadata(item) {
    const value = await formDialog('MusicHub-Metadaten', [
      { name: 'title', label: 'Titel', value: item.title, required: true },
      { name: 'artist', label: 'Interpret', value: item.artist || '' },
      { name: 'version', label: 'Version / Mix', value: item.version || '', hint: 'z. B. Radio Edit, Instrumental, 2026 Remaster' },
    ], 'Speichern');
    if (!value) return;
    const result = await run(() => ctx.api.patch(
      url(`/items/${encodeURIComponent(item.id)}?station=${encodeURIComponent(station())}`),
      { title: value.title, artist: value.artist, version: value.version, revision: item.revision },
    ));
    if (!result) return;
    status('MusicHub-Metadaten gespeichert');
    await run(load);
  }

  async function showCover(item) {
    const blob = await ctx.api.blob(url(`/items/${encodeURIComponent(item.id)}/cover?station=${encodeURIComponent(station())}`)).catch(() => null);
    if (!blob) return status('Für diesen Titel ist kein eingebettetes Cover verfügbar.', true);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  async function queueForBroadcast(item) {
    const result = await run(() => ctx.api.post(url(`/items/${encodeURIComponent(item.id)}/queue`), { stationId: station() }));
    if (!result) return;
    status(`„${item.title}“ in die Sender-Queue gelegt`);
  }

  async function addToStationPlaylist(item) {
    const sid = station();
    const playlists = await run(() => ctx.api.get(`/stations/${encodeURIComponent(sid)}/playlists`));
    if (!playlists?.length) return status('Lege zuerst eine Sender-Playlist an.', true);
    const value = await formDialog('MusicHub-Titel zur Playlist', [
      { name: 'playlistId', label: 'Playlist', options: playlists.map((/** @type {any} */ pl) => [pl.id, pl.name]) },
    ], 'Hinzufügen');
    if (!value) return;
    const result = await run(() => ctx.api.post(
      url(`/items/${encodeURIComponent(item.id)}/playlists/${encodeURIComponent(value.playlistId)}`),
      { stationId: sid },
    ));
    if (!result) return;
    status(`„${item.title}“ zur Playlist „${result.name}“ hinzugefügt`);
  }

  async function deleteItem(item) {
    if (!confirm(`„${item.title}“ wirklich aus dem MusikHub löschen?`)) return;
    const result = await run(() => ctx.api.del(url(`/items/${encodeURIComponent(item.id)}?station=${encodeURIComponent(station())}`)));
    if (result === undefined) return;
    status('Persönlicher MusikHub-Titel gelöscht');
    await run(load);
  }

  async function addToCollection(item) {
    const own = collections.filter((c) => c.owner.kind === item.owner.kind && c.owner.id === item.owner.id && c.actions.includes('media.upload'));
    if (!own.length) return status('Lege zuerst eine passende Sammlung mit demselben Eigentümer an.', true);
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

  async function shareResource(kind, resource) {
    const search = await formDialog('Empfänger suchen', [{ name: 'q', label: 'Nutzer- oder Sendername (mindestens 2 Zeichen)', required: true }], 'Suchen');
    if (!search) return;
    const found = await run(() => ctx.api.get(url(`/recipients?q=${encodeURIComponent(search.q)}`)));
    if (!found) return;
    const options = [...found.users.map((u) => [`user:${u.id}`, `${u.name} (@${u.username})`]), ...found.stations.map((st) => [`station:${st.id}`, `Sender: ${st.name}`])];
    if (!options.length) return status('Kein bestehender Empfänger gefunden.', true);
    const directory = await run(() => ctx.api.get(url('/recipients')));
    if (!directory) return;
    const choice = await formDialog('MusicHub-Freigabe', [
      { name: 'recipient', label: 'Empfänger', options },
      { name: 'target', label: 'Gültig für Sender', options: directory.stations.map((st) => [st.id, st.name]), hint: 'Jede Freigabe gilt nur im ausgewählten Senderkontext.' },
      { name: 'catalog', label: 'Im Katalog sichtbar', type: 'checkbox', value: true },
      { name: 'preview', label: 'Vorhören erlauben', type: 'checkbox', value: true },
      { name: 'download', label: 'Datei herunterladen erlauben', type: 'checkbox', value: false },
      { name: 'broadcast', label: 'Für Sendung verwenden erlauben', type: 'checkbox', value: false },
      { name: 'export', label: 'Export/Transfer erlauben', type: 'checkbox', value: false },
      { name: 'expires', label: 'Ablauf (optional)', type: 'datetime-local', value: '' },
    ], 'Freigeben');
    if (!choice) return;
    const [recipientKind, id] = choice.recipient.split(':');
    const target = recipientKind === 'station' ? id : choice.target;
    const actions = [];
    if (choice.catalog || choice.preview || choice.download || choice.broadcast || choice.export) actions.push('catalog.read');
    if (choice.preview) actions.push('preview.play');
    if (choice.download) actions.push('file.download');
    if (choice.broadcast) actions.push('broadcast.use');
    if (choice.export) actions.push('transfer.export');
    if (!actions.length) return status('Wähle mindestens ein Freigaberecht.', true);
    const expiresAt = choice.expires ? new Date(choice.expires).getTime() : null;
    const result = await run(() => ctx.api.post(url(`/${kind}/${encodeURIComponent(resource.id)}/grants`), {
      stationId: station(),
      recipient: { kind: recipientKind, id },
      targetStationIds: [target],
      actions: [...new Set(actions)],
      expiresAt,
    }));
    if (!result) return;
    status(`„${resource.name || resource.title}“ freigegeben`);
    await run(load);
  }

  async function manageGrants(kind, resource) {
    const grants = await run(() => ctx.api.get(url(`/${kind}/${encodeURIComponent(resource.id)}/grants?station=${encodeURIComponent(station())}`)));
    if (!grants) return;
    const active = grants.filter((g) => g.revokedAt === null && (g.expiresAt === null || g.expiresAt > Date.now()));
    if (!active.length) return status('Diese Ressource hat keine aktiven Freigaben.');
    const value = await formDialog('Freigabe widerrufen', [{
      name: 'grant',
      label: 'Aktive Freigabe',
      options: active.map((g) => {
        const who = `${g.recipient.kind === 'station' ? 'Sender' : 'Nutzer'} ${g.recipient.id}`;
        const rights = g.actions.join(', ');
        const expiry = g.expiresAt ? ` · bis ${new Date(g.expiresAt).toLocaleString('de-DE')}` : '';
        return [g.id, `${who} · ${rights}${expiry}`];
      }),
    }], 'Widerrufen');
    if (!value || !confirm('Neue Zugriffe über diese Freigabe sofort beenden? Bereits exportierte Dateien bleiben beim Empfänger.')) return;
    const result = await run(() => ctx.api.del(url(`/grants/${encodeURIComponent(value.grant)}?station=${encodeURIComponent(station())}`)));
    if (result === undefined) return;
    status('Freigabe widerrufen');
    await run(load);
  }

  function render() {
    const sid = station();
    const visible = items.filter((item) =>
      filter === 'all'
      || filter === 'station' && item.owner.kind === 'station' && item.owner.id === sid
      || filter === 'personal' && item.owner.kind === 'user' && item.source?.kind === 'personal'
      || filter === 'shared' && !(item.owner.kind === 'station' && item.owner.id === sid) && !item.source
    );
    const unregistered = ctx.library().filter((m) => !m.url && !items.some((item) => item.source?.stationId === sid && item.source?.mediaId === m.id));
    const first = total ? page * 50 + 1 : 0;
    const last = Math.min((page + 1) * 50, total);
    root.replaceChildren(
      h('div', { class: 'row mh-toolbar' },
        h('input', { type: 'search', value: query, placeholder: 'Titel oder Interpret suchen', 'aria-label': 'MusikHub durchsuchen', oninput: (e) => { query = /** @type {HTMLInputElement} */ (e.target).value; page = 0; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); void run(load); } } }),
        h('button', { class: 'btn small', onclick: () => run(load) }, 'Suchen / Aktualisieren'),
        h('span', { class: 'muted', role: 'status' }, `${total} sichtbare Titel insgesamt`)),
      h('div', { class: 'row mh-filters' },
        ...[['all', 'Alle'], ['station', 'Senderarchiv'], ['personal', 'Meine Musik'], ['shared', 'Mit mir geteilt']].map(([id, label]) => h('button', { class: `btn small${filter === id ? ' primary' : ''}`, 'aria-pressed': String(filter === id), onclick: () => { filter = id; render(); } }, label))),
      h('div', { class: 'mh-grid' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Sammlungen'), h('button', { class: 'btn small', onclick: createCollection }, '＋ Neu')),
          collections.length ? h('ul', { class: 'plain-list' }, ...collections.map((c) => h('li', { class: 'mh-entry' },
            h('strong', {}, c.name), h('span', { class: 'muted' }, ` · ${c.itemIds.length} Titel`),
            c.actions.includes('shares.manage') ? h('div', { class: 'row mh-actions' },
              h('button', { class: 'btn small', onclick: () => shareResource('collection', c) }, 'Freigeben'),
              h('button', { class: 'btn small', onclick: () => manageGrants('collection', c) }, 'Freigaben ansehen')) : null))) : h('p', { class: 'muted' }, 'Noch keine sichtbaren Sammlungen.')),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Katalog')),
          h('p', { class: 'muted mh-page-info' }, `Titel ${first}–${last} von ${total} · ${visible.length} auf dieser Seite im gewählten Filter`),
          visible.length ? h('ul', { class: 'plain-list' }, ...visible.map((item) => h('li', { class: 'mh-entry' },
            h('strong', {}, `${item.artist ? item.artist + ' – ' : ''}${item.title}${item.version ? ` [${item.version}]` : ''}`),
            h('span', { class: 'muted' }, ` · ${item.owner.kind === 'station' ? 'Senderarchiv' : 'Persönlich'} · ${item.availability?.state === 'ready' ? 'verfügbar' : 'nicht verfügbar'}`),
            h('div', { class: 'row mh-actions' },
              item.actions.includes('catalog.read') ? h('button', { class: 'btn small', onclick: () => showCover(item) }, 'Cover') : null,
              item.actions.includes('preview.play') ? h('button', { class: 'btn small', onclick: () => preview(item) }, '▶ Vorhören') : null,
              item.actions.includes('file.download') ? h('button', { class: 'btn small', onclick: () => download(item) }, '↓ Download') : null,
              item.actions.includes('broadcast.use') ? h('button', { class: 'btn small primary', onclick: () => queueForBroadcast(item) }, '＋ In Queue') : null,
              item.actions.includes('broadcast.use') ? h('button', { class: 'btn small', onclick: () => addToStationPlaylist(item) }, '＋ Playlist') : null,
              item.actions.includes('metadata.edit') ? h('button', { class: 'btn small', onclick: () => editMetadata(item) }, 'Metadaten') : null,
              item.actions.includes('shares.manage') ? h('button', { class: 'btn small', onclick: () => shareResource('item', item) }, 'Freigeben') : null,
              item.actions.includes('shares.manage') ? h('button', { class: 'btn small', onclick: () => manageGrants('item', item) }, 'Freigaben') : null,
              item.actions.includes('media.upload') ? h('button', { class: 'btn small', onclick: () => addToCollection(item) }, 'In Sammlung') : null,
              item.owner.kind === 'user' && item.source?.kind === 'personal' && item.actions.includes('media.delete')
                ? h('button', { class: 'btn small danger', onclick: () => deleteItem(item) }, 'Löschen') : null
            )))) : h('p', { class: 'muted' }, total ? 'Auf dieser Seite entspricht kein Titel dem gewählten Filter.' : 'Keine freigegebenen Titel gefunden.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', disabled: page === 0, onclick: () => { page--; void run(load); } }, 'Zurück'),
            h('button', { class: 'btn small', disabled: (page + 1) * 50 >= total, onclick: () => { page++; void run(load); } }, 'Weiter')))),
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' },
          h('h2', {}, 'Cloud-Quellen'),
          h('button', { class: 'btn small', onclick: () => editCloudSource() }, '＋ Nextcloud')),
        h('p', { class: 'muted' }, 'MusicHub-Quellen gehören einem Nutzer oder Sender. App-Passwörter werden verschlüsselt gespeichert und nie an das Studio zurückgegeben.'),
        cloudSources.length
          ? h('ul', { class: 'plain-list' }, ...cloudSources.map((source) => {
              const index = cloudIndexes.get(source.id);
              return h('li', { class: 'mh-entry' },
                h('strong', {}, source.name),
                h('span', { class: 'muted' }, ` · ${source.owner.kind === 'station' ? 'Sender' : 'Persönlich'} · ${source.lastScanAt ? `zuletzt ${new Date(source.lastScanAt).toLocaleString('de-DE')}` : 'noch nicht gescannt'}${source.lastError ? ` · Fehler: ${source.lastError}` : ''}`),
                h('div', { class: 'row mh-actions' },
                  h('button', { class: 'btn small primary', onclick: () => scanCloudSource(source) }, 'Scannen'),
                  h('button', { class: 'btn small', onclick: () => toggleCloudIndex(source) }, index ? 'Index schließen' : 'Index ansehen'),
                  h('button', { class: 'btn small', onclick: () => editCloudSource(source) }, 'Bearbeiten'),
                  h('button', { class: 'btn small danger', onclick: () => deleteCloudSource(source) }, 'Löschen')),
                index ? h('ul', { class: 'plain-list' },
                  ...index.slice(0, 50).map((entry) => h('li', { class: 'mh-entry' },
                    h('span', { class: 'muted' }, `${entry.name} · ${Math.round((entry.size || 0) / 1024)} KB`),
                    h('button', { class: 'btn small', onclick: () => retrieveCloudEntry(source, entry) }, 'In MusicHub'))),
                  index.length > 50 ? h('li', { class: 'muted' }, `… ${index.length - 50} weitere`) : null) : null);
            }))
          : h('p', { class: 'muted' }, 'Noch keine MusicHub-Cloudquelle eingerichtet.')),
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', {}, 'Meine persönliche Musik')),
        h('p', { class: 'muted' }, 'Persönliche Uploads liegen getrennt von den Senderbibliotheken. Ohne ausdrückliche Freigabe sieht kein anderer Nutzer diese Titel.'),
        h('input', {
          type: 'file',
          accept: '.mp3,.ogg,.opus,.wav,.flac,.m4a,.aac,.webm,audio/*',
          onchange: (e) => {
            const input = /** @type {HTMLInputElement} */ (e.target);
            const file = input.files?.[0];
            if (file) void uploadPersonal(file);
            input.value = '';
          },
        })),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Sender-Titel katalogisieren')),
        h('p', { class: 'muted' }, 'Die vorhandene Senderdatei bleibt an ihrem Speicherort. Eine Katalogfreigabe stellt noch keinen Dateiabruf und keine Sendebereitstellung für andere Sender bereit.'),
        unregistered.length ? h('ul', { class: 'plain-list' }, ...unregistered.slice(0, 100).map((m) => h('li', { class: 'mh-entry' }, `${m.artist ? m.artist + ' – ' : ''}${m.title} `, h('button', { class: 'btn small', onclick: () => register(m) }, 'Katalogisieren')))) : h('p', { class: 'muted' }, 'Keine weiteren Titel in der aktuellen Senderbibliothek.')));
  }

  async function show() { await run(load); }
  return { show };
}
