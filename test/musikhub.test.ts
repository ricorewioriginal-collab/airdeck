import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { DbDocStore } from '../src/server/repo/docs.ts';
import { openSqliteSync } from '../src/server/db/index.ts';
import { createTableSql, TABLES_V2 } from '../src/server/db/schema.ts';

test('MusikHub: private Suchresultate, Nutzer- und Sendergrant, Widerruf und persistente Migration', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-test-'));
  const app = new AnMaChaCastApp(dir, { ffmpeg: null });
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
    assert.deepEqual((await call(tb, 'GET', '/music-hub/items?station=b')).body.items[0].actions, ['catalog.read', 'preview.play']);
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
    const db = openSqliteSync(join(dir, 'anmachacast.db'));
    try {
      const state = DbDocStore.openSync(db).get<{ items: { id: string }[]; collections: { id: string }[]; grants: { id: string }[] }>('musikhub', { items: [], collections: [], grants: [] });
      assert.equal(state.items[0]?.id, itemId);
      assert.equal(state.collections[0]?.id, collectionId);
      assert.equal(state.grants.length, 2);
    } finally { await db.close(); }
    assert.equal(a.id.length > 0, true);
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
