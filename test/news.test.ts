/**
 * Nachrichten & Wetter (laut.fm): Zugang aus dem laut.fm-Ausgang ableiten, Datei (gemockt) holen und
 * zwischenspeichern, als Titel „news“ einspielen, Sendeuhr-Eintrag kind "news" validieren.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { isLautHost, newsBoundary } from '../src/server/services/news.ts';

const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };

test('isLautHost / newsBoundary', () => {
  assert.ok(isLautHost('live.laut.fm'));
  assert.ok(isLautHost('stream.laut.fm'));
  assert.ok(!isLautHost('laut.fm.example.org'));
  assert.ok(!isLautHost('icecast.example.org'));
  const b = new Date(newsBoundary(new Date(2026, 9, 2, 12, 30).getTime()));
  assert.equal(`${b.getHours()}:${b.getMinutes()}`, '11:50', 'vor xx:50 → vorige Stunde');
  const b2 = new Date(newsBoundary(new Date(2026, 9, 2, 12, 55).getTime()));
  assert.equal(`${b2.getHours()}:${b2.getMinutes()}`, '12:50');
});

test('Nachrichten: Zugang aus Ausgang, Download (gemockt), Einspielen, Sendeuhr', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-news-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const news = app.svc.news;
    assert.equal(news.creds('main'), null);
    assert.equal((news.summary('main') as any).creds.ok, false);
    await assert.rejects(news.latest('main', 2), /Kein laut.fm-Zugang/);
    assert.throws(() => app.svc.planning.saveClockEvent('main', null, { kind: 'news', newsId: 2, minutes: [0], hours: [], days: [] }), /Kein laut.fm-Zugang/);

    // laut.fm-Live-Stream als Ausgang → Sendername (Mount) + Live-Passwort
    app.saveOutput(admin, 'main', null, { name: 'laut.fm testsender', type: 'icecast', host: 'live.laut.fm', port: 80, mount: '/testsender', username: 'source', password: 'geheim', sourceTarget: '/live' });
    app.saveOutput(admin, 'main', null, { name: 'eigener Icecast', type: 'icecast', host: 'icecast.example.org', port: 8000, mount: '/radio', username: 'source', password: 'x', sourceTarget: '/live' });
    const c = news.creds('main')!;
    assert.equal(c.station, 'testsender');
    assert.equal(c.password, 'geheim');
    assert.equal((news.summary('main') as any).sources.length, 1, 'nur laut.fm-Ausgänge');

    // Download gemockt: Basic-Auth muss stimmen, Datei wird zwischengespeichert
    let calls = 0;
    news.fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      assert.equal(String(url), 'https://api.radioadmin.laut.fm/news/2');
      const auth = (init?.headers as Record<string, string>).Authorization;
      assert.equal(auth, `Basic ${Buffer.from('testsender:geheim').toString('base64')}`);
      return new Response(Buffer.alloc(4000, 1), { status: 200 });
    }) as typeof fetch;
    const m1 = await news.latest('main', 2);
    assert.ok(existsSync(m1.file));
    assert.equal(m1.bytes, 4000);
    const m2 = await news.latest('main', 2);
    assert.equal(calls, 1, 'frische Datei kommt aus dem Cache');
    assert.equal(m2.file, m1.file);
    await news.latest('main', 2, true);
    assert.equal(calls, 2, 'force holt neu');
    assert.equal((news.summary('main') as any).files[1].have, true);

    // Abgelehnter Zugang → klare Meldung, Fehler im Status
    news.fetchImpl = (async () => new Response('nope', { status: 401 })) as typeof fetch;
    await assert.rejects(news.latest('main', 3), /lehnt den Zugang ab/);
    assert.match((news.summary('main') as any).files[2].err, /Zugang/);

    // Einspielen: Titel „news-2“ in der Bibliothek, Planung feuert
    news.fetchImpl = (async () => new Response(Buffer.alloc(4000, 2), { status: 200 })) as typeof fetch;
    const fired: any[] = [];
    app.subscribe((e) => { if (e.type === 'schedule.fired') fired.push(e.payload); });
    const r = await news.air('main', 2, 'track');
    assert.equal(r.mediaId, 'news-2');
    const item = app.svc.media.library('main').find((x) => x.id === 'news-2')!;
    assert.equal(item.category, 'news');
    assert.equal(item.folder, 'Nachrichten');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].mode, 'track');
    await news.air('main', 2, 'now');
    assert.equal(app.svc.media.library('main').filter((x) => x.id === 'news-2').length, 1, 'je Beitrag genau ein Titel');

    // Sendeuhr: Eintrag kind news mit Stunden-Raster
    const ev = app.svc.planning.saveClockEvent('main', null, { kind: 'news', newsId: 1, minutes: [0], hours: [6, 7, 8], days: [], mode: 'fx' });
    assert.equal(ev.kind, 'news');
    assert.equal(ev.newsId, 1);
    assert.equal(ev.mode, 'track', 'fx ergibt bei Nachrichten keinen Sinn → nach dem Titel');
    assert.equal(ev.label, 'Nachrichten + Wetter');
    assert.deepEqual(ev.hours, [6, 7, 8]);
    assert.throws(() => app.svc.planning.saveClockEvent('main', null, { kind: 'news', newsId: 9, minutes: [0] }), /Beitrag 1/);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
