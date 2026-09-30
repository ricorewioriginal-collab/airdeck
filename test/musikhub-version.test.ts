// MusikHub Phase 2: Quellen-/Versionsmodell für private Uploads. Ersetzen einer bestehenden
// Upload-Datei behält Item-ID, Eigentümer, Sammlungsmitgliedschaften und Freigaben - nur die
// zugrundeliegende Datei, die Version und die Revision wechseln. Nur der Eigentümer selbst darf
// ersetzen, auch ein per Grant delegiertes `source.write` genügt dafür nicht (dieselbe Regel wie
// beim Löschen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('MusikHub: Quellen-/Versionsmodell - Ersetzen einer privaten Upload-Datei', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-version-test-'));
  const app = new AirDeckApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const put = (token: string, path: string, body: Buffer) => fetch(`${base}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body });
  try {
    app.svc.stations.createStation({ id: 'b', name: 'Sender B' });
    app.svc.media.addMedia('main', { id: 'song', title: 'Abendshow', artist: 'Test', category: 'music', file: 'song.mp3', durationMs: 3000, addedAt: Date.now() });
    const owner = await app.users.create({ username: 'version', password: 'Version-Passwort1', roles: ['editor'], stationIds: ['main', 'b'], mustChangePassword: false });
    const stranger = await app.users.create({ username: 'fremd2', password: 'Fremd2-Passwort1', roles: ['editor'], stationIds: ['b'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('version', 'Version-Passwort1');
    const ts = await login('fremd2', 'Fremd2-Passwort1');

    // Sendermedium katalogisieren - dient als Gegenprobe: Senderreferenzen lassen sich nicht "ersetzen".
    const stationItem = await call(to, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'song' });
    assert.equal(stationItem.status, 200);
    const stationReplace = await put(to, `/music-hub/items/${stationItem.body.id}/replace?station=main&name=neu.mp3`, Buffer.from('x'));
    assert.equal(stationReplace.status, 400, 'Senderreferenzen haben keine ersetzbare eigene Quelldatei');

    // Eigenen privaten Titel anlegen.
    const original = Buffer.from(Array.from({ length: 2000 }, (_, i) => i % 256));
    const upRes = await put(to, '/music-hub/uploads?name=Original.mp3', original);
    assert.equal(upRes.status, 200);
    const item = await upRes.json() as { id: string; version: string | null; revision: number; source: { file: string; sizeBytes: number } };
    assert.equal(item.version, null, 'erste Version trägt noch kein Versionslabel');
    const originalFile = item.source.file;
    const uploadDir = join(dir, 'musikhub', 'uploads', owner.id);
    assert.ok(existsSync(join(uploadDir, originalFile)));

    // In eine eigene (persönliche) Sammlung aufnehmen und teilen - muss das Ersetzen unbeschadet
    // überstehen. Eine Sender-Sammlung wäre hier falsch: Sammlung und Titel brauchen denselben
    // Eigentümer, ein privater Upload gehört aber dem Nutzer, nicht dem Sender.
    const collection = await call(to, 'POST', '/music-hub/collections', { owner: { kind: 'user', id: owner.id }, name: 'Versionstest' });
    assert.equal((await call(to, 'PUT', `/music-hub/collections/${collection.body.id}/items`, { stationId: 'main', itemIds: [item.id], revision: 1 })).status, 200);
    const grant = await call(to, 'POST', `/music-hub/item/${item.id}/grants`, { stationId: 'main', recipient: { kind: 'user', id: stranger.id }, actions: ['catalog.read', 'preview.play'], targetStationIds: ['b'] });
    assert.equal(grant.status, 200);

    // Eine Freigabe, die zusätzlich `source.write` delegiert, genügt trotzdem nicht - nur der
    // tatsächliche Eigentümer darf ersetzen (dieselbe Regel wie beim Löschen).
    const writeGrant = await call(to, 'POST', `/music-hub/item/${item.id}/grants`, { stationId: 'main', recipient: { kind: 'user', id: stranger.id }, actions: ['catalog.read', 'source.write'], targetStationIds: ['b'] });
    assert.equal(writeGrant.status, 200);
    const strangerReplace = await put(ts, `/music-hub/items/${item.id}/replace?station=b&name=fremd.mp3`, Buffer.from('y'));
    assert.equal(strangerReplace.status, 403, 'delegiertes source.write ersetzt keine Eigentümerschaft');
    assert.equal((await call(to, 'DELETE', `/music-hub/grants/${writeGrant.body.id}?station=main`)).status, 204);

    // Ohne jedes Recht: 404, keine Existenz-Leckage.
    const noGrantUser = await app.users.create({ username: 'ohnegrant', password: 'Ohnegrant-Passwort1', roles: ['editor'], stationIds: ['b'], mustChangePassword: false });
    const tn = await login('ohnegrant', 'Ohnegrant-Passwort1');
    assert.equal((await put(tn, `/music-hub/items/${item.id}/replace?station=b&name=x.mp3`, Buffer.from('z'))).status, 404);
    void noGrantUser;

    // Nicht unterstützter Dateityp wird vor jedem Schreiben abgelehnt.
    assert.equal((await put(to, `/music-hub/items/${item.id}/replace?station=main&name=schadcode.exe`, Buffer.from('x'))).status, 415);

    // Eigentümer ersetzt erfolgreich: neue Bytes, Version/Revision hoch, alte Datei physisch weg.
    const replacement = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 3) % 256));
    const replaceRes = await put(to, `/music-hub/items/${item.id}/replace?station=main&name=Version2.mp3`, replacement);
    assert.equal(replaceRes.status, 200);
    const replaced = await replaceRes.json() as { id: string; version: string; revision: number; source: { file: string; sizeBytes: number } };
    assert.equal(replaced.id, item.id, 'Item-ID bleibt beim Ersetzen unverändert');
    assert.equal(replaced.version, '2');
    assert.equal(replaced.revision, item.revision + 1);
    assert.equal(replaced.source.sizeBytes, replacement.length);
    assert.equal(existsSync(join(uploadDir, originalFile)), false, 'alte Datei wird beim Ersetzen entfernt');
    assert.ok(existsSync(join(uploadDir, replaced.source.file)));
    const filesAfterReplace = readdirSync(uploadDir);
    assert.equal(filesAfterReplace.length, 1, 'kein Datei-Fragment bleibt zurück');

    // Byte-exakter Abruf der neuen Version über den bestehenden Vorhör-Pfad.
    const preview = await fetch(`${base}/music-hub/items/${item.id}/preview?station=main`, { headers: { Authorization: `Bearer ${to}` } });
    assert.equal(preview.status, 200);
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), new Uint8Array(replacement));

    // Sammlungsmitgliedschaft und Freigabe wirken unverändert weiter (dieselbe Item-ID).
    assert.equal((await call(to, 'GET', `/music-hub/collections?station=main`)).body[0].itemIds.includes(item.id), true);
    const grantedPreview = await fetch(`${base}/music-hub/items/${item.id}/preview?station=b`, { headers: { Authorization: `Bearer ${ts}` } });
    assert.equal(grantedPreview.status, 200, 'bestehende Freigabe gilt unverändert für die neue Version');

    // Kontingent zählt nur die aktuelle Datei, nicht die alte zusätzlich.
    const quota = await call(to, 'GET', '/music-hub/uploads/quota');
    assert.equal(quota.body.usedBytes, replacement.length);

    // Zweites Ersetzen zählt die Version weiter hoch.
    const secondReplace = await put(to, `/music-hub/items/${item.id}/replace?station=main&name=Version3.mp3`, Buffer.from('z'));
    assert.equal(secondReplace.status, 200);
    assert.equal((await secondReplace.json() as { version: string }).version, '3');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
