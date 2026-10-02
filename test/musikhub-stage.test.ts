// Bereitstellung (Phase 4, zweiter Schritt): kontrolliertes Kopieren eines eigenen privaten Uploads in
// ein Senderarchiv - danach ist der neue, sendergebundene Hub-Eintrag laut AnMaCha-Cast-Preflight
// sendefähig, während der ursprüngliche private Upload unverändert und weiterhin nicht sendefähig bleibt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('MusikHub: Bereitstellung eines privaten Uploads in ein Senderarchiv', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-stage-test-'));
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
    app.svc.stations.createStation({ id: 'b', name: 'Sender B' });

    const owner = await app.users.create({ username: 'moderation', password: 'Moderation-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const other = await app.users.create({ username: 'fremd', password: 'Fremd-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('moderation', 'Moderation-Passwort1');
    const tf = await login('fremd', 'Fremd-Passwort1');

    const upRes = await put(to, '/music-hub/uploads?name=Jingle.mp3', Buffer.from('privater-inhalt'));
    const upload = await upRes.json() as { id: string };

    // Fremder Nutzer darf nicht bereitstellen, auch nicht mit eigenem Senderzugang.
    const forbidden = await call(tf, 'POST', `/music-hub/items/${upload.id}/stage`, { station: 'main' });
    assert.equal(forbidden.status, 403);

    // Bereitstellung durch den Eigentümer: neuer, sendergebundener Hub-Eintrag entsteht.
    const staged = await call(to, 'POST', `/music-hub/items/${upload.id}/stage`, { station: 'main' });
    assert.equal(staged.status, 200);
    assert.notEqual(staged.body.id, upload.id);
    assert.equal(staged.body.owner.kind, 'station');
    assert.equal(staged.body.owner.id, 'main');

    // Der neue Eintrag ist jetzt tatsächlich sendefähig.
    const preflightStaged = await call(to, 'GET', `/music-hub/items/${staged.body.id}/preflight?station=main`);
    assert.equal(preflightStaged.status, 200);
    assert.deepEqual(preflightStaged.body, { ok: true, itemId: staged.body.id, stationId: 'main' });

    // Der ursprüngliche private Upload bleibt unverändert nicht sendefähig.
    const preflightOriginal = await call(to, 'GET', `/music-hub/items/${upload.id}/preflight?station=main`);
    assert.equal(preflightOriginal.status, 200);
    assert.deepEqual(preflightOriginal.body, { ok: false, reason: 'not_staged', itemId: upload.id, stationId: 'main' });

    // Ohne ausdrückliche Zuordnung zu Sender B: existenzleck-frei 404 statt 403.
    const secondUpload = await (await put(to, '/music-hub/uploads?name=Zweite.mp3', Buffer.from('zweiter-inhalt'))).json() as { id: string };
    const wrongStation = await call(to, 'POST', `/music-hub/items/${secondUpload.id}/stage`, { station: 'b' });
    assert.equal(wrongStation.status, 404);

    // Ein bereits gestellter, sendergebundener Eintrag lässt sich nicht erneut "bereitstellen" (keine Uploadquelle).
    const stageAgain = await call(to, 'POST', `/music-hub/items/${staged.body.id}/stage`, { station: 'main' });
    assert.equal(stageAgain.status, 400);
    assert.equal(stageAgain.body.error, 'invalid_source');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
