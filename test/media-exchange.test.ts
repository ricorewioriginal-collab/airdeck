// Media & Jingle Exchange: Netzwerk-Freigabe (alle Sender) und Bild-/Dokument-Uploads im MusikHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { hubKind } from '../src/server/services/musikhub.ts';

test('hubKind: Audio, Bild, Dokument aus dem MIME-Typ', () => {
  assert.equal(hubKind('audio/mpeg'), 'audio');
  assert.equal(hubKind('image/png'), 'image');
  assert.equal(hubKind('application/pdf'), 'document');
});

test('MusikHub: Netzwerk-Freigabe macht eine Sammlung in jedem Sender sichtbar; Logo-Upload teilbar, aber nicht sendbar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-exchange-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const put = (token: string, path: string, body: Buffer) => fetch(`${base}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body });
  try {
    app.svc.stations.createStation({ id: 'zwei', name: 'Sender Zwei' } as never);
    await app.users.create({ username: 'eigner', password: 'Eigner-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort
    await app.users.create({ username: 'kollege', password: 'Kollege-Passwort1', roles: ['editor'], stationIds: ['zwei'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const owner = await login('eigner', 'Eigner-Passwort1');
    const other = await login('kollege', 'Kollege-Passwort1');

    // Logo hochladen → Art „image“, Vorschau/Download erlaubt, Bereitstellen nicht
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(800, 7)]);
    const up = await put(owner, '/music-hub/uploads?name=Senderlogo.png', png);
    assert.equal(up.status, 200);
    const logo = (await up.json()) as { id: string; kind?: string; title: string };
    assert.equal(logo.kind, 'image');
    assert.equal(logo.title, 'Senderlogo');
    assert.equal((await put(owner, '/music-hub/uploads?name=Virus.exe', png)).status, 415, 'unbekannte Endung');
    assert.equal((await put(owner, '/music-hub/uploads?name=Logo.svg', png)).status, 415, 'SVG abgelehnt (aktiver Inhalt)');
    const stage = await call(owner, 'POST', `/music-hub/items/${logo.id}/stage`, { stationId: 'main' });
    assert.equal(stage.status, 415, 'Bild lässt sich nicht in die Sendung übernehmen');
    const preview = await fetch(`${base}/music-hub/items/${logo.id}/preview?station=main`, { headers: { Authorization: `Bearer ${owner}` } });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');

    // Sammlung mit dem Logo; Kollege im anderen Sender sieht sie erst nach Netzwerk-Freigabe
    const colRes = await call(owner, 'POST', '/music-hub/collections', { owner: { kind: 'user', id: (await call(owner, 'GET', '/me')).body.user.id }, name: 'Jingle-Paket Sommer', stationId: 'main' });
    assert.equal(colRes.status, 200, JSON.stringify(colRes.body));
    const col = colRes.body;
    const setRes = await call(owner, 'PUT', `/music-hub/collections/${col.id}/items`, { itemIds: [logo.id], revision: col.revision, stationId: 'main' });
    assert.equal(setRes.status, 200, JSON.stringify(setRes.body));
    assert.equal((await call(other, 'GET', '/music-hub/items?station=zwei')).body.total, 0);
    assert.equal((await call(other, 'POST', `/music-hub/collection/${col.id}/grants`, { stationId: 'zwei', recipient: { kind: 'station', id: '*' }, targetStationIds: ['*'], actions: ['catalog.read'] })).status, 404, 'Fremde können keine Netzwerk-Freigabe setzen');
    const grant = await call(owner, 'POST', `/music-hub/collection/${col.id}/grants`, { stationId: 'main', recipient: { kind: 'station', id: '*' }, targetStationIds: ['main'], actions: ['catalog.read', 'file.download'] });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.deepEqual(grant.body.targetStationIds, ['*']);
    assert.equal((await call(owner, 'POST', `/music-hub/collection/${col.id}/grants`, { stationId: 'main', recipient: { kind: 'station', id: 'zwei' }, targetStationIds: ['*'], actions: ['catalog.read'] })).status, 400, 'Platzhalter-Ziel nur für das Netzwerk');
    const seen = (await call(other, 'GET', '/music-hub/items?station=zwei')).body;
    assert.equal(seen.total, 1);
    assert.equal(seen.items[0].kind, 'image');
    assert.ok(seen.items[0].actions.includes('file.download'));
    assert.equal((await call(other, 'GET', '/music-hub/collections?station=zwei')).body.length, 1);
    // Ersetzen durch eine Audiodatei: Art wird neu bestimmt
    const rep = await fetch(`${base}/music-hub/items/${logo.id}/replace?station=main&name=Jingle.mp3`, { method: 'PUT', headers: { Authorization: `Bearer ${owner}` }, body: Buffer.alloc(900, 3) });
    assert.equal(rep.status, 200, await rep.clone().text());
    assert.equal(((await rep.json()) as { kind?: string }).kind, undefined, 'wieder Audio');
    assert.equal((await call(other, 'GET', '/music-hub/items?station=zwei')).body.items[0].kind, 'audio', 'Art im Netzwerk neu bestimmt');
    // Widerruf nimmt die Sichtbarkeit sofort
    assert.ok([200, 204].includes((await call(owner, 'DELETE', `/music-hub/grants/${grant.body.id}?station=main`)).status));
    assert.equal((await call(other, 'GET', '/music-hub/items?station=zwei')).body.total, 0);
  } finally {
    app.shutdown();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
