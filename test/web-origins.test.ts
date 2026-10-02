import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { normalizeOrigin } from '../src/server/services/system.ts';

let dir: string;
let app: AnMaChaCastApp;
let server: Server;
let base: string;
let admin: string;
let viewer: string;

async function api(method: string, path: string, body?: unknown, tok = admin) {
  const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

const preflight = (origin: string, pna = true) => fetch(base + '/api/v1/me', {
  method: 'OPTIONS',
  headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization', ...(pna ? { 'Access-Control-Request-Private-Network': 'true' } : {}) },
});

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'anmachacast-origins-'));
  app = new AnMaChaCastApp(dir, { stableMs: 0 });
  admin = app.svc.auth.createToken({ name: 'a', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  viewer = app.svc.auth.createToken({ name: 'v', scopes: ['queue:read'], roles: ['viewer'], stationIds: ['main'] }).token;
  server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(() => {
  app.shutdown();
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('normalizeOrigin: nur reine https-Origins bzw. http für diesen PC', () => {
  assert.equal(normalizeOrigin('https://control.example.org'), 'https://control.example.org');
  assert.equal(normalizeOrigin('https://control.example.org/'), 'https://control.example.org');
  assert.equal(normalizeOrigin('https://Control.Example.org:8443'), 'https://control.example.org:8443');
  assert.equal(normalizeOrigin('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(normalizeOrigin('http://example.org'), null);
  assert.equal(normalizeOrigin('https://example.org/pfad'), null);
  assert.equal(normalizeOrigin('https://user:pw@example.org'), null);
  assert.equal(normalizeOrigin('kein-link'), null);
});

test('fremde Webseite wird ohne Freigabe abgewiesen', async () => {
  const r = await preflight('https://control.example.org');
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('freigegebene Webseite darf zugreifen, inkl. Freigabe für lokale Netzadressen', async () => {
  const put = await api('PUT', '/api/v1/app/origins', { webOrigins: ['https://control.example.org/', 'https://control.example.org'] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.webOrigins, ['https://control.example.org']);
  const r = await preflight('https://control.example.org');
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://control.example.org');
  assert.equal(r.headers.get('access-control-allow-private-network'), 'true');
  const plain = await preflight('https://control.example.org', false);
  assert.equal(plain.headers.get('access-control-allow-private-network'), null);
  // echte Anfrage mit Token aus dem Browser
  const me = await fetch(base + '/api/v1/me', { headers: { Origin: 'https://control.example.org', Authorization: `Bearer ${admin}` } });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('access-control-allow-origin'), 'https://control.example.org');
  assert.deepEqual((await api('GET', '/api/v1/app/origins')).body, { webOrigins: ['https://control.example.org'] });
});

test('ungültige Webseiten und Nicht-Admins werden abgelehnt', async () => {
  assert.equal((await api('PUT', '/api/v1/app/origins', { webOrigins: ['http://example.org'] })).status, 400);
  assert.equal((await api('PUT', '/api/v1/app/origins', { webOrigins: ['https://example.org/x'] })).status, 400);
  assert.equal((await api('PUT', '/api/v1/app/origins', { webOrigins: ['https://neu.example.org'] }, viewer)).status, 403);
  assert.equal((await api('GET', '/api/v1/app/origins', undefined, viewer)).status, 403);
  assert.deepEqual((await api('GET', '/api/v1/app/origins')).body.webOrigins, ['https://control.example.org']);
});

test('LAN-Schalter überschreibt die Freigaben nicht, Freigabe übersteht Neustart', async () => {
  assert.equal((await api('PUT', '/api/v1/app/network', { lan: true })).status, 200);
  assert.deepEqual(app.svc.system.webOrigins(), ['https://control.example.org']);
  const again = new AnMaChaCastApp(dir, { stableMs: 0 });
  try {
    assert.equal(again.svc.system.isWebOrigin('https://control.example.org'), true);
    assert.equal(again.svc.system.isWebOrigin('https://andere.example.org'), false);
  } finally {
    again.shutdown();
  }
});

test('leere Liste entzieht die Freigabe sofort', async () => {
  assert.deepEqual((await api('PUT', '/api/v1/app/origins', { webOrigins: [] })).body, { webOrigins: [] });
  assert.equal((await preflight('https://control.example.org')).status, 403);
});
