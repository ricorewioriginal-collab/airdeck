// MusikHub Phase 2: Speicherkontingent für private Uploads (je Nutzerkonto, nicht je Datei).
// Verhindert unbegrenztes persönliches Archiv, ohne die geschlossene Standard-Sichtbarkeit
// oder das getrennte Vorhör-/Download-Recht aus dem vorherigen Block zu verändern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { MAX_USER_UPLOAD_BYTES } from '../src/server/services/musikhub.ts';

test('MusikHub: Speicherkontingent für private Uploads greift serverseitig, unabhängig vom Client', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-quota-test-'));
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
    const owner = await app.users.create({ username: 'quota', password: 'Quota-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false });
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('quota', 'Quota-Passwort1');

    // Fast das gesamte Kontingent direkt über den Dokumentenspeicher als Bestandsdaten simulieren, statt
    // real Gigabytes zu übertragen - der HTTP-Uploadpfad selbst wird unten mit realistisch kleinen
    // Dateien geprüft. Wichtig: dies geschieht, bevor irgendein MusikHub-Aufruf den Dienstzustand
    // einmalig aus dem Dokumentenspeicher lädt (sonst würde die Seed-Änderung ignoriert und der
    // In-Memory-Zustand des Dienstes bliebe leer).
    const remaining = 50;
    const seedItem = {
      id: 'hub_seed', owner: { kind: 'user', id: owner.id },
      source: { kind: 'upload', file: 'seed.bin', mimeType: 'application/octet-stream', sizeBytes: MAX_USER_UPLOAD_BYTES - remaining },
      title: 'Bestandstitel', artist: '', version: null, createdAt: Date.now(), revision: 1,
    };
    app.docs.set('musikhub', { version: 1, items: [seedItem], collections: [], grants: [] });
    await app.docs.flush();

    const afterSeed = (await call(to, 'GET', '/music-hub/uploads/quota')).body as { usedBytes: number; quotaBytes: number };
    assert.equal(afterSeed.quotaBytes, MAX_USER_UPLOAD_BYTES);
    assert.equal(afterSeed.usedBytes, MAX_USER_UPLOAD_BYTES - remaining, 'Bestandsdaten zählen zum Kontingent');

    // Passt noch knapp: Upload unterhalb des verbleibenden Kontingents gelingt.
    const fits = Buffer.alloc(remaining - 10, 1);
    const fitsRes = await fetch(`${base}/music-hub/uploads?name=passt.mp3`, { method: 'PUT', headers: { Authorization: `Bearer ${to}` }, body: fits });
    assert.equal(fitsRes.status, 200, 'Upload innerhalb des verbleibenden Kontingents wird angenommen');
    const fitsItem = await fitsRes.json() as { id: string; source: { file: string } };

    // Überschreitet das nun (fast erschöpfte) Kontingent: Ablehnung, kein Katalogeintrag, keine
    // verwaiste Datei auf der Festplatte.
    const tooBig = Buffer.alloc(remaining, 2);
    const tooBigRes = await fetch(`${base}/music-hub/uploads?name=passt-nicht.mp3`, { method: 'PUT', headers: { Authorization: `Bearer ${to}` }, body: tooBig });
    assert.equal(tooBigRes.status, 413, 'Upload über das verbleibende Kontingent hinaus wird abgelehnt');
    const tooBigBody = await tooBigRes.json() as { error: string };
    assert.equal(tooBigBody.error, 'quota_exceeded');
    const catalogAfterReject = await call(to, 'GET', '/music-hub/items?station=main&q=passt-nicht');
    assert.equal(catalogAfterReject.body.total, 0, 'abgelehnter Upload erzeugt keinen Katalogeintrag');
    const uploadDir = join(dir, 'musikhub', 'uploads', owner.id);
    const filesAfterReject = readdirSync(uploadDir);
    assert.ok(!filesAfterReject.some((f) => f !== seedItem.source.file && f !== fitsItem.source.file), 'kein verwaistes Datei-Fragment nach abgelehntem Upload');

    // Löschen des großen Bestandstitels gibt Kontingent sofort frei - derselbe zuvor abgelehnte Upload
    // gelingt danach.
    const del = await call(to, 'DELETE', `/music-hub/items/hub_seed?station=main`);
    assert.equal(del.status, 204);
    const retryRes = await fetch(`${base}/music-hub/uploads?name=passt-jetzt.mp3`, { method: 'PUT', headers: { Authorization: `Bearer ${to}` }, body: tooBig });
    assert.equal(retryRes.status, 200, 'nach Freigabe durch Löschen passt derselbe Upload wieder');

    // Ein reiner API-/Desktop-Token ohne Benutzerkonto bekommt gar kein Kontingent (nicht 0/0, sondern
    // dieselbe 403-Sperre wie beim Upload selbst - konsistent mit requireUserId()).
    const platformToken = app.svc.auth.createToken({ name: 'ohne-login', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
    assert.equal((await call(platformToken, 'GET', '/music-hub/uploads/quota')).status, 403);
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
