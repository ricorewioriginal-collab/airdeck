import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { DbDocStore } from '../src/server/repo/docs.ts';
import { openSqliteSync } from '../src/server/db/index.ts';
import { createTableSql, TABLES_V2 } from '../src/server/db/schema.ts';

test('MusikHub: private Suchresultate, Nutzer- und Sendergrant, Widerruf und persistente Migration', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-test-'));
  const app = new AirDeckApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    app.svc.stations.createStation({ id: 'b', name: 'Sender B' });
    app.svc.media.addMedia('main', { id: 'song', title: 'Abendshow', artist: 'Test', category: 'music', file: 'song.mp3', durationMs: 3000, addedAt: Date.now() });
    mkdirSync(join(app.mediaDir, 'main'), { recursive: true });
    writeFileSync(join(app.mediaDir, 'main', 'song.mp3'), Buffer.from('ID3-test-audio'));
    const fakeCover = join(dir, 'test-cover.jpg');
    writeFileSync(fakeCover, Buffer.from('jpeg-cover'));
    app.svc.media.cover = async () => fakeCover;
    const a = await app.users.create({ username: 'owner', password: 'Owner-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false });
    const b = await app.users.create({ username: 'target', password: 'Target-Passwort1', roles: ['dj'], stationIds: ['b'], mustChangePassword: false });
    const c = await app.users.create({ username: 'other', password: 'Other-Passwort1', roles: ['dj'], stationIds: ['b'], mustChangePassword: false });
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const ta = await login('owner', 'Owner-Passwort1');
    const tb = await login('target', 'Target-Passwort1');
    const tc = await login('other', 'Other-Passwort1');
    assert.ok((await call(ta, 'GET', '/music-hub/recipients')).body.stations.some((s: { id: string }) => s.id === 'b'));
    assert.ok((await call(ta, 'GET', '/music-hub/recipients?q=target')).body.users.some((u: { id: string }) => u.id === b.id));

    const itemResult = await call(ta, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'song' });
    assert.equal(itemResult.status, 200);
    const itemId = itemResult.body.id as string;
    const adminToken = app.svc.auth.createToken({ name: 'platform-admin', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
    assert.equal((await call(adminToken, 'GET', '/music-hub/items?station=main')).body.total, 0, 'Plattformtoken erhält keinen MusikHub-Inhaltszugriff');
    assert.equal((await call(ta, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'song' })).body.id, itemId, 'Registrierung ist idempotent');
    assert.equal((await call(tb, 'GET', '/music-hub/items?station=b&q=Abendshow')).body.total, 0, 'MH01: keine Trefferzahl für fremde Titel');
    assert.equal((await fetch(base + `/music-hub/items/${itemId}/cover?station=b`, {
      headers: { Authorization: `Bearer ${tb}` },
    })).status, 404, 'Cover verrät ohne Katalogrecht keinen Titel');
    assert.equal((await call(tc, 'GET', '/music-hub/items?station=b')).body.total, 0);
    await app.users.update(a.id, { stationIds: ['main', 'b'] });
    assert.equal((await call(ta, 'GET', '/music-hub/items?station=b')).body.total, 0, 'MH04: Quell-Eigentum ist keine Freigabe an Zielsender B');
    assert.equal((await call(tb, 'GET', '/stations/main/media/song/file')).status, 403, 'Hub-Freigabe umgeht alte Dateiroute nicht');

    const collectionResult = await call(ta, 'POST', '/music-hub/collections', { owner: { kind: 'station', id: 'main' }, name: 'Abendshow' });
    assert.equal(collectionResult.status, 200);
    const collectionId = collectionResult.body.id as string;
    assert.equal((await call(ta, 'PUT', `/music-hub/collections/${collectionId}/items`, { stationId: 'main', itemIds: [itemId], revision: 1 })).status, 200);
    assert.equal((await call(ta, 'PUT', `/music-hub/collections/${collectionId}/items`, { stationId: 'main', itemIds: [], revision: 1 })).status, 409, 'veraltete Revision bleibt ohne Wirkung');

    const userGrant = await call(ta, 'POST', `/music-hub/collection/${collectionId}/grants`, {
      stationId: 'main', recipient: { kind: 'user', id: b.id }, actions: ['catalog.read', 'preview.play'], targetStationIds: ['b'],
    });
    assert.equal(userGrant.status, 200);
    assert.equal((await call(tb, 'GET', '/music-hub/items?station=b')).body.total, 1, 'MH02: nur Empfänger B');
    assert.equal((await call(tc, 'GET', '/music-hub/items?station=b')).body.total, 0);
    const sharedCatalogItem = (await call(tb, 'GET', '/music-hub/items?station=b')).body.items[0];
    assert.deepEqual(sharedCatalogItem.actions, ['catalog.read', 'preview.play']);
    assert.deepEqual(sharedCatalogItem.availability, { state: 'ready', sourceKind: 'station' });
    assert.equal(sharedCatalogItem.source, undefined, 'fremde Quell-IDs werden trotz Verfügbarkeitsanzeige nicht offengelegt');
    const cover = await fetch(base + `/music-hub/items/${itemId}/cover?station=b`, {
      headers: { Authorization: `Bearer ${tb}` },
    });
    assert.equal(cover.status, 200, 'Katalogrecht erlaubt das geschützte Cover');
    assert.equal(cover.headers.get('cache-control'), 'private, no-store');
    assert.equal(await cover.text(), 'jpeg-cover');
    const preview = await fetch(base + `/music-hub/items/${itemId}/preview?station=b`, {
      headers: { Authorization: `Bearer ${tb}`, Range: 'bytes=0-2' },
    });
    assert.equal(preview.status, 206, 'Preview-Grant erlaubt Range-Streaming');
    assert.equal(await preview.text(), 'ID3');
    assert.equal(preview.headers.get('cache-control'), 'private, no-store');
    assert.equal((await fetch(base + `/music-hub/items/${itemId}/download?station=b`, {
      headers: { Authorization: `Bearer ${tb}` },
    })).status, 404, 'Preview-Grant erlaubt keinen Download');
    assert.equal((await call(tb, 'POST', `/music-hub/items/${itemId}/queue`, { stationId: 'b' })).status, 404, 'Preview-Grant erlaubt kein Einreihen zur Sendung');

    const downloadGrant = await call(ta, 'POST', `/music-hub/item/${itemId}/grants`, {
      stationId: 'main', recipient: { kind: 'user', id: b.id }, actions: ['file.download'], targetStationIds: ['b'],
    });
    assert.equal(downloadGrant.status, 200);
    const download = await fetch(base + `/music-hub/items/${itemId}/download?station=b`, {
      headers: { Authorization: `Bearer ${tb}` },
    });
    assert.equal(download.status, 200, 'Download benötigt ein eigenes Recht');
    assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.equal(await download.text(), 'ID3-test-audio');

    const broadcastGrant = await call(ta, 'POST', `/music-hub/item/${itemId}/grants`, {
      stationId: 'main', recipient: { kind: 'user', id: b.id }, actions: ['broadcast.use'], targetStationIds: ['b'],
    });
    assert.equal(broadcastGrant.status, 200);
    const hubEvents: unknown[] = [];
    const unsubHubEvents = app.subscribe((event) => {
      if (event.stationId === 'b' && (event.type === 'queue.changed' || event.type === 'playlists.changed')) hubEvents.push(event.payload);
    });
    const queued = await call(tb, 'POST', `/music-hub/items/${itemId}/queue`, { stationId: 'b' });
    assert.equal(queued.status, 200, 'broadcast.use erlaubt MusicHub→Queue');
    assert.equal(queued.body.items.length, 1);
    assert.equal(queued.body.items[0].media.title, 'Abendshow');
    assert.equal(queued.body.items[0].mediaId, `musikhub:${itemId}`, 'öffentliche Queue-ID enthält keinen Benutzerbezug');
    assert.equal(String(queued.body.items[0].mediaId).includes(b.id), false, 'interne Grant-Akteur-ID bleibt verborgen');
    assert.equal(app.svc.media.library('b').length, 0, 'Broadcast-Freigabe kopiert nichts in die Senderbibliothek');

    const playlist = app.svc.planning.savePlaylist('b', null, { name: 'Hub-Sendung', items: [] });
    const playlistAdd = await call(tb, 'POST', `/music-hub/items/${itemId}/playlists/${playlist.id}`, { stationId: 'b' });
    assert.equal(playlistAdd.status, 200, 'broadcast.use erlaubt das Speichern in einer Sender-Playlist');
    assert.deepEqual(playlistAdd.body.items, [`musikhub:${itemId}`], 'Playlist-API gibt nur öffentliche Hub-Referenz zurück');
    assert.equal(JSON.stringify(playlistAdd.body).includes(b.id), false, 'Playlist-Antwort verrät keine Grant-Akteur-ID');
    const playlists = await call(tb, 'GET', '/stations/b/playlists');
    assert.deepEqual(playlists.body[0].items, [`musikhub:${itemId}`], 'auch Playlist-Lesen sanitisiert interne Referenzen');
    unsubHubEvents();
    const eventJson = JSON.stringify(hubEvents);
    assert.equal(eventJson.includes('__hub__:'), false, 'SSE-Quellen enthalten keine internen MusicHub-Queue-Referenzen');
    assert.equal(eventJson.includes(b.id), false, 'SSE-Quellen enthalten keine Grant-Akteur-ID');

    app.queueClear('b');
    app.svc.planning.playPlaylist('b', playlist.id);
    assert.equal(app.rt('b').queue.list().length, 1, 'MusicHub-Titel aus Playlist wird in die Queue übernommen');
    assert.equal(app.svc.musikhub.isQueuedBroadcastRef(app.rt('b').queue.list()[0]!.mediaId), true);

    app.queueClear('b');
    app.svc.planning.savePlan('b', null, { label: 'Hub-Zeitfenster', days: [], from: '00:00', to: '00:00', playlistId: playlist.id, shuffle: false });
    app.queueFill('b');
    assert.equal(app.rt('b').queue.list().some((q) => app.svc.musikhub.isQueuedBroadcastRef(q.mediaId)), true, 'aktiver Sendeplan füllt MusicHub-Referenzen in die Queue');

    rmSync(join(app.mediaDir, 'main', 'song.mp3'), { force: true });
    const missingCatalogItem = (await call(tb, 'GET', '/music-hub/items?station=b')).body.items[0];
    assert.deepEqual(missingCatalogItem.availability, { state: 'missing', sourceKind: 'station' });
    assert.equal((await call(tb, 'POST', `/music-hub/items/${itemId}/queue`, { stationId: 'b' })).status, 409, 'fehlende Quelle wird vor dem Einreihen blockiert');
    writeFileSync(join(app.mediaDir, 'main', 'song.mp3'), Buffer.from('ID3-test-audio'));

    assert.equal((await call(ta, 'DELETE', `/music-hub/grants/${broadcastGrant.body.id}?station=main`)).status, 204);
    assert.equal(app.queueNext('b'), null, 'Widerruf vor Playout blockiert bereits eingereihten MusicHub-Titel erneut');
    assert.equal(app.rt('b').queue.list().length, 0, 'gesperrter Hub-Eintrag wird aus der Queue entfernt');
    const preflightAfterRevoke = app.svc.planning.preflight('b');
    assert.equal(preflightAfterRevoke.summary.problems > 0 || preflightAfterRevoke.summary.warnings > 0, true, 'Sendeplan-Preflight meldet entzogene MusicHub-Senderechte');

    assert.equal((await call(tb, 'POST', `/music-hub/item/${itemId}/grants`, { stationId: 'b', recipient: { kind: 'user', id: c.id }, actions: ['catalog.read'], targetStationIds: ['b'] })).status, 403, 'kein Delegieren ohne shares.manage');

    const stationGrant = await call(ta, 'POST', `/music-hub/collection/${collectionId}/grants`, {
      stationId: 'main', recipient: { kind: 'station', id: 'b' }, actions: ['catalog.read'], targetStationIds: ['b'],
    });
    assert.equal(stationGrant.status, 200);
    assert.equal((await call(tc, 'GET', '/music-hub/items?station=b')).body.total, 1, 'MH03: aktuelles Senderteam');
    assert.equal((await call(ta, 'DELETE', `/music-hub/grants/${stationGrant.body.id}?station=main`)).status, 204);
    assert.equal((await call(tc, 'GET', '/music-hub/items?station=b')).body.total, 0, 'MH07: nur widerrufener Grant entfällt');
    assert.equal((await call(tb, 'GET', '/music-hub/items?station=b')).body.total, 1, 'Nutzergrant bleibt wirksam');
    await app.users.update(b.id, { stationIds: ['main'] });
    assert.equal((await call(tb, 'GET', '/music-hub/items?station=b')).status, 404, 'MH03: Senderaustritt entzieht neue Zugriffe sofort');

    await app.docs.flush();
    const db = openSqliteSync(join(dir, 'airdeck.db'));
    try {
      const state = DbDocStore.openSync(db).get<{ items: { id: string }[]; collections: { id: string }[]; grants: { id: string }[] }>('musikhub', { items: [], collections: [], grants: [] });
      assert.equal(state.items[0]?.id, itemId);
      assert.equal(state.collections[0]?.id, collectionId);
      assert.equal(state.grants.length, 4);
    } finally { await db.close(); }
    assert.equal(a.id.length > 0, true);
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test('MusikHub: persönliche Uploads bleiben privat und getrennt von Senderbibliotheken', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-personal-test-'));
  const app = new AirDeckApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const json = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    app.svc.stations.createStation({ id: 'b', name: 'Sender B' });
    const ownerPassword = ['Owner', 'Test', 'Pass', '1'].join('-');
    const targetPassword = ['Target', 'Test', 'Pass', '1'].join('-');
    const owner = await app.users.create({ username: 'personal-owner', password: ownerPassword, roles: ['editor'], stationIds: ['main'], mustChangePassword: false });
    const target = await app.users.create({ username: 'personal-target', password: targetPassword, roles: ['dj'], stationIds: ['b'], mustChangePassword: false });
    const login = async (name: string, pw: string) => (await json('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const ownerToken = await login('personal-owner', ownerPassword);
    const targetToken = await login('personal-target', targetPassword);

    const upload = await fetch(base + '/music-hub/personal?station=main&name=Privat%20-%20Song.mp3', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'audio/mpeg' },
      body: Buffer.from('ID3-private-audio'),
    });
    assert.equal(upload.status, 200);
    const item = await upload.json() as { id: string; owner: { kind: string; id: string }; source: { kind: string; file?: string }; revision: number };
    assert.equal(item.owner.kind, 'user');
    assert.equal(item.owner.id, owner.id);
    assert.equal(item.source.kind, 'personal');
    assert.equal(app.svc.media.library('main').length, 0, 'persönliche Datei landet nicht in der Senderbibliothek');

    const ownerCatalog = await json(ownerToken, 'GET', '/music-hub/items?station=main&q=Song');
    assert.equal(ownerCatalog.body.total, 1);
    assert.equal(ownerCatalog.body.items[0].source.kind, 'personal');
    assert.deepEqual(ownerCatalog.body.items[0].availability, { state: 'ready', sourceKind: 'personal' });
    assert.equal(ownerCatalog.body.items[0].source.file, undefined, 'interner Dateiname wird nicht über die API offengelegt');
    assert.equal(item.source.file, undefined, 'auch die Upload-Antwort verrät keinen internen Dateinamen');
    const metadata = await json(ownerToken, 'PATCH', `/music-hub/items/${item.id}?station=main`, {
      title: 'Song', artist: 'Privat', version: 'Radio Edit', revision: 1,
    });
    assert.equal(metadata.status, 200);
    assert.equal(metadata.body.version, 'Radio Edit');
    assert.equal(metadata.body.revision, 2);
    assert.equal((await json(ownerToken, 'PATCH', `/music-hub/items/${item.id}?station=main`, {
      title: 'Alt', revision: 1,
    })).status, 409, 'veraltete Metadatenrevision wird abgewiesen');
    assert.equal((await json(targetToken, 'GET', '/music-hub/items?station=b&q=Song')).body.total, 0, 'fremder Nutzer sieht weder Treffer noch Trefferzahl');

    const grant = await json(ownerToken, 'POST', `/music-hub/item/${item.id}/grants`, {
      stationId: 'main',
      recipient: { kind: 'user', id: target.id },
      actions: ['catalog.read', 'preview.play'],
      targetStationIds: ['b'],
    });
    assert.equal(grant.status, 200);
    assert.equal((await json(targetToken, 'GET', '/music-hub/items?station=b&q=Song')).body.total, 1);
    const targetItem = (await json(targetToken, 'GET', '/music-hub/items?station=b&q=Song')).body.items[0];
    assert.equal(targetItem.source, undefined, 'Empfänger erhält keine private Speicherquelle');
    assert.equal(targetItem.version, 'Radio Edit', 'freigegebene Metadaten enthalten die Version');

    const preview = await fetch(base + `/music-hub/items/${item.id}/preview?station=b`, {
      headers: { Authorization: `Bearer ${targetToken}`, Range: 'bytes=0-2' },
    });
    assert.equal(preview.status, 206);
    assert.equal(await preview.text(), 'ID3');
    assert.equal((await fetch(base + `/music-hub/items/${item.id}/download?station=b`, {
      headers: { Authorization: `Bearer ${targetToken}` },
    })).status, 404, 'Preview bleibt vom Download getrennt');

    assert.equal((await json(ownerToken, 'DELETE', `/music-hub/items/${item.id}?station=main`)).status, 204);
    assert.equal((await json(ownerToken, 'GET', '/music-hub/items?station=main&q=Song')).body.total, 0);
    assert.equal((await json(targetToken, 'GET', '/music-hub/items?station=b&q=Song')).body.total, 0);
    assert.equal((await fetch(base + `/music-hub/items/${item.id}/preview?station=b`, {
      headers: { Authorization: `Bearer ${targetToken}` },
    })).status, 404);
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MusikHub-Migration verwendet alle Datenbankdialekte', () => {
  for (const dialect of ['sqlite', 'postgres', 'mysql'] as const) {
    for (const table of TABLES_V2) {
      const sql = createTableSql(table, dialect);
      assert.match(sql[0]!, new RegExp(`CREATE TABLE IF NOT EXISTS ${table.name}`));
      assert.ok(sql.length > 1, 'Suchindex');
    }
  }
});
