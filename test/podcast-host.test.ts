// Öffentlicher Podcast-Link: eigene Basis-Adresse im Feed, Erreichbarkeitsprüfung und Upload zu Buzzsprout/Podbean
// (mit nachgebautem fetch, ohne Netz). Prüft Ablauf, Zugangsdaten-Schutz und Fehlerfälle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { newId } from '../src/server/model.ts';
import type { Recording } from '../src/server/model.ts';
import { isPrivateHost, normalizeBase } from '../src/server/services/podcast-host.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-podhost-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const recDir = join(dir, 'recordings', 'main');
  mkdirSync(recDir, { recursive: true });
  const bytes = Buffer.from('fake-mp3-data-1234567890');
  writeFileSync(join(recDir, 'r1.mp3'), bytes);
  const rec: Recording = { id: newId('rec'), label: 'Show', startedAt: Date.now() - 60_000, endedAt: Date.now(), bytes: bytes.length, contentType: 'audio/mpeg', file: 'r1.mp3' };
  (app.rt('main').data.recordings ??= []).push(rec);
  const ep = app.svc.podcast.createEpisode('main', rec.id, { title: 'Folge 1', description: 'Notizen' });
  return { app, ep, bytes };
}

type Call = { method: string; url: string; headers: Record<string, string>; body: string };

/** Antwortet nach Pfad-Teilen; zeichnet Aufrufe auf. */
function fakeFetch(routes: Array<[RegExp, (c: Call) => unknown | { status: number; json: unknown }]>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = init.body instanceof Blob ? `<blob ${init.body.size}>` : init.body ? String(init.body) : '';
    const call: Call = { method: init.method ?? 'GET', url, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body };
    calls.push(call);
    for (const [re, handler] of routes) {
      if (!re.test(`${call.method} ${url}`)) continue;
      const out = handler(call) as { status?: number; json?: unknown; text?: string };
      const status = out && typeof out === 'object' && 'status' in out ? out.status! : 200;
      const payload = out && typeof out === 'object' && 'status' in out ? (out.json ?? out.text ?? '') : out;
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
      return new Response(text, { status });
    }
    return new Response('{"error":"unrouted"}', { status: 599 });
  }) as typeof fetch;
  return { fn, calls };
}

test('normalizeBase und isPrivateHost', () => {
  assert.equal(normalizeBase(' https://Radio.Example.de/ '), 'https://radio.example.de');
  assert.equal(normalizeBase('radio.example.de/cast/?x=1#y'), 'https://radio.example.de/cast');
  assert.equal(normalizeBase(''), undefined);
  assert.throws(() => normalizeBase('ftp://x.de'), /https/);
  assert.throws(() => normalizeBase('https://user:pw@x.de'), /Zugangsdaten/);
  for (const h of ['localhost', '127.0.0.1', '192.168.1.5', '10.0.0.2', '172.20.1.1', 'nas', 'drucker.local', '[::1]', '100.100.1.1']) assert.ok(isPrivateHost(h), h);
  for (const h of ['radio.example.de', '8.8.8.8', 'x.ts.net']) assert.ok(!isPrivateHost(h), h);
});

test('Öffentliche Basis-Adresse steht in Feed, Enclosure und Übersicht', () => {
  const { app, ep } = setup();
  app.svc.podcast.updateEpisode('main', ep.id, { published: true });
  app.svc.podcast.saveConfig('main', { publicBaseUrl: 'https://radio.example.de/' });
  const xml = app.svc.podcast.feedXml('main', 'http://127.0.0.1:8080');
  assert.ok(xml.includes('https://radio.example.de/api/v1/public/stations/main/podcast/episodes/'));
  assert.ok(!xml.includes('127.0.0.1'));
  assert.equal(app.svc.podcast.overview('main').feedUrl, 'https://radio.example.de/api/v1/public/stations/main/podcast.xml');
  // Weitere Einstellungen ändern die Adresse nicht; leeres Feld entfernt sie
  app.svc.podcast.saveConfig('main', { title: 'Neu' });
  assert.equal(app.svc.podcast.config('main').publicBaseUrl, 'https://radio.example.de');
  app.svc.podcast.saveConfig('main', { publicBaseUrl: '' });
  assert.equal(app.svc.podcast.config('main').publicBaseUrl, undefined);
  assert.throws(() => app.svc.podcast.saveConfig('main', { publicBaseUrl: 'ftp://x' }));
});

