// @ts-check
// MusikHub Phase 1+2+3(Beginn)+4(Bereitstellung)+5(lautCast-Upload): echter, serverseitig gefilterter
// Katalog mit Sammlungen, expliziten Freigaben, eigenem privaten Audio-Upload mit getrenntem
// Vorhören/Download-Recht sowie einer eigenen Nextcloud-Quelle je Nutzerkonto (Ordneransicht +
// Einzeldatei-Übernahme, kein rekursiver Vollscan, kein Job-/Sync-System). "Für Sender bereitstellen"
// kopiert einen eigenen privaten Upload kontrolliert in das Archiv des aktuell gewählten Senders
// (stage-Endpunkt) - macht ihn danach laut Sendefähigkeits-Preflight sendefähig. "An laut.fm übertragen"
// lädt einen Titel über den verifiziert nicht deprecateten laut.fm-Upload-Endpunkt hoch (Zwei-Treffer-
// Wiederverwendung, ehrliches "in Bearbeitung" statt erfundenem Erfolg) und kann ihn optional an eine
// laut.fm-Playlist-ID anhängen. Kein Wiring in Queue/Planung/Cardwall; dafür bietet diese Ansicht
// weiterhin bewusst keine Buttons an.
import { formDialog, h, run, status } from './ui.js';

