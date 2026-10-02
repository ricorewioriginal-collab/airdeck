// News-Zentrale (Show-Prep) - nach showprep.html im AnMaCha Control Center: RSS-Feeds je Sender (Standardliste +
// eigene), Artikel serverseitig geholt und geparst (kein CORS, 5-Minuten-Cache), Wetter-Block über Open-Meteo
// (Geocoding + Vorhersage, ohne API-Key), KI-Vorschlag für Moderationsnotizen aus gewählten Artikeln + Wetter.
// Der Teleprompter läuft rein im Studio (studio/js/showprep.js).

import type { AnMaChaCastApp } from '../app.ts';
import { AppError, newId } from '../model.ts';

export interface PrepFeed { id: string; name: string; url: string; category: string; custom?: boolean }
export interface PrepArticle { title: string; text: string; link: string; at: number | null; feed: string }
export interface PrepWeather {
  city: string; country: string; lat: number; lon: number;
  now: { temp: number; feels: number; code: number; text: string; icon: string; wind: number; humidity: number };
  days: { date: string; weekday: string; code: number; text: string; icon: string; max: number; min: number; rain: number }[];
  speech: string;
}

export const DEFAULT_FEEDS: PrepFeed[] = [
  { id: 'tagesschau', name: 'Tagesschau', url: 'https://www.tagesschau.de/xml/rss2/', category: '📰 National' },
  { id: 'zdf', name: 'ZDF heute', url: 'https://www.zdf.de/rss/zdf/nachrichten', category: '📰 National' },
  { id: 'spiegel', name: 'Spiegel Online', url: 'https://www.spiegel.de/schlagzeilen/index.rss', category: '📰 National' },
  { id: 'zeit', name: 'Zeit Online', url: 'https://newsfeed.zeit.de/all', category: '📰 National' },
  { id: 'ndr', name: 'NDR (Nord)', url: 'https://www.ndr.de/index-rss.xml', category: '📍 Regional' },
  { id: 'wdr', name: 'WDR (West)', url: 'https://www1.wdr.de/uebersicht-100.feed', category: '📍 Regional' },
  { id: 'mdr', name: 'MDR (Mitteldeutschland)', url: 'https://www.mdr.de/nachrichten/index-rss.xml', category: '📍 Regional' },
  { id: 'kicker', name: 'kicker', url: 'https://newsfeed.kicker.de/news/aktuell', category: '⚽ Sport' },
  { id: 'heise', name: 'heise online', url: 'https://www.heise.de/rss/heise-atom.xml', category: '💻 Technik' },
  { id: 'laut', name: 'laut.de Musik-News', url: 'https://www.laut.de/News/rss', category: '🎵 Musik' },
];

/** WMO-Wettercode → deutscher Text + Symbol (Open-Meteo). */
export const WMO: Record<number, [string, string]> = {
  0: ['klar', '☀️'], 1: ['überwiegend klar', '🌤️'], 2: ['teils bewölkt', '⛅'], 3: ['bedeckt', '☁️'],
  45: ['Nebel', '🌫️'], 48: ['Reifnebel', '🌫️'], 51: ['leichter Nieselregen', '🌦️'], 53: ['Nieselregen', '🌦️'], 55: ['starker Nieselregen', '🌧️'],
  56: ['gefrierender Nieselregen', '🌧️'], 57: ['gefrierender Nieselregen', '🌧️'], 61: ['leichter Regen', '🌦️'], 63: ['Regen', '🌧️'], 65: ['starker Regen', '🌧️'],
  66: ['gefrierender Regen', '🌧️'], 67: ['gefrierender Regen', '🌧️'], 71: ['leichter Schneefall', '🌨️'], 73: ['Schneefall', '🌨️'], 75: ['starker Schneefall', '❄️'],
  77: ['Schneegriesel', '🌨️'], 80: ['Regenschauer', '🌦️'], 81: ['kräftige Regenschauer', '🌧️'], 82: ['heftige Regenschauer', '⛈️'],
  85: ['Schneeschauer', '🌨️'], 86: ['starke Schneeschauer', '❄️'], 95: ['Gewitter', '⛈️'], 96: ['Gewitter mit Hagel', '⛈️'], 99: ['schweres Gewitter mit Hagel', '⛈️'],
};
export const wmo = (code: number): [string, string] => WMO[code] ?? [`Wettercode ${code}`, '🌡️'];

const unescape = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/\s+/g, ' ').trim();

