// lautCast-Capability-Prüfung (Phase 5, erster Schritt): stellt fest, ob eine Übertragung eines
// Hub-Titels an laut.fm für den Zielsender überhaupt in Frage kommt (Berechtigung, laut.fm-Verbindung,
// Datei vorhanden/unterstütztes Format) - reine Prüfung ohne Upload, siehe Kommentar an
// lautcastCapability() in src/server/services/musikhub.ts. Der tatsächliche Upload wird in
// test/musikhub-lautcast-transfer.test.ts geprüft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('MusikHub: lautCast-Capability - Berechtigung und laut.fm-Verbindung des Zielsenders', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-lautcast-test-'));
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
    mkdirSync(join(app.mediaDir, 'main'), { recursive: true });
    writeFileSync(join(app.mediaDir, 'main', 'song.mp3'), Buffer.from('inhalt'));
    app.svc.media.addMedia('main', { id: 'song', title: 'Abendshow', artist: 'Test', category: 'music', file: 'song.mp3', durationMs: 3000, addedAt: Date.now() });

    const owner = await app.users.create({ username: 'redaktion', password: 'Redaktion-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const noExport = await app.users.create({ username: 'moderation', password: 'Moderation-Passwort1', roles: ['dj'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('redaktion', 'Redaktion-Passwort1');
    const tm = await login('moderation', 'Moderation-Passwort1');

    const item = (await call(to, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'song' })).body as { id: string };

    // Ohne transfer.export-Recht (DJ-Rolle hat kein media:write): existenzleck-frei 404.
    assert.equal((await call(tm, 'GET', `/music-hub/items/${item.id}/lautcast-capability?station=main`)).status, 404);

    // Berechtigt, aber Sender nicht mit laut.fm verbunden.
    const notConnected = await call(to, 'GET', `/music-hub/items/${item.id}/lautcast-capability?station=main`);
    assert.equal(notConnected.status, 200);
    assert.deepEqual(notConnected.body, { ok: false, reason: 'lautcast_not_connected', itemId: item.id, stationId: 'main' });

    // laut.fm-Verbindung simulieren (Token + gewählte Station, ohne echten API-Aufruf).
    app.secrets.set('lautfm:main', 'fake-token-fuer-test');
    app.rt('main').data.lautfm = { stationId: 42, stationName: 'testsender' };

    // Verbunden, Datei vorhanden, unterstütztes Format -> tatsächlich übertragbar.
    const connected = await call(to, 'GET', `/music-hub/items/${item.id}/lautcast-capability?station=main`);
    assert.equal(connected.status, 200);
    assert.deepEqual(connected.body, { ok: true, itemId: item.id, stationId: 'main' });

    // Registrierter Titel ohne tatsächlich vorhandene Datei (nie geschrieben).
    app.svc.media.addMedia('main', { id: 'ghost', title: 'Geisterspur', artist: 'Test', category: 'music', file: 'ghost.mp3', durationMs: 3000, addedAt: Date.now() });
    const ghost = (await call(to, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'ghost' })).body as { id: string };
    const missing = await call(to, 'GET', `/music-hub/items/${ghost.id}/lautcast-capability?station=main`);
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.body, { ok: false, reason: 'missing', itemId: ghost.id, stationId: 'main' });
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