test('Erreichbarkeitsprüfung: lokal, erreichbar, falsche Seite, nicht erreichbar', async () => {
  const { app } = setup();
  const host = app.svc.podcastHost;
  await assert.rejects(host.check('main'), /öffentliche Adresse/);
  app.svc.podcast.saveConfig('main', { publicBaseUrl: 'http://192.168.0.5:8080' });
  const lan = await host.check('main');
  assert.equal(lan.ok, false);
  assert.match(lan.message, /nur im eigenen Netz/);
  app.svc.podcast.saveConfig('main', { publicBaseUrl: 'https://radio.example.de' });
  host.fetchFn = fakeFetch([[/radio\.example\.de/, () => '<?xml version="1.0"?><rss version="2.0"></rss>']]).fn;
  const ok = await host.check('main');
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://radio.example.de/api/v1/public/stations/main/podcast.xml');
  host.fetchFn = fakeFetch([[/./, () => '<html>Willkommen</html>']]).fn;
  assert.match((await host.check('main')).message, /keinen Podcast-Feed/);
  host.fetchFn = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
  assert.match((await host.check('main')).message, /ECONNREFUSED/);
});

test('Buzzsprout: Episode anlegen, Datei hochladen, abschließen, veröffentlichen', async () => {
  const { app, ep } = setup();
  const host = app.svc.podcastHost;
  app.svc.podcast.updateEpisode('main', ep.id, { published: true });
  host.opts = { pollMs: 1, maxPolls: 5 };
  let polls = 0;
  const { fn, calls } = fakeFetch([
    [/POST .*\/api\/42\/episodes$/, () => ({ id: 777, title: 'Folge 1' })],
    [/POST .*\/episodes\/777\/uploads$/, () => ({ upload: { id: 'up/1', multipart: false, upload_url: 'https://uploads.example.com/put?sig=1' } })],
    [/PUT https:\/\/uploads\.example\.com/, () => ({})],
    [/POST .*\/uploads\/up%2F1\/complete$/, () => ({ id: 777 })],
    [/GET .*\/episodes\/777$/, () => ({ id: 777, audio_url: 'https://www.buzzsprout.com/42/777.mp3', duration: ++polls < 2 ? -1 : 61 })],
    [/PATCH .*\/episodes\/777$/, () => ({ id: 777, private: false })],
  ]);
  host.fetchFn = fn;
  // Zugangsdaten fehlen -> klare Meldung
  assert.throws(() => host.save('main', { kind: 'buzzsprout', podcastId: '42' }), /API-Token/);
  assert.throws(() => host.save('main', { kind: 'buzzsprout', podcastId: 'abc', token: 't' }), /Ziffern/);
  host.save('main', { kind: 'buzzsprout', podcastId: '42', token: 'geheim-token' });
  const view = app.svc.podcast.overview('main');
  assert.equal(view.host?.feedUrl, 'https://feeds.buzzsprout.com/42.rss');
  assert.equal(view.host?.hasCredentials, true);
  assert.ok(!JSON.stringify(view).includes('geheim-token'), 'Token verlässt den Secret-Store nie');

  const done = await host.push('main', ep.id);
  assert.equal(done.hosted?.kind, 'buzzsprout');
  assert.equal(done.hosted?.id, '777');
  const create = JSON.parse(calls[0]!.body);
  assert.equal(create.private, true);
  assert.equal(create.title, 'Folge 1');
  assert.equal(calls[0]!.headers.Authorization, 'Token token=geheim-token');
  const start = JSON.parse(calls[1]!.body);
  assert.equal(start.byte_size, 24);
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.body, '<blob 24>');
  assert.equal(put.headers.Authorization, undefined, 'Upload-URL bekommt keinen Buzzsprout-Token');
  assert.deepEqual(JSON.parse(calls.at(-1)!.body), { private: false });
  // Doppelter Upload wird abgelehnt
  await assert.rejects(host.push('main', ep.id), /Schon bei Buzzsprout/);
  // Token bleibt beim Wechsel der ID erhalten
  host.save('main', { kind: 'buzzsprout', podcastId: '43' });
  assert.equal(app.svc.podcast.config('main').host?.feedUrl, 'https://feeds.buzzsprout.com/43.rss');
});

