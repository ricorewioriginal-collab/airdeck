// MusikHub: "Übertragungen" - nachvollziehbare eigene Aktivitätshistorie (Upload, Ersetzen, Löschen,
// Freigaben, ...), gelesen aus dem bereits vorhandenen Audit-Log statt eines neuen Speichers. Gilt
// strikt pro Nutzer - fremde Aktivität erscheint nie in der eigenen Liste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('MusikHub: Übertragungen - eigene Aktivitätshistorie aus dem Audit-Log, pro Nutzer getrennt', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-transfers-test-'));
  const app = new AnMaChaCastApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const put = (token: string, path: string, buf: Buffer) => fetch(`${base}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: buf });
  try {
    const owner = await app.users.create({ username: 'transfernutzer', password: 'Transfer-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const other = await app.users.create({ username: 'andernutzer', password: 'Andernutzer-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('transfernutzer', 'Transfer-Passwort1');
    const tOther = await login('andernutzer', 'Andernutzer-Passwort1');

    // Vor jeder Aktivität: leer.
    assert.deepEqual((await call(to, 'GET', '/music-hub/transfers')).body, []);

    // Ein reiner API-/Desktop-Token ohne Benutzerkonto bekommt keine eigene Historie (konsistent mit allem anderen Persönlichen).
    const platformToken = app.svc.auth.createToken({ name: 'ohne-login', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
    assert.equal((await call(platformToken, 'GET', '/music-hub/transfers')).status, 403);

    // Upload, Ersetzen, Freigabe, Widerruf, Löschen - alles vom Eigentümer selbst.
    const upRes = await put(to, '/music-hub/uploads?name=Aktivitaet.mp3', Buffer.from('inhalt-1'));
    const item = await upRes.json() as { id: string };
    await put(to, `/music-hub/items/${item.id}/replace?station=main&name=Aktivitaet2.mp3`, Buffer.from('inhalt-2-laenger'));
    const grant = await call(to, 'POST', `/music-hub/item/${item.id}/grants`, { stationId: 'main', recipient: { kind: 'user', id: other.id }, actions: ['catalog.read'], targetStationIds: ['main'] });
    await call(to, 'DELETE', `/music-hub/grants/${grant.body.id}?station=main`);
    await call(to, 'DELETE', `/music-hub/items/${item.id}?station=main`);

    const transfers = (await call(to, 'GET', '/music-hub/transfers')).body as { event: string; itemId?: string }[];
    const events = transfers.map((t) => t.event);
    assert.deepEqual(events, ['item_deleted', 'grant_revoked', 'grant_created', 'item_source_replaced', 'item_uploaded'], 'neueste zuerst, alle eigenen Ereignisse erfasst');
    assert.ok(transfers.every((t) => t.itemId === item.id || 'itemId' in t === false || t.itemId === item.id));

    // Fremde Aktivität erscheint nie in der eigenen Liste - vollständig getrennt.
    await put(tOther, '/music-hub/uploads?name=Fremd.mp3', Buffer.from('fremder-inhalt'));
    const ownTransfersAfter = (await call(to, 'GET', '/music-hub/transfers')).body as { event: string }[];
    assert.equal(ownTransfersAfter.length, transfers.length, 'fremder Upload taucht nicht in der eigenen Historie auf');
    const otherTransfers = (await call(tOther, 'GET', '/music-hub/transfers')).body as { event: string }[];
    assert.deepEqual(otherTransfers.map((t) => t.event), ['item_uploaded']);
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
