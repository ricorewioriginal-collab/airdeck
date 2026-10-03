// Verbreitung: bis zu 2 eigene Streams auf dem eigenen Icecast (Profil + Ausgang in einem Schritt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('Eigene Streams: Voraussetzung, Anlegen mit Bitrate und Link, Limit 2, Ändern, Löschen räumt auf', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-own-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const token = app.svc.auth.createToken({ name: 'admin', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const call = async (method: string, path: string, body?: unknown, tok = token) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    // ohne eigenen Icecast kein Anlegen; laut.fm zählt nicht als eigener Server
    assert.equal((await call('GET', '/stations/main/own-streams')).body.source, null);
    assert.equal((await call('POST', '/stations/main/own-streams', { name: 'Mobil', format: 'aac', bitrateKbps: 64 })).status, 409);
    await call('POST', '/stations/main/outputs', { name: 'laut.fm', type: 'icecast', host: 'stream.laut.fm', port: 80, mount: '/x', username: 'source', password: 'pw-laut', sourceTarget: '/live' });
    assert.equal((await call('POST', '/stations/main/own-streams', { name: 'Mobil', format: 'aac', bitrateKbps: 64 })).body.error, 'no_icecast');

    await call('POST', '/stations/main/outputs', { name: 'Haupt-Stream', type: 'icecast', host: 'radio.example.org', port: 8000, mount: '/main', username: 'source', password: 'secret-1234', sourceTarget: '/live' });
    // ein pausierter Hauptstream bleibt Quelle für Server und Zugang
    const mainId = (await call('GET', '/stations/main/outputs')).body.find((o: { host: string }) => o.host === 'radio.example.org').id as string;
    await call('PATCH', `/stations/main/outputs/${mainId}`, { enabled: false });
    assert.equal((await call('GET', '/stations/main/own-streams')).body.source.host, 'radio.example.org');
    await call('PATCH', `/stations/main/outputs/${mainId}`, { enabled: true });
    const a = await call('POST', '/stations/main/own-streams', { name: 'Mobil Sparsam', format: 'aac', bitrateKbps: 64 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.mount, '/mobil-sparsam');
    assert.equal(a.body.bitrateKbps, 64);
    assert.equal(a.body.link, 'http://radio.example.org:8000/mobil-sparsam');
    assert.equal(app.secrets.get((await call('GET', '/stations/main/outputs')).body.find((o: { id: string }) => o.id === a.body.id) ? `output:${a.body.id}` : ''), 'secret-1234', 'Zugang vom Hauptstream übernommen');
    const b = await call('POST', '/stations/main/own-streams', { name: 'Mobil Sparsam', format: 'aac', bitrateKbps: 96 });
    assert.equal(b.body.mount, '/mobil-sparsam-2', 'gleicher Name → eindeutiger Mount');
    const c = await call('POST', '/stations/main/own-streams', { name: 'Dritter', format: 'aac', bitrateKbps: 32 });
    assert.equal(c.status, 409, 'Limit 2');
    assert.equal(c.body.error, 'limit');
    assert.equal((await call('POST', '/stations/main/own-streams', { name: 'x', format: 'aac', bitrateKbps: 9999 }, token)).status, 409, 'Limit gilt vor der Bitrate-Prüfung');

    // Ändern: Bitrate und Name im Profil und Ausgang
    const u = await call('PATCH', `/stations/main/own-streams/${a.body.id}`, { name: 'Mobil 48', bitrateKbps: 48 });
    assert.equal(u.status, 200);
    assert.equal(u.body.bitrateKbps, 48);
    assert.equal(u.body.name, 'Mobil 48');
    assert.equal((await call('PATCH', `/stations/main/own-streams/${a.body.id}`, { bitrateKbps: 5 })).status, 400, 'Bitrate 32-320');
    const off = await call('PATCH', `/stations/main/own-streams/${a.body.id}`, { enabled: false });
    assert.equal(off.body.enabled, false);

    // normaler Hauptstream bleibt unberührt und zählt nicht
    const listed = (await call('GET', '/stations/main/own-streams')).body;
    assert.equal(listed.items.length, 2);
    assert.equal(listed.source.host, 'radio.example.org');
    assert.equal((await call('GET', '/stations/main/outputs')).body.length, 4);

    // Löschen entfernt Ausgang und Profil; danach ist wieder Platz
    assert.equal((await call('DELETE', `/stations/main/own-streams/${a.body.id}`)).status, 200);
    assert.equal((await call('GET', '/stations/main/own-streams')).body.items.length, 1);
    assert.equal((await call('GET', '/stations/main/stream-profiles')).body.length, 1, 'Profil mit aufgeräumt');
    assert.equal((await call('DELETE', `/stations/main/own-streams/${a.body.id}`)).status, 404);
    assert.equal((await call('DELETE', `/stations/main/own-streams/${(await call('GET', '/stations/main/outputs')).body[0].id}`)).status, 404, 'normale Ausgänge sind hier nicht löschbar');
    assert.equal((await call('POST', '/stations/main/own-streams', { name: 'Neu', format: 'aac', bitrateKbps: 128 })).status, 200);

    // Lesen darf ein Leser, Anlegen nicht
    const reader = app.svc.auth.createToken({ name: 'r', scopes: ['outputs:read'], roles: ['viewer'], stationIds: ['*'] }).token;
    assert.equal((await call('GET', '/stations/main/own-streams', undefined, reader)).status, 200);
    assert.equal((await call('POST', '/stations/main/own-streams', { name: 'x' }, reader)).status, 403);
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
