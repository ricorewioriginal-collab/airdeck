// AirDeckCast-Preflight (Phase 4, erster Schritt): reine Sendefähigkeits-Prüfung eines Hub-Titels für
// einen Sender - Berechtigung, Senderzugehörigkeit der Quelldatei, tatsächliches Vorhandensein, Format.
// Kein Wiring in Queue/Planung/Cardwall (bewusst separater, noch offener Schritt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('MusikHub: AirDeckCast-Preflight prüft Berechtigung, Senderzugehörigkeit, Datei und Format', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-preflight-test-'));
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

    // Echte, sendefähige Datei für Sender "main".
    mkdirSync(join(app.mediaDir, 'main'), { recursive: true });
    writeFileSync(join(app.mediaDir, 'main', 'song.mp3'), Buffer.from('inhalt'));
    app.svc.media.addMedia('main', { id: 'song', title: 'Abendshow', artist: 'Test', category: 'music', file: 'song.mp3', durationMs: 3000, addedAt: Date.now() });
    // Registrierter Titel ohne tatsächlich vorhandene Datei (nie geschrieben).
    app.svc.media.addMedia('main', { id: 'ghost', title: 'Geisterspur', artist: 'Test', category: 'music', file: 'ghost.mp3', durationMs: 3000, addedAt: Date.now() });

    const owner = await app.users.create({ username: 'sendeleitung', password: 'Sendeleitung-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const noBroadcast = await app.users.create({ username: 'nurlesen', password: 'Nurlesen-Passwort1', roles: ['viewer'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('sendeleitung', 'Sendeleitung-Passwort1');
    const tv = await login('nurlesen', 'Nurlesen-Passwort1');

    const item = (await call(to, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'song' })).body as { id: string };
    const ghost = (await call(to, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'ghost' })).body as { id: string };

    // Sendefähig: Eigentümer, richtiger Sender, vorhandene Datei, unterstütztes Format.
    const ok = await call(to, 'GET', `/music-hub/items/${item.id}/preflight?station=main`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true, itemId: item.id, stationId: 'main' });

    // Ohne Queue-/Automationsrecht (nur "viewer"): kein broadcast.use, konsistent existenzleck-frei 404.
    assert.equal((await call(tv, 'GET', `/music-hub/items/${item.id}/preflight?station=main`)).status, 404);

    // Falscher Sender: dieselbe Datei liegt nicht im Archiv von Sender B.
    const wrongStation = await call(to, 'GET', `/music-hub/items/${item.id}/preflight?station=b`);
    assert.equal(wrongStation.status, 404, 'kein Sendungsrecht für Sender B ohne Freigabe -> existenzleck-frei 404');

    // Registrierter Titel, dessen Datei nie geschrieben wurde.
    const missing = await call(to, 'GET', `/music-hub/items/${ghost.id}/preflight?station=main`);
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.body, { ok: false, reason: 'missing', itemId: ghost.id, stationId: 'main' });

    // Privater Upload: bewusst nie sendefähig ohne eine noch fehlende, separate Bereitstellungsfunktion.
    const put = (token: string, path: string, buf: Buffer) => fetch(`${base}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: buf });
    const upRes = await put(to, '/music-hub/uploads?name=Privat.mp3', Buffer.from('privater-inhalt'));
    const upload = await upRes.json() as { id: string };
    const notStaged = await call(to, 'GET', `/music-hub/items/${upload.id}/preflight?station=main`);
    assert.equal(notStaged.status, 200);
    assert.deepEqual(notStaged.body, { ok: false, reason: 'not_staged', itemId: upload.id, stationId: 'main' });
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
