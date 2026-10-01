import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { parseLinkCode } from '../src/server/services/remote-link.ts';

let dir: string;
let app: AirDeckApp;
let server: Server;
let base: string;
let admin: string;
let hub: Server;
let hubBase: string;

// Nachgebauter Vermittler: ein Agent-Strom, Antworten per rid, Ereignisse sammeln
const KEY = 'k'.repeat(40);
let acceptKey = KEY;
let agent: ServerResponse | null = null;
const replies = new Map<string, (v: { status: number; body: unknown }) => void>();
const events: { type: string; stationId?: string }[] = [];
const agentHeaders: Record<string, string>[] = [];
const AUDIO = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4096, 7)]);
let uploaded: Buffer | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timeout');
    await wait(20);
  }
}
async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
const code = (k = KEY) => 'adl1.' + Buffer.from(JSON.stringify({ h: `${hubBase}/golive-relay`, l: 'testlink01', k, n: 'Studio-PC' })).toString('base64url');
let rid = 0;
function ask(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const id = 'r' + ++rid;
  return new Promise((ok, fail) => {
    replies.set(id, ok);
    agent!.write(`event: req\ndata: ${JSON.stringify({ rid: id, method, path, body, ...extra })}\n\n`);
    setTimeout(() => fail(new Error('keine Antwort')), 5000);
  });
}