/** RSS 2.0 / Atom → Artikel mit Titel, Text, Link, Datum (robust gegen fehlende Felder). */
export function parseArticles(xml: string, feed: string, max = 40): PrepArticle[] {
  const out: PrepArticle[] = [];
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const tag = (block: string, names: string[]): string => {
    for (const n of names) {
      const m = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, 'i').exec(block);
      if (m?.[1]?.trim()) return m[1];
    }
    return '';
  };
  for (const block of items) {
    if (out.length >= max) break;
    const title = unescape(tag(block, ['title']));
    if (!title) continue;
    const text = unescape(tag(block, ['content:encoded', 'description', 'summary', 'content'])).slice(0, 1500);
    const linkTag = /<link\b[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? tag(block, ['link']);
    const link = unescape(linkTag).trim();
    const dateRaw = unescape(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const at = dateRaw ? Date.parse(dateRaw) : NaN;
    out.push({ title, text: text.startsWith(title) ? text.slice(title.length).replace(/^[\s\-–:]+/, '') : text, link, at: Number.isFinite(at) ? at : null, feed });
  }
  return out;
}

/** Sprechbarer Wettertext für Moderation/KI („In Berlin ist es bedeckt bei 12 Grad …“). */
export function weatherSpeech(w: Omit<PrepWeather, 'speech'>): string {
  const d = w.days[0];
  const tomorrow = w.days[1];
  const r = (n: number) => String(Math.round(n)).replace('-', 'minus ');
  const parts = [`In ${w.city} ist es gerade ${w.now.text} bei ${r(w.now.temp)} Grad`];
  if (Math.abs(w.now.feels - w.now.temp) >= 3) parts[0] += `, gefühlt ${r(w.now.feels)}`;
  if (w.now.wind >= 30) parts.push(`dazu ${w.now.wind >= 60 ? 'stürmischer' : 'frischer'} Wind mit bis zu ${r(w.now.wind)} Kilometern pro Stunde`);
  if (d) parts.push(`Heute ${d.text}, Höchstwerte um ${r(d.max)} Grad${d.rain >= 50 ? `, Regenrisiko ${d.rain} Prozent` : ''}`);
  if (tomorrow) parts.push(`Morgen ${tomorrow.text}, zwischen ${r(tomorrow.min)} und ${r(tomorrow.max)} Grad`);
  return parts.join('. ') + '.';
}

export class ShowPrepService {
  private readonly cache = new Map<string, { at: number; items: PrepArticle[] }>();
  /** Test-/Austauschpunkt */
  fetchImpl: typeof fetch = (...a) => fetch(...a);
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  feeds(stationId: string): PrepFeed[] {
    const rt = this.app.rt(stationId);
    const removed = new Set(rt.data.prepFeeds?.removed ?? []);
    return [...DEFAULT_FEEDS.filter((f) => !removed.has(f.id)), ...(rt.data.prepFeeds?.custom ?? [])];
  }

  addFeed(stationId: string, input: { name?: string; url?: string; category?: string }): PrepFeed {
    const url = String(input.url ?? '').trim();
    const name = String(input.name ?? '').trim().slice(0, 60);
    if (!name) throw new AppError(400, 'empty', 'Name angeben');
    if (!/^https?:\/\/\S+$/i.test(url)) throw new AppError(400, 'invalid_url', 'URL muss mit http(s):// beginnen');
    if (this.feeds(stationId).some((f) => f.url === url)) throw new AppError(409, 'duplicate', 'Feed ist bereits vorhanden');
    const rt = this.app.rt(stationId);
    const cfg = (rt.data.prepFeeds ??= { custom: [], removed: [] });
    const feed: PrepFeed = { id: newId('feed'), name, url, category: String(input.category ?? '').trim().slice(0, 40) || '✏️ Eigene Feeds', custom: true };
    cfg.custom.push(feed);
    this.app.changed();
    return feed;
  }

  removeFeed(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    const cfg = (rt.data.prepFeeds ??= { custom: [], removed: [] });
    if (DEFAULT_FEEDS.some((f) => f.id === id)) { if (!cfg.removed.includes(id)) cfg.removed.push(id); }
    else cfg.custom = cfg.custom.filter((f) => f.id !== id);
    this.app.changed();
  }

  resetFeeds(stationId: string): PrepFeed[] {
    delete this.app.rt(stationId).data.prepFeeds;
    this.app.changed();
    return this.feeds(stationId);
  }

  /** Artikel eines Feeds (oder aller Feeds einer Kategorie), 5 Minuten zwischengespeichert, neueste zuerst. */
  async articles(stationId: string, input: { feedId?: string; category?: string }, force = false): Promise<{ items: PrepArticle[]; errors: string[] }> {
    const all = this.feeds(stationId);
    const feeds = input.feedId ? all.filter((f) => f.id === input.feedId) : all.filter((f) => f.category === input.category);
    if (!feeds.length) throw new AppError(404, 'not_found', 'Feed nicht gefunden');
    const errors: string[] = [];
    const lists = await Promise.all(feeds.map(async (f) => {
      const hit = this.cache.get(f.url);
      if (hit && !force && Date.now() - hit.at < 5 * 60_000) return hit.items;
      try {
        const r = await this.fetchImpl(f.url, { headers: { 'User-Agent': 'AnMaCha Cast/1.0 (Radio-Automation)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(12_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const items = parseArticles((await r.text()).slice(0, 2 * 1024 * 1024), f.name);
        if (!items.length) throw new Error('keine Artikel gefunden');
        this.cache.set(f.url, { at: Date.now(), items });
        return items;
      } catch (err) {
        errors.push(`${f.name}: ${(err as Error).message}`);
        return hit?.items ?? [];
      }
    }));
    const items = lists.flat().sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    return { items: feeds.length > 1 ? items.slice(0, 80) : items, errors };
  }

  /** Wetter für eine Stadt (Open-Meteo: Geocoding + Vorhersage, ohne Key). */
  async weather(city: string): Promise<PrepWeather> {
    const q = city.trim();
    if (!q) throw new AppError(400, 'empty', 'Stadt angeben');
    const ua = { headers: { 'User-Agent': 'AnMaCha Cast/1.0 (Radio-Automation)' }, signal: AbortSignal.timeout(10_000) };
    let geo: { results?: { name: string; country?: string; latitude: number; longitude: number }[] };
    try {
      const r = await this.fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=de&format=json`, ua);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      geo = (await r.json()) as typeof geo;
    } catch (err) {
      throw new AppError(502, 'geocoding_failed', `Ortssuche fehlgeschlagen: ${(err as Error).message}`);
    }
    const place = geo.results?.[0];
    if (!place) throw new AppError(404, 'not_found', `Ort „${q}“ nicht gefunden`);
    let fc: { current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number }; daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] } };
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4`;
      const r = await this.fetchImpl(url, ua);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fc = (await r.json()) as typeof fc;
    } catch (err) {
      throw new AppError(502, 'weather_failed', `Wetter konnte nicht geladen werden: ${(err as Error).message}`);
    }
    const c = fc.current;
    const [nowText, nowIcon] = wmo(c.weather_code);
    const days = fc.daily.time.map((date, i) => {
      const [text, icon] = wmo(fc.daily.weather_code[i] ?? 0);
      return { date, weekday: new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long' }), code: fc.daily.weather_code[i] ?? 0, text, icon, max: fc.daily.temperature_2m_max[i] ?? 0, min: fc.daily.temperature_2m_min[i] ?? 0, rain: fc.daily.precipitation_probability_max[i] ?? 0 };
    });
    const base = { city: place.name, country: place.country ?? '', lat: place.latitude, lon: place.longitude, now: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, text: nowText, icon: nowIcon, wind: c.wind_speed_10m, humidity: c.relative_humidity_2m }, days };
    return { ...base, speech: weatherSpeech(base) };
  }

  /** KI-Vorschlag: Moderationsnotizen (sprechbar) aus gewählten Artikeln und optionalem Wetter. */
  async notes(stationId: string, input: { articles?: { title?: string; text?: string }[]; weather?: string; style?: string; seconds?: number }): Promise<{ text: string; model: string; cost: number }> {
    const arts = (Array.isArray(input.articles) ? input.articles : []).slice(0, 12).map((a) => ({ title: String(a?.title ?? '').slice(0, 300), text: String(a?.text ?? '').slice(0, 1200) })).filter((a) => a.title);
    const weather = String(input.weather ?? '').trim().slice(0, 800);
    if (!arts.length && !weather) throw new AppError(400, 'empty', 'Mindestens einen Artikel wählen oder Wetter laden');
    const seconds = Math.max(20, Math.min(300, Math.round(Number(input.seconds) || 60)));
    const style = String(input.style ?? '').trim().slice(0, 200) || 'neutral, klar, radiotauglich';
    const rt = this.app.rt(stationId);
    const system = `Du bist Nachrichtenredakteur bei „${rt.station.name}“. Du schreibst sprechbare Moderationsnotizen für einen Live-Moderator: kurze Sätze, keine Aufzählungszeichen, Zahlen ausgeschrieben wie gesprochen, keine Meinung, nur was in den Meldungen steht. Reihenfolge: wichtigste Meldung zuerst, Wetter zum Schluss. Gib nur den Sprechertext aus, etwa ${Math.round(seconds * 2.4)} Wörter (${seconds} Sekunden). Stil: ${style}.`;
    const prompt = [
      ...arts.map((a, i) => `Meldung ${i + 1}: ${a.title}${a.text ? `\n${a.text}` : ''}`),
      weather ? `Wetter: ${weather}` : '',
    ].filter(Boolean).join('\n\n');
    const r = await this.app.svc.ai.aiText(stationId, prompt, system) as { text: string; model: string; cost: number };
    return { text: r.text.trim(), model: r.model, cost: r.cost };
  }
}