/** @typedef {{api: import('./api.js').Api, stationId: () => string, library: () => any[], me: () => any}} Ctx */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountMusicHub(root, ctx) {
  let query = '';
  let filter = 'all';
  let page = 0;
  /** @type {any[]} */ let items = [];
  /** @type {any[]} */ let collections = [];
  let total = 0;
  /** @type {{usedBytes: number, quotaBytes: number} | null} */ let quota = null;
  /** @type {any} */ let ncSource = null;
  /** @type {{path: string, entries: any[]} | null} */ let ncBrowse = null;
  /** @type {any[]} */ let transfers = [];

  const station = () => ctx.stationId();
  const myId = () => ctx.me()?.user?.id ?? null;
  /** @param {string} p */
  const url = (p) => `/music-hub${p}`;
  /** @param {number} bytes */
  const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

  async function load() {
    const sid = station();
    const loggedIn = !!myId();
    const [catalog, groups, quotaResult, ncResult, transfersResult] = await Promise.all([
      ctx.api.get(url(`/items?station=${encodeURIComponent(sid)}&q=${encodeURIComponent(query)}&offset=${page * 50}&limit=50`)),
      ctx.api.get(url(`/collections?station=${encodeURIComponent(sid)}`)),
      loggedIn ? ctx.api.get(url('/uploads/quota')).catch(() => null) : Promise.resolve(null),
      loggedIn ? ctx.api.get(url('/nextcloud')).catch(() => null) : Promise.resolve(null),
      loggedIn ? ctx.api.get(url('/transfers')).catch(() => []) : Promise.resolve([]),
    ]);
    items = catalog.items;
    total = catalog.total;
    collections = groups;
    quota = quotaResult;
    ncSource = ncResult;
    transfers = transfersResult ?? [];
    render();
  }

  async function setupNextcloud() {
    const value = await formDialog('Eigene Nextcloud-Quelle einrichten', [
      { name: 'url', label: 'Nextcloud-Adresse (https://…)', required: true },
      { name: 'user', label: 'Benutzername', required: true },
      { name: 'password', label: 'App-Passwort', type: 'password', hint: 'Nextcloud → Einstellungen → Sicherheit → App-Passwort erzeugen. Wird verschlüsselt gespeichert.', required: !ncSource?.hasPassword },
      { name: 'root', label: 'Startordner', value: ncSource?.root ?? '/' },
    ], 'Speichern');
    if (!value) return;
    const result = await run(() => ctx.api.put(url('/nextcloud'), value));
    if (!result) return;
    status('Eigene Nextcloud-Quelle gespeichert');
    ncBrowse = null;
    await run(load);
  }

  async function removeNextcloud() {
    if (!confirm('Eigene Nextcloud-Verbindung entfernen? Bereits übernommene Titel in „Mein Archiv“ bleiben erhalten.')) return;
    const result = await run(() => ctx.api.put(url('/nextcloud'), { remove: true }));
    if (!result) return;
    status('Nextcloud-Quelle entfernt');
    ncBrowse = null;
    await run(load);
  }

  /** @param {string} path */
  async function browseNextcloud(path) {
    const result = await run(() => ctx.api.get(url(`/nextcloud/list?path=${encodeURIComponent(path)}`)));
    if (!result) return;
    ncBrowse = result;
    render();
  }

  /** @param {string} path @param {string} name */
  async function importFromNextcloud(path, name) {
    status(`„${name}“ wird aus der Cloud übernommen …`);
    const result = await run(() => ctx.api.post(url('/nextcloud/import'), { paths: [path] }));
    if (!result) return;
    if (result.imported.length) { status(`„${name}“ zu „Mein Archiv“ hinzugefügt`); filter = 'mine'; }
    else status(result.errors[0] ?? `„${name}“ konnte nicht übernommen werden`, true);
    await run(load);
  }

  /** Rekursiver Ordner-Import (begrenzt, siehe Server) - für gelegentliche Bestandsübernahme, nicht als
   * dauerhafte Synchronisation gedacht. @param {string} path */
  async function importFolderFromNextcloud(path) {
    status(`Ordner „${path}“ wird durchsucht und übernommen …`);
    const result = await run(() => ctx.api.post(url('/nextcloud/import-folder'), { path }));
    if (!result) return;
    const parts = [];
    if (result.imported.length) parts.push(`${result.imported.length} übernommen`);
    if (result.skipped) parts.push(`${result.skipped} bereits vorhanden`);
    if (result.errors.length) parts.push(`${result.errors.length} fehlgeschlagen`);
    status(parts.length ? parts.join(', ') : 'Keine Audiodateien gefunden', !result.imported.length && !!result.errors.length);
    if (result.imported.length) filter = 'mine';
    await run(load);
  }

  async function register(media) {
    const result = await run(() => ctx.api.post(url('/items'), { stationId: station(), mediaId: media.id }));
    if (!result) return;
    status(`„${media.title}“ im MusikHub katalogisiert`);
    await run(load);
  }

  /** Persönlicher Upload: landet nie in einem Senderarchiv, geschlossener Standardzugriff bis der Eigentümer selbst freigibt. @param {File} file */
  async function uploadPrivate(file) {
    // Client-seitiger Vorabhinweis spart eine aussichtslose Übertragung; die maßgebliche Prüfung
    // bleibt serverseitig (registerUpload()), da quota hier veraltet sein kann.
    if (quota && quota.usedBytes + file.size > quota.quotaBytes) {
      return status(`„${file.name}“ überschreitet das verbleibende Speicherkontingent (${mb(Math.max(0, quota.quotaBytes - quota.usedBytes))} übrig von ${mb(quota.quotaBytes)}).`, true);
    }
    status(`„${file.name}“ wird hochgeladen …`);
    const result = await run(() => ctx.api.put(`${url('/uploads')}?name=${encodeURIComponent(file.name)}`, file));
    if (!result) return;
    status(`„${result.title}“ zu „Mein Archiv“ hinzugefügt`);
    filter = 'mine';
    await run(load);
  }

  /** Neue Version einer bestehenden privaten Upload-Datei: Item-ID, Sammlungsmitgliedschaften und
   * Freigaben bleiben erhalten, nur die Quelldatei wird ausgetauscht. @param {any} item @param {File} file */
  async function replaceUpload(item, file) {
    if (quota && quota.usedBytes - (item.source?.sizeBytes ?? 0) + file.size > quota.quotaBytes) {
      return status(`„${file.name}“ überschreitet das verbleibende Speicherkontingent nach dem Ersetzen.`, true);
    }
    status(`„${item.title}“ wird ersetzt …`);
    const result = await run(() => ctx.api.put(`${url(`/items/${encodeURIComponent(item.id)}/replace`)}?station=${encodeURIComponent(station())}&name=${encodeURIComponent(file.name)}`, file));
    if (!result) return;
    status(`„${item.title}“ auf Version ${result.version} aktualisiert`);
    await run(load);
  }

  /** Kontrolliertes Kopieren eines eigenen privaten Uploads in das Archiv des aktuell gewählten Senders -
   * erst danach ist der Titel laut Sendefähigkeits-Preflight für diesen Sender sendefähig. Der ursprüngliche
   * private Upload bleibt davon unverändert bestehen (physische Kopie, kein Verschieben). @param {any} item */
  async function stageItem(item) {
    const sid = station();
    if (!confirm(`„${item.title}“ in das Archiv von Sender „${sid}“ kopieren? Der private Originaltitel bleibt dabei unverändert erhalten.`)) return;
    status(`„${item.title}“ wird für Sender „${sid}“ bereitgestellt …`);
    const result = await run(() => ctx.api.post(url(`/items/${encodeURIComponent(item.id)}/stage`), { station: sid }));
    if (!result) return;
    status(`„${item.title}“ im Archiv von Sender „${sid}“ bereitgestellt und sendefähig`);
    await run(load);
  }

  /** Tatsächlicher Upload eines Hub-Titels zu laut.fm (Zwei-Treffer-Modell: eine bereits erfolgreich
   * zugeordnete laut.fm-Track-ID wird serverseitig wiederverwendet statt erneut hochgeladen). Optional
   * wird der Titel danach an eine laut.fm-Playlist-ID angehängt (Radioadmin-Playlist-ID, nicht das
   * AnMaCha Cast-eigene Playlistmodell) - ein leeres Feld überträgt nur, ohne Playlist-Zuordnung. Die
   * Playlist-ID wird bewusst per einfacher Eingabe statt eines vorausgefüllten Dropdowns abgefragt -
   * eine echte Playlist-Auswahl lässt sich über die bestehende laut.fm-Radioadmin-Ansicht (Reiter
   * „Playlists") nachschlagen. @param {any} item */
  async function lautcastTransfer(item) {
    const sid = station();
    const input = prompt(`laut.fm-Playlist-ID für „${item.title}“ (leer lassen für reine Übertragung ohne Playlist):`, '');
    if (input === null) return;
    const playlistId = input.trim() ? Number(input.trim()) : undefined;
    if (playlistId !== undefined && (!Number.isInteger(playlistId) || playlistId <= 0)) return status('Ungültige Playlist-ID.', true);
    status(`„${item.title}“ wird an laut.fm übertragen …`);
    const result = await run(() => ctx.api.post(url(`/items/${encodeURIComponent(item.id)}/lautcast-transfer`), { station: sid, playlistId }));
    if (!result) return;
    /** @type {Record<string, string>} */
    const reasons = {
      lautcast_not_connected: 'Sender ist nicht mit laut.fm verbunden.',
      missing: 'Datei nicht mehr vorhanden.',
      unsupported_format: 'Dateiformat wird nicht unterstützt.',
      upload_failed: 'laut.fm hat den Upload abgelehnt.',
      processing: 'laut.fm verarbeitet den Upload noch - in Kürze erneut versuchen.',
    };
    if (!result.ok) return status(reasons[result.reason] ?? `Übertragung fehlgeschlagen (${result.reason})`, true);
    if (playlistId === undefined) return status(`„${item.title}“ an laut.fm übertragen (Track-ID ${result.trackId})`);
    if (result.playlistOk) return status(`„${item.title}“ an laut.fm übertragen und zur Playlist ${playlistId} hinzugefügt (Track-ID ${result.trackId})`);
    status(`„${item.title}“ an laut.fm übertragen (Track-ID ${result.trackId}), aber Playlist-Zuordnung fehlgeschlagen`, true);
  }

  /** @param {any} item */
  async function deleteItem(item) {
    if (!confirm(`„${item.title}“ endgültig aus dem MusikHub entfernen? Freigaben und Sammlungseinträge gehen dabei ebenfalls verloren.`)) return;
    const result = await run(() => ctx.api.del(`${url(`/items/${encodeURIComponent(item.id)}`)}?station=${encodeURIComponent(station())}`));
    if (result === undefined) return;
    status(`„${item.title}“ gelöscht`);
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
    const search = await formDialog('Empfänger suchen', [{ name: 'q', label: 'Nutzer- oder Sendername (leer lassen für „Netzwerk: alle Sender“)', value: '' }], 'Weiter');
    if (!search) return;
    const found = await run(() => ctx.api.get(url(`/recipients?q=${encodeURIComponent(search.q ?? '')}`)));
    if (!found) return;
    const options = [['station:*', '🌐 Netzwerk: alle Sender dieser Installation'], ...found.users.map((u) => [`user:${u.id}`, `${u.name} (@${u.username})`]), ...found.stations.map((s) => [`station:${s.id}`, `Sender: ${s.name}`])];
    const directory = await run(() => ctx.api.get(url('/recipients')));
    if (!directory) return;
    const choice = await formDialog('Katalogfreigabe', [
      { name: 'recipient', label: 'Empfänger', options },
      { name: 'target', label: 'Gültig für Sender', options: directory.stations.map((s) => [s.id, s.name]), hint: 'Freigabe gilt nur in diesem Senderkontext. Neue Mitglieder einer Sender-Sammlung erben sie.' },
    ], 'Freigeben');
    if (!choice) return;
    const [kind, id] = choice.recipient.split(':');
    const target = kind === 'station' ? id : choice.target; // Netzwerk („*“) gilt in jedem Senderkontext
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
    const value = await formDialog('Freigabe widerrufen', [{ name: 'grant', label: 'Aktive Freigabe', options: active.map((g) => [g.id, `${g.recipient.kind === 'station' ? (g.recipient.id === '*' ? '🌐 Netzwerk' : 'Sender') : 'Nutzer'} ${g.recipient.id === '*' ? '' : g.recipient.id} · ${g.targetStationIds.join(', ')}`]) }], 'Widerrufen');
    if (!value || !confirm('Neue Zugriffe über diese Freigabe sofort beenden? Bereits exportierte Dateien bleiben beim Empfänger.')) return;
    const result = await run(() => ctx.api.del(url(`/grants/${encodeURIComponent(value.grant)}?station=${encodeURIComponent(station())}`)));
    if (result === undefined) return;
    status('Freigabe widerrufen');
    await run(load);
  }

  /** @param {File[]} files */
  async function uploadFiles(files) {
    for (const file of files) await uploadPrivate(file);
  }
  const uploadInput = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: 'audio/*,image/*,.pdf,.txt,.md,.docx,.xlsx,.zip', multiple: true, hidden: true,
    onchange: (/** @type {Event} */ e) => {
      const inp = /** @type {HTMLInputElement} */ (e.target);
      if (inp.files?.length) uploadFiles([...inp.files]).finally(() => { inp.value = ''; });
    },
  }));
  /** @type {any} */ let replaceTarget = null;
  const replaceInput = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: 'audio/*', hidden: true,
    onchange: (/** @type {Event} */ e) => {
      const inp = /** @type {HTMLInputElement} */ (e.target);
      const target = replaceTarget;
      if (inp.files?.length && target) replaceUpload(target, inp.files[0]).finally(() => { inp.value = ''; });
    },
  }));

  function render() {
    const sid = station();
    const mine = (/** @type {any} */ item) => item.owner.kind === 'user' && item.owner.id === myId();
    const isStationOwn = (/** @type {any} */ item) => item.owner.kind === 'station' && item.owner.id === sid;
    const visible = items.filter((item) => filter === 'all' || filter === 'station' && isStationOwn(item) || filter === 'mine' && mine(item) || filter === 'shared' && !isStationOwn(item) && !mine(item));
    const ownCollections = collections.filter((c) => c.owner.kind === 'station' && c.owner.id === sid);
    const unregistered = ctx.library().filter((m) => !m.url && !items.some((item) => item.source?.kind === 'station' && item.source.stationId === sid && item.source.mediaId === m.id));
    const first = total ? page * 50 + 1 : 0;
    const last = Math.min((page + 1) * 50, total);
    /** @param {any} item */
    function itemActions(item) {
      const row = h('div', { class: 'row mh-actions' });
      const kind = item.kind ?? 'audio';
      if (item.actions.includes('preview.play') && kind === 'audio') row.append(h('audio', { controls: true, preload: 'none', style: 'height:28px;vertical-align:middle', src: ctx.api.musicHubUrl(item.id, 'preview', sid) }));
      if (item.actions.includes('preview.play') && kind === 'image') row.append(h('a', { href: ctx.api.musicHubUrl(item.id, 'preview', sid), target: '_blank', rel: 'noopener' }, h('img', { class: 'mh-thumb', alt: '', loading: 'lazy', src: ctx.api.musicHubUrl(item.id, 'preview', sid) })));
      if (item.actions.includes('file.download')) row.append(h('a', { class: 'btn small', href: ctx.api.musicHubUrl(item.id, 'download', sid), download: true }, 'Herunterladen'));
      if (isStationOwn(item) && item.actions.includes('media.upload')) row.append(h('button', { class: 'btn small', onclick: () => addToCollection(item) }, 'In Sammlung'));
      if (mine(item) && item.source?.kind === 'upload' && item.actions.includes('source.write')) row.append(h('button', { class: 'btn small', onclick: () => { replaceTarget = item; replaceInput.click(); } }, 'Ersetzen'));
      if (kind === 'audio' && mine(item) && item.source?.kind === 'upload' && item.actions.includes('broadcast.use')) row.append(h('button', { class: 'btn small', onclick: () => stageItem(item) }, `Für „${sid}“ bereitstellen`));
      if (kind === 'audio' && (mine(item) || isStationOwn(item)) && item.actions.includes('transfer.export')) row.append(h('button', { class: 'btn small', onclick: () => lautcastTransfer(item) }, 'An laut.fm übertragen'));
      if ((mine(item) || isStationOwn(item)) && item.actions.includes('media.delete')) row.append(h('button', { class: 'btn small danger', onclick: () => deleteItem(item) }, 'Löschen'));
      return row.childNodes.length ? row : null;
    }
    root.replaceChildren(
      h('div', { class: 'row mh-toolbar' },
        h('input', { type: 'search', value: query, placeholder: 'Titel oder Interpret suchen', 'aria-label': 'MusikHub durchsuchen', oninput: (e) => { query = /** @type {HTMLInputElement} */ (e.target).value; page = 0; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); void run(load); } } }),
        h('button', { class: 'btn small', onclick: () => run(load) }, 'Suchen / Aktualisieren'),
        h('button', { class: 'btn small primary', title: 'Audio, Logos/Bilder und Dokumente (PDF, Text, Office, ZIP) ins eigene Archiv', onclick: () => uploadInput.click() }, '＋ Datei hochladen'),
        uploadInput,
        replaceInput,
        h('span', { class: 'muted', role: 'status' }, `${total} sichtbare Titel insgesamt`),
        quota ? h('span', { class: 'muted', role: 'status' }, ` · Eigenes Archiv: ${mb(quota.usedBytes)} von ${mb(quota.quotaBytes)} belegt`) : null),
      h('div', { class: 'row mh-filters' },
        ...[['all', 'Alle'], ['station', 'Senderarchiv'], ['mine', 'Mein Archiv'], ['shared', 'Mit mir geteilt']].map(([id, label]) => h('button', { class: `btn small${filter === id ? ' primary' : ''}`, 'aria-pressed': String(filter === id), onclick: () => { filter = id; render(); } }, label))),
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
            (item.kind ?? 'audio') !== 'audio' ? h('span', { class: 'mh-kind' }, item.kind === 'image' ? '🖼 Bild' : '📄 Dokument') : null,
            h('strong', {}, `${item.artist ? item.artist + ' – ' : ''}${item.title}`),
            h('span', { class: 'muted' }, ` · ${item.owner.kind === 'station' ? `Sender ${item.owner.id}` : mine(item) ? 'Persönlich (meins)' : 'Persönlich'}${item.version ? ` · v${item.version}` : ''}`),
            itemActions(item)))) : h('p', { class: 'muted' }, total ? 'Auf dieser Seite entspricht kein Titel dem gewählten Filter.' : 'Keine freigegebenen Titel gefunden.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', disabled: page === 0, onclick: () => { page--; void run(load); } }, 'Zurück'),
            h('button', { class: 'btn small', disabled: (page + 1) * 50 >= total, onclick: () => { page++; void run(load); } }, 'Weiter')))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Sender-Titel katalogisieren')),
        h('p', { class: 'muted' }, 'Die vorhandene Senderdatei bleibt an ihrem Speicherort. Eine Katalogfreigabe stellt noch keinen Dateiabruf und keine Sendebereitstellung für andere Sender bereit.'),
        unregistered.length ? h('ul', { class: 'plain-list' }, ...unregistered.slice(0, 100).map((m) => h('li', { class: 'mh-entry' }, `${m.artist ? m.artist + ' – ' : ''}${m.title} `, h('button', { class: 'btn small', onclick: () => register(m) }, 'Katalogisieren')))) : h('p', { class: 'muted' }, 'Keine weiteren Titel in der aktuellen Senderbibliothek.')),
      myId() ? nextcloudPanel() : null,
      myId() ? transfersPanel() : null);
  }

  /** Nur-Lese-Verlauf der eigenen Aktivität (Upload, Ersetzen, Löschen, Freigaben, Sammlungen,
   * Cloud-Quelle) aus dem bestehenden Audit-Log - keine neue Datenhaltung, keine Aktionen hier. */
  function transfersPanel() {
    /** @type {Record<string, string>} */
    const labels = {
      item_uploaded: 'Hochgeladen', item_source_replaced: 'Ersetzt', item_deleted: 'Gelöscht',
      item_registered: 'Sendertitel katalogisiert', grant_created: 'Freigabe erteilt', grant_revoked: 'Freigabe widerrufen',
      collection_created: 'Sammlung angelegt', collection_items_changed: 'Sammlung geändert',
      nextcloud_source_configured: 'Cloud-Quelle konfiguriert',
    };
    return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Übertragungen (eigene Aktivität)')),
      transfers.length
        ? h('ul', { class: 'plain-list' }, ...transfers.slice(0, 50).map((t) => h('li', { class: 'mh-entry' },
            h('span', { class: 'muted' }, new Date(t.at).toLocaleString('de-DE')), ' · ',
            h('strong', {}, labels[t.event] ?? t.event),
            t.sizeBytes ? h('span', { class: 'muted' }, ` · ${mb(t.sizeBytes)}`) : null,
            t.version ? h('span', { class: 'muted' }, ` · v${t.version}`) : null)))
        : h('p', { class: 'muted' }, 'Noch keine eigene Aktivität aufgezeichnet.'));
  }

  /** Eigene (persönliche) Nextcloud-Quelle für "Mein Archiv" - getrennt von jeder Sender-Cloud-Anbindung.
   * Nur Ordneransicht (kein rekursiver Scan) und Einzeldatei-Übernahme; ein Job-/Sync-System folgt später. */
  function nextcloudPanel() {
    const configured = ncSource && ncSource.configured !== false;
    return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Cloud-Quelle (eigene Nextcloud)')),
      !configured
        ? h('div', {},
            h('p', { class: 'muted' }, 'Eigene Nextcloud als Quelle für „Mein Archiv“ verbinden - unabhängig von jeder Sender-Cloud-Anbindung.'),
            h('button', { class: 'btn small', onclick: setupNextcloud }, 'Cloud-Quelle einrichten'))
        : h('div', {},
            h('p', { class: 'muted' }, `Verbunden: ${ncSource.user}@${ncSource.url} · Startordner ${ncSource.root}`),
            h('div', { class: 'row' },
              h('button', { class: 'btn small', onclick: setupNextcloud }, 'Bearbeiten'),
              h('button', { class: 'btn small', onclick: () => browseNextcloud(ncBrowse?.path ?? ncSource.root) }, 'Durchsuchen'),
              h('button', { class: 'btn small danger', onclick: removeNextcloud }, 'Entfernen')),
            ncBrowse ? h('div', {},
              h('div', { class: 'row' },
                h('input', { type: 'text', value: ncBrowse.path, 'aria-label': 'Cloud-Ordnerpfad', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); void run(() => browseNextcloud(/** @type {HTMLInputElement} */ (e.target).value)); } } }),
                ncBrowse.path !== '/' ? h('button', { class: 'btn small', onclick: () => browseNextcloud(ncBrowse.path.split('/').slice(0, -1).join('/') || '/') }, '⬆ Ebene hoch') : null,
                h('button', { class: 'btn small', onclick: () => importFolderFromNextcloud(ncBrowse.path), title: 'Bis zu einer festen Obergrenze Audiodateien aus diesem Ordner und Unterordnern übernehmen' }, '⬇ Ordner übernehmen')),
              ncBrowse.entries.length
                ? h('ul', { class: 'plain-list' }, ...ncBrowse.entries.map((e) => h('li', { class: 'mh-entry' },
                    e.dir
                      ? h('button', { class: 'btn small', onclick: () => browseNextcloud(e.path) }, `📁 ${e.name}`)
                      : h('span', {}, `${e.audio ? '🎵' : '·'} ${e.name}`),
                    e.audio ? h('button', { class: 'btn small', onclick: () => importFromNextcloud(e.path, e.name) }, 'Übernehmen') : null)))
                : h('p', { class: 'muted' }, 'Ordner ist leer.')) : null));
  }

  async function show() { await run(load); }
  return { show };
}