test('Buzzsprout: Entwurf bleibt privat, Fehler beim Upload bricht ab und räumt auf', async () => {
  const { app, ep } = setup();
  const host = app.svc.podcastHost;
  host.opts = { pollMs: 1, maxPolls: 2 };
  host.save('main', { kind: 'buzzsprout', podcastId: '42', token: 't' });
  const ok = fakeFetch([
    [/POST .*\/api\/42\/episodes$/, () => ({ id: 5 })],
    [/POST .*\/episodes\/5\/uploads$/, () => ({ upload: { id: 'u', multipart: false, upload_url: 'https://up.example.com/x' } })],
    [/PUT /, () => ({})],
    [/complete$/, () => ({})],
    [/GET .*\/episodes\/5$/, () => ({ id: 5, duration: 30 })],
  ]);
  host.fetchFn = ok.fn;
  const r = await host.push('main', ep.id); // lokal Entwurf -> privat bei Buzzsprout
  assert.equal(r.hosted?.id, '5');
  assert.ok(!ok.calls.some((c) => c.method === 'PATCH'), 'Entwurf wird nicht veröffentlicht');

  const { app: app2, ep: ep2 } = setup();
  const host2 = app2.svc.podcastHost;
  host2.save('main', { kind: 'buzzsprout', podcastId: '42', token: 't' });
  const bad = fakeFetch([
    [/POST .*\/api\/42\/episodes$/, () => ({ id: 6 })],
    [/POST .*\/episodes\/6\/uploads$/, () => ({ upload: { id: 'u2', multipart: false, upload_url: 'https://up.example.com/y' } })],
    [/PUT /, () => ({ status: 403, json: { error: 'expired' } })],
    [/abort$/, () => ({ status: 204, text: '' })],
  ]);
  host2.fetchFn = bad.fn;
  await assert.rejects(host2.push('main', ep2.id), /HTTP 403/);
  assert.ok(bad.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/uploads/u2/abort')), 'Upload wird abgebrochen');
  assert.equal(app2.rt('main').data.episodes?.[0]?.hosted, undefined, 'nichts als hochgeladen vermerkt');
  // Zweiter Versuch ist wieder möglich
  host2.fetchFn = fakeFetch([[/./, () => ({ status: 401, json: { error: { message: 'bad token' } } })]]).fn;
  await assert.rejects(host2.push('main', ep2.id), /Zugangsdaten prüfen/);
});

test('Podbean: Token, Upload-Freigabe, PUT, Episode veröffentlichen', async () => {
  const { app, ep } = setup();
  const host = app.svc.podcastHost;
  app.svc.podcast.updateEpisode('main', ep.id, { published: true });
  const { fn, calls } = fakeFetch([
    [/POST .*\/oauth\/token$/, () => ({ access_token: 'tok123', expires_in: 604800 })],
    [/GET .*\/files\/uploadAuthorize/, () => ({ presigned_url: 'https://s3.example.com/up?sig', file_key: 'key-1', expire_at: 1 })],
    [/PUT https:\/\/s3\.example\.com/, () => ({})],
    [/POST .*\/episodes$/, () => ({ episode: { id: 'pb9', permalink_url: 'https://x.podbean.com/e/folge-1' } })],
  ]);
  host.fetchFn = fn;
  assert.throws(() => host.save('main', { kind: 'podbean' }), /Client-ID/);
  assert.throws(() => host.save('main', { kind: 'podbean', clientId: 'a', clientSecret: 'b', feedUrl: 'kein-feed://' }), /https/);
  host.save('main', { kind: 'podbean', clientId: 'cid', clientSecret: 'sec', feedUrl: 'https://feed.podbean.com/mein/feed.xml' });
  assert.equal(app.svc.podcast.config('main').host?.feedUrl, 'https://feed.podbean.com/mein/feed.xml');
  assert.deepEqual(await host.test('main'), { ok: true, message: 'Verbunden mit Podbean' });
  const done = await host.push('main', ep.id);
  assert.equal(done.hosted?.id, 'pb9');
  assert.equal(done.hosted?.url, 'https://x.podbean.com/e/folge-1');
  assert.equal(calls[0]!.headers.Authorization, `Basic ${Buffer.from('cid:sec').toString('base64')}`);
  const authorize = calls.find((c) => c.url.includes('uploadAuthorize'))!;
  assert.ok(authorize.url.includes('filesize=24') && authorize.url.includes('content_type=audio%2Fmpeg'));
  const create = new URLSearchParams(calls.at(-1)!.body);
  assert.equal(create.get('status'), 'publish');
  assert.equal(create.get('media_key'), 'key-1');
  assert.equal(create.get('access_token'), 'tok123');
  assert.equal(calls.find((c) => c.method === 'PUT')!.headers.Authorization, undefined);
});

test('Hoster entfernen löscht Zugangsdaten; ohne Hoster kein Upload', async () => {
  const { app, ep } = setup();
  const host = app.svc.podcastHost;
  await assert.rejects(host.push('main', ep.id), /Kein Hoster/);
  host.save('main', { kind: 'buzzsprout', podcastId: '1', token: 't' });
  assert.ok(app.secrets.has('podcast-host:main'));
  assert.equal(host.save('main', { kind: '' }), null);
  assert.ok(!app.secrets.has('podcast-host:main'));
  assert.equal(app.svc.podcast.overview('main').host, null);
  assert.throws(() => host.save('main', { kind: 'spotify' }), /buzzsprout/);
  await assert.rejects(host.push('main', 'ep_gibtsnicht'), /Kein Hoster|nicht gefunden/);
});

test('Auto-Upload nach automatisch veröffentlichter Episode', async () => {
  const { app } = setup();
  const host = app.svc.podcastHost;
  app.svc.podcast.saveConfig('main', { auto: { enabled: true, publish: true } });
  host.save('main', { kind: 'podbean', clientId: 'c', clientSecret: 's', autoPush: true });
  const { fn, calls } = fakeFetch([
    [/oauth\/token/, () => ({ access_token: 't' })],
    [/uploadAuthorize/, () => ({ presigned_url: 'https://s3.example.com/u', file_key: 'k' })],
    [/PUT /, () => ({})],
    [/POST .*\/episodes$/, () => ({ episode: { id: 'e1' } })],
  ]);
  host.fetchFn = fn;
  const recDir = join(app.dataDir, 'recordings', 'main');
  writeFileSync(join(recDir, 'r2.mp3'), 'abcdef');
  const rec: Recording = { id: newId('rec'), label: 'Auto', startedAt: Date.now() - 120_000, endedAt: Date.now(), bytes: 6, contentType: 'audio/mpeg', file: 'r2.mp3' };
  app.rt('main').data.recordings!.push(rec);
  const auto = app.svc.podcast.autoEpisode('main', rec)!;
  for (let i = 0; i < 50 && !app.rt('main').data.episodes?.find((e) => e.id === auto.id)?.hosted; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(app.rt('main').data.episodes?.find((e) => e.id === auto.id)?.hosted?.id, 'e1');
  assert.ok(calls.length >= 4);
});
