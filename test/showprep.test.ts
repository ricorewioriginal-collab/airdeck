/**
 * News-Zentrale (Show-Prep): RSS/Atom-Parser, Feed-Verwaltung (Standard ausblenden, eigene ergänzen, zurücksetzen),
 * Artikel mit Cache (fetch gemockt), Wetter über Open-Meteo (gemockt) inkl. sprechbarem Text, KI-Notizen (gemockt).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { DEFAULT_FEEDS, parseArticles, weatherSpeech, wmo } from '../src/server/services/showprep.ts';

const RSS = `<?xml version="1.0"?><rss><channel><title>Test</title>
<item><title><![CDATA[Erste Meldung &amp; mehr]]></title><description><![CDATA[<p>Text der <b>ersten</b> Meldung.</p>]]></description><link>https://example.org/1</link><pubDate>Fri, 02 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Zweite Meldung</title><description>Zweite Meldung – Beschreibung beginnt mit dem Titel</description><link>https://example.org/2</link><pubDate>Fri, 02 Oct 2026 12:00:00 GMT</pubDate></item>
<item><description>ohne Titel</description></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom-Eintrag</title><summary>Kurz</summary><link href="https://example.org/a"/><updated>2026-10-02T09:00:00Z</updated></entry></feed>`;

test('parseArticles: RSS mit CDATA/HTML, Titel-Dopplung entfernt, Atom-Links, ohne Titel übersprungen', () => {
  const a = parseArticles(RSS, 'Test');
  assert.equal(a.length, 2);
  assert.equal(a[0]!.title, 'Erste Meldung & mehr');
  assert.equal(a[0]!.text, 'Text der ersten Meldung.');
  assert.equal(a[0]!.link, 'https://example.org/1');
  assert.equal(a[0]!.at, Date.parse('Fri, 02 Oct 2026 10:00:00 GMT'));
  assert.equal(a[1]!.text, 'Beschreibung beginnt mit dem Titel');
  const b = parseArticles(ATOM, 'Atom');
  assert.equal(b[0]!.link, 'https://example.org/a');
  assert.equal(b[0]!.text, 'Kurz');
});

test('WMO-Codes und sprechbarer Wettertext', () => {
  assert.deepEqual(wmo(61), ['leichter Regen', '🌦️']);
  assert.match(wmo(123)[0], /Wettercode 123/);
  const speech = weatherSpeech({ city: 'Berlin', country: 'DE', lat: 0, lon: 0, now: { temp: 12.4, feels: 8, code: 3, text: 'bedeckt', icon: '☁️', wind: 35, humidity: 70 },
    days: [{ date: '2026-10-02', weekday: 'Freitag', code: 61, text: 'leichter Regen', icon: '🌦️', max: 14, min: 7, rain: 70 }, { date: '2026-10-03', weekday: 'Samstag', code: 0, text: 'klar', icon: '☀️', max: 16, min: -1, rain: 0 }] });
  assert.equal(speech, 'In Berlin ist es gerade bedeckt bei 12 Grad, gefühlt 8. dazu frischer Wind mit bis zu 35 Kilometern pro Stunde. Heute leichter Regen, Höchstwerte um 14 Grad, Regenrisiko 70 Prozent. Morgen klar, zwischen minus 1 und 16 Grad.');
});

test('Show-Prep: Feeds verwalten, Artikel mit Cache, Kategorie-Sammelansicht, Wetter, KI-Notizen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-showprep-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const sp = app.svc.showprep;
    assert.equal(sp.feeds('main').length, DEFAULT_FEEDS.length);
    assert.throws(() => sp.addFeed('main', { name: 'x', url: 'ftp://nope' }), /http/);
    const own = sp.addFeed('main', { name: 'Mein Blog', url: 'https://blog.example.org/feed' });
    assert.equal(own.category, '✏️ Eigene Feeds');
    assert.throws(() => sp.addFeed('main', { name: 'Dupe', url: 'https://blog.example.org/feed' }), /vorhanden/);
    sp.removeFeed('main', 'tagesschau');
    assert.ok(!sp.feeds('main').some((f) => f.id === 'tagesschau'), 'Standard-Feed ausgeblendet');
    assert.equal(sp.feeds('main').length, DEFAULT_FEEDS.length);
    sp.removeFeed('main', own.id);
    assert.equal(sp.feeds('main').length, DEFAULT_FEEDS.length - 1);
    sp.resetFeeds('main');
    assert.equal(sp.feeds('main').length, DEFAULT_FEEDS.length);

    // Artikel: fetch gemockt, Cache greift, Kategorie fasst mehrere Feeds zusammen (neueste zuerst)
    const calls: string[] = [];
    sp.fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes('zdf')) return new Response('kaputt', { status: 500 });
      return new Response(String(url).includes('spiegel') ? ATOM : RSS, { status: 200 });
    }) as typeof fetch;
    const r1 = await sp.articles('main', { feedId: 'tagesschau' });
    assert.equal(r1.items.length, 2);
    assert.equal(r1.items[0]!.title, 'Zweite Meldung', 'neueste zuerst');
    await sp.articles('main', { feedId: 'tagesschau' });
    assert.equal(calls.length, 1, 'zweiter Aufruf aus dem Cache');
    await sp.articles('main', { feedId: 'tagesschau' }, true);
    assert.equal(calls.length, 2, 'force lädt neu');
    const cat = await sp.articles('main', { category: '📰 National' });
    assert.ok(cat.items.length >= 3, 'Artikel mehrerer Feeds');
    assert.ok(cat.errors.some((e) => /ZDF heute: HTTP 500/.test(e)), 'kaputter Feed wird gemeldet, blockiert aber nicht');
    assert.equal(cat.items[0]!.title, 'Zweite Meldung');
    await assert.rejects(sp.articles('main', { feedId: 'nope' }), /nicht gefunden/);

    // Wetter: Geocoding + Vorhersage gemockt
    sp.fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('geocoding')) return Response.json(u.includes('Nirgendwo') ? {} : { results: [{ name: 'Hannover', country: 'Deutschland', latitude: 52.37, longitude: 9.73 }] });
      return Response.json({ current: { temperature_2m: 11.2, apparent_temperature: 9.8, weather_code: 61, wind_speed_10m: 12, relative_humidity_2m: 80 },
        daily: { time: ['2026-10-02', '2026-10-03'], weather_code: [61, 2], temperature_2m_max: [13, 15], temperature_2m_min: [6, 7], precipitation_probability_max: [80, 10] } });
    }) as typeof fetch;
    const w = await sp.weather('Hannover');
    assert.equal(w.city, 'Hannover');
    assert.equal(w.now.text, 'leichter Regen');
    assert.equal(w.days[1]!.weekday, 'Samstag');
    assert.match(w.speech, /^In Hannover ist es gerade leichter Regen bei 11 Grad\./);
    await assert.rejects(sp.weather('Nirgendwo'), /nicht gefunden/);
    await assert.rejects(sp.weather(''), /Stadt/);

    // KI-Notizen: Text-KI gemockt, Meldungen + Wetter landen im Prompt
    let seen = '';
    (app.ai as any).text = async (_s: string, _p: string, _t: unknown, system: string, prompt: string) => { seen = `${system}\n${prompt}`; return { text: ' Guten Morgen, hier die Meldungen. ', providerId: 'p', model: 'mock', cost: 0 }; };
    await assert.rejects(sp.notes('main', {}), /Artikel/);
    const n = await sp.notes('main', { articles: [{ title: 'Erste', text: 'Details' }], weather: w.speech, seconds: 45 });
    assert.equal(n.text, 'Guten Morgen, hier die Meldungen.');
    assert.match(seen, /Meldung 1: Erste\nDetails/);
    assert.match(seen, /Wetter: In Hannover/);
    assert.match(seen, /108 Wörter \(45 Sekunden\)/);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