before(async () => {
  hub = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const action = u.searchParams.get('action');
    if (u.searchParams.get('link') !== 'testlink01' || req.headers['x-link-key'] !== acceptKey) return void res.writeHead(401).end();
    if (action === 'adl_agent') {
      agentHeaders.push(req.headers as Record<string, string>);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': hallo\n\n');
      agent = res;
      req.on('close', () => { if (agent === res) agent = null; });
      return;
    }
    if (action === 'adl_file') return void res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': AUDIO.length }).end(AUDIO);
    if (action === 'adl_upload') {
      const parts: Buffer[] = [];
      req.on('data', (d) => parts.push(d));
      req.on('end', () => { uploaded = Buffer.concat(parts); res.writeHead(204).end(); });
      return;
    }
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const b = JSON.parse(raw || 'null');
      if (action === 'adl_reply') replies.get(b.rid)?.({ status: b.status, body: b.body });
      if (action === 'adl_events') events.push(...b);
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r));
  hubBase = `http://127.0.0.1:${(hub.address() as { port: number }).port}`;

  dir = mkdtempSync(join(tmpdir(), 'airdeck-remote-'));
  app = new AirDeckApp(dir, { stableMs: 0 });
  admin = app.svc.auth.createToken({ name: 'a', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  app.listenHost = '127.0.0.1';
  app.listenPort = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${app.listenPort}`;
});

after(() => {
  app.shutdown();
  server.closeAllConnections();
  server.close();
  hub.closeAllConnections();
  hub.close();
  rmSync(dir, { recursive: true, force: true });
});

test('Verbindungscode: nur gültige Codes mit https-Vermittler (http nur lokal)', () => {
  const mk = (o: object) => 'adl1.' + Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal(parseLinkCode(mk({ h: 'https://control.example.org/golive-relay', l: 'abcdefgh12', k: KEY })).hub, 'https://control.example.org/golive-relay');
  assert.throws(() => parseLinkCode(mk({ h: 'http://control.example.org/x', l: 'abcdefgh12', k: KEY })), /https/);
  assert.throws(() => parseLinkCode(mk({ h: 'https://x.org', l: 'AB', k: KEY })), /unvollständig/);
  assert.throws(() => parseLinkCode('kein-code'), /adl1/);
});

test('Einrichten: AirDeck verbindet sich selbst mit dem Vermittler', async () => {
  const r = await api('PUT', '/api/v1/app/remote-link', { code: code(), role: 'operator' });
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, true);
  assert.equal(r.body.role, 'operator');
  assert.equal(JSON.stringify(r.body).includes(KEY), false, 'Schlüssel nie in der API');
  await until(() => !!agent && app.svc.remoteLink.view().state === 'online');
  assert.equal(agentHeaders.at(-1)?.['x-link-key'], KEY);
  // eigenes Geräte-Token, sichtbar und widerrufbar
  assert.ok(app.svc.devices.list().some((d) => d.name === 'Fernzugriff: Studio-PC' && d.roles.includes('operator')));
});

test('Vermittelte Anfragen laufen mit den Rechten des Fernzugriffs', async () => {
  const st = await ask('GET', '/api/v1/stations');
  assert.equal(st.status, 200);
  assert.ok(Array.isArray(st.body) && st.body.some((s: { id: string }) => s.id === 'main'));
  const mode = await ask('PUT', '/api/v1/stations/main/mode', { mode: 'MANUAL' });
  assert.equal(mode.status, 200);
  // operator darf keine Benutzer anlegen, und Einstellungen/Anmeldung sind über den Vermittler gesperrt
  assert.equal((await ask('GET', '/api/v1/users')).status, 403);
  assert.equal((await ask('GET', '/api/v1/app/remote-link')).status, 403);
  assert.equal((await ask('POST', '/api/v1/auth/login', { username: 'x', password: 'y' })).status, 403);
  assert.equal((await ask('GET', '/api/v1/../health')).status, 403);
});

test('Dateien: holen und liefern nur über den Vermittler', async () => {
  const hubUrl = (a: string) => `${hubBase}/golive-relay?action=${a}&link=testlink01`;
  const put = await ask('PUT', '/api/v1/stations/main/media?name=' + encodeURIComponent('Künstler - Lied.mp3'), undefined, { pull: hubUrl('adl_file') });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.artist, 'Künstler');
  assert.equal(put.body.title, 'Lied');
  const got = await ask('GET', `/api/v1/stations/main/media/${put.body.id}/file`, undefined, { push: hubUrl('adl_upload') });
  assert.equal(got.status, 200);
  assert.deepEqual(uploaded, AUDIO);
  // fremde Adressen und falsche Methoden sind gesperrt
  assert.equal((await ask('PUT', '/api/v1/stations/main/media?name=x.mp3', undefined, { pull: 'http://example.org/datei.mp3' })).status, 403);
  assert.equal((await ask('POST', '/api/v1/stations/main/media?name=x.mp3', undefined, { pull: hubUrl('adl_file') })).status, 403);
  assert.equal((await ask('GET', '/api/v1/users', undefined, { push: hubUrl('adl_upload') })).status, 403);
});

test('Inhaltsänderungen werden ohne Datenlast gemeldet', async () => {
  events.length = 0;
  await api('POST', '/api/v1/stations/main/playlists', { name: 'Abgleich' });
  await until(() => events.some((e) => e.type === 'playlists.changed'));
  assert.equal((events.find((e) => e.type === 'playlists.changed') as { payload?: unknown }).payload, null);
});

test('Live-Ereignisse gehen gebündelt an den Vermittler', async () => {
  events.length = 0;
  await api('PUT', '/api/v1/stations/main/mode', { mode: 'AUTO' });
  await until(() => events.some((e) => e.type === 'MODE_CHANGED' && e.stationId === 'main'));
  assert.equal(events.some((e) => e.type === 'playout.level'), false, 'Pegel nicht über den Vermittler');
});

test('Abgelehnter Schlüssel: verständlicher Fehler statt Dauerschleife', async () => {
  acceptKey = 'anders'.repeat(8);
  agent?.end();
  await until(() => app.svc.remoteLink.view().state === 'error');
  assert.match(String(app.svc.remoteLink.view().error), /abgelehnt|nicht erreichbar/);
  acceptKey = KEY;
});

test('Entfernen trennt und widerruft das Geräte-Token', async () => {
  const before = app.svc.devices.list().filter((d) => d.name.startsWith('Fernzugriff')).length;
  assert.equal(before, 1);
  const r = await api('DELETE', '/api/v1/app/remote-link');
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.equal(app.svc.devices.list().filter((d) => d.name.startsWith('Fernzugriff')).length, 0);
  assert.equal(app.secrets.get('remote-link:key'), undefined);
});
