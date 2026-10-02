// MusikHub Phase 2 (Studio): privater Audio-Upload mit geschlossenem Standardzugriff, getrenntes
// authentifiziertes Vorhören (Range-fähig) und Download-Recht, Cover-Zugriff wie Katalogdaten
// gefiltert, sofortiger Widerruf und Löschung der physischen Datei.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('MusikHub: privater Upload, getrenntes Vorhören/Download, Cover-Filter, Widerruf, Löschung', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-uploads-test-'));
  const app = new AnMaChaCastApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
  };
  try {
    const owner = await app.users.create({ username: 'privat', password: 'Privat-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false });
    const stranger = await app.users.create({ username: 'fremd', password: 'Fremd-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('privat', 'Privat-Passwort1');
    const ts = await login('fremd', 'Fremd-Passwort1');

    // Nicht unterstützter Dateityp wird abgelehnt, bevor irgendetwas geschrieben wird.
    const badExt = await fetch(`${base}/music-hub/uploads?name=schadcode.exe`, { method: 'PUT', headers: { Authorization: `Bearer ${to}` }, body: Buffer.from('x') });
    assert.equal(badExt.status, 415);

    // Ein reiner API-/Desktop-Token ohne echtes Benutzerkonto darf "Mein Archiv" nicht befüllen: sonst
    // entstünde ein Eintrag, den nicht einmal der Hochladende selbst über ownerAccess() je wiederfindet.
    const platformToken = app.svc.auth.createToken({ name: 'ohne-login', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
    const noUserUpload = await fetch(`${base}/music-hub/uploads?name=ohne-konto.mp3`, { method: 'PUT', headers: { Authorization: `Bearer ${platformToken}` }, body: Buffer.from('x') });
    assert.equal(noUserUpload.status, 403, 'privater Upload verlangt ein angemeldetes Benutzerkonto, kein bloßes API-Token');

    const payload = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256));
    const upRes = await fetch(`${base}/music-hub/uploads?name=Privater Mitschnitt.mp3`, { method: 'PUT', headers: { Authorization: `Bearer ${to}` }, body: payload });
    assert.equal(upRes.status, 200);
    const item = await upRes.json() as { id: string; owner: { kind: string; id: string }; source: { kind: string; file: string; sizeBytes: number } };
    assert.equal(item.owner.kind, 'user');
    assert.equal(item.owner.id, owner.id);
    assert.equal(item.source.kind, 'upload');
    assert.equal(item.source.sizeBytes, payload.length);

    // Andere Nutzer sehen den privaten Titel gar nicht im Katalog (MH-Isolation).
    assert.equal((await call(ts, 'GET', `/music-hub/items?station=main&q=Privater`)).body.total, 0);
    assert.equal((await call(to, 'GET', `/music-hub/items?station=main&q=Privater`)).body.total, 1, 'Eigentümer findet den eigenen privaten Titel');

    // Eigentümer darf sich selbst vorhören und herunterladen (volle Rechte auf eigenem Item).
    const ownPreview = await fetch(`${base}/music-hub/items/${item.id}/preview?station=main`, { headers: { Authorization: `Bearer ${to}` } });
    assert.equal(ownPreview.status, 200);
    assert.equal(ownPreview.headers.get('content-disposition'), 'inline');
    assert.deepEqual(new Uint8Array(await ownPreview.arrayBuffer()), new Uint8Array(payload));

    const rangeRes = await fetch(`${base}/music-hub/items/${item.id}/preview?station=main`, { headers: { Authorization: `Bearer ${to}`, Range: 'bytes=10-19' } });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-range'), `bytes 10-19/${payload.length}`);
    assert.deepEqual(new Uint8Array(await rangeRes.arrayBuffer()), new Uint8Array(payload.subarray(10, 20)), 'Range liefert exakt die angeforderten Bytes, kein Umweg über Voll-Download');

    const ownDownload = await fetch(`${base}/music-hub/items/${item.id}/download?station=main`, { headers: { Authorization: `Bearer ${to}` } });
    assert.equal(ownDownload.status, 200);
    assert.match(ownDownload.headers.get('content-disposition') ?? '', /^attachment; filename=".*\.mp3"$/);

    // Fremde ohne Grant: weder Vorhören noch Download noch Cover (404, keine Trefferzahl-Leckage).
    for (const action of ['preview', 'download', 'cover']) {
      const r = await fetch(`${base}/music-hub/items/${item.id}/${action}?station=main`, { headers: { Authorization: `Bearer ${ts}` } });
      assert.equal(r.status, 404, `Fremder darf ${action} nicht ohne Grant`);
    }

    // Ohne ffmpeg liefert Cover korrekt "kein Cover" statt eines Absturzes - auch für den Eigentümer.
    const ownCover = await fetch(`${base}/music-hub/items/${item.id}/cover?station=main`, { headers: { Authorization: `Bearer ${to}` } });
    assert.equal(ownCover.status, 404);

    // Grant beschränkt sich auf preview.play - Download bleibt trotz Zugriff auf denselben Titel gesperrt.
    const grant = await call(to, 'POST', `/music-hub/item/${item.id}/grants`, { stationId: 'main', recipient: { kind: 'user', id: stranger.id }, actions: ['catalog.read', 'preview.play'], targetStationIds: ['main'] });
    assert.equal(grant.status, 200);
    const grantedPreview = await fetch(`${base}/music-hub/items/${item.id}/preview?station=main`, { headers: { Authorization: `Bearer ${ts}` } });
    assert.equal(grantedPreview.status, 200, 'preview.play wirkt sofort');
    const grantedDownload = await fetch(`${base}/music-hub/items/${item.id}/download?station=main`, { headers: { Authorization: `Bearer ${ts}` } });
    assert.equal(grantedDownload.status, 404, 'file.download bleibt getrennt gesperrt - preview.play macht keinen impliziten Download-Zugriff auf');

    // Widerruf wirkt sofort auf die nächste Anfrage.
    assert.equal((await call(to, 'DELETE', `/music-hub/grants/${grant.body.id}?station=main`)).status, 204);
    const afterRevoke = await fetch(`${base}/music-hub/items/${item.id}/preview?station=main`, { headers: { Authorization: `Bearer ${ts}` } });
    assert.equal(afterRevoke.status, 404);

    // Löschen entfernt sowohl den Katalogeintrag als auch die physische Datei - kein Datenrest.
    const filePath = join(dir, 'musikhub', 'uploads', owner.id, item.source.file);
    // Datei existiert vor dem Löschen tatsächlich (kein Fake-Erfolg).
    assert.ok(existsSync(filePath), 'hochgeladene Datei liegt physisch vor');
    const del = await call(to, 'DELETE', `/music-hub/items/${item.id}?station=main`);
    assert.equal(del.status, 204);
    assert.equal(existsSync(filePath), false, 'Datei wird beim Löschen tatsächlich entfernt, nicht nur der Katalogeintrag');
    const afterDelete = await fetch(`${base}/music-hub/items/${item.id}/preview?station=main`, { headers: { Authorization: `Bearer ${to}` } });
    assert.equal(afterDelete.status, 404, 'auch der Eigentümer verliert den Zugriff nach dem Löschen');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
