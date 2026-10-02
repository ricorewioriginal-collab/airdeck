// Hörerstatistik - nach dem Statistik-Tab des AnMaCha Control Centers (automation.html): Zeitraum-Chips
// (Heute / 24 h / 7 Tage / 30 Tage / 3 Monate), Kennzahl-Kacheln, Untertabs Gespielt / Top-Songs /
// Hörer-Verlauf / Genre-Mix / Live-Plays. Grundlage: Play-Log (mit Hörerzahl je Titel), 30-s-Stichproben
// (48 h) und das Stunden-Aggregat listenerHours (100 Tage). Kein eigener Datenbestand.

import type { AnMaChaCastApp } from '../app.ts';
import { AppError, type PlayLogEntry } from '../model.ts';

export type StatsPeriod = 'today' | '24h' | '7d' | '30d' | '3m';
export const STATS_PERIODS: Record<StatsPeriod, string> = { today: 'Heute', '24h': '24 h', '7d': '7 Tage', '30d': '30 Tage', '3m': '3 Monate' };

export interface StatsReport {
  period: StatsPeriod;
  from: number;
  to: number;
  kpis: {
    played: number;
    listenersNow: number;
    avgPerSong: number | null;
    peak: number;
    livePlays: number;
    uniqueSongs: number;
    topSong: { title: string; artist: string; plays: number } | null;
    hoursOnAir: number;
  };
  played: PlayLogEntry[];
  topSongs: { mediaId: string; title: string; artist: string; plays: number; avgListeners: number | null }[];
  topArtists: { artist: string; plays: number }[];
  /** Hörer-Verlauf: Punkte (Zeit → Ø Hörer), Auflösung je nach Zeitraum (10 min / Stunde / Tag) */
  series: { at: number; avg: number; peak: number }[];
  seriesStep: 'minutes' | 'hours' | 'days';
  /** Ø Hörer nach Tageszeit 0–23 (null = keine Daten) */
  byHour: (number | null)[];
  genres: { genre: string; plays: number }[];
  livePlays: PlayLogEntry[];
  categories: { category: string; plays: number }[];
}

export function periodRange(period: StatsPeriod, now = Date.now()): { from: number; to: number } {
  if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return { from: d.getTime(), to: now }; }
  const h = period === '24h' ? 24 : period === '7d' ? 7 * 24 : period === '30d' ? 30 * 24 : 90 * 24;
  return { from: now - h * 3_600_000, to: now };
}

export class StatsService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  stats(stationId: string, periodIn: string): StatsReport {
    const period = (Object.keys(STATS_PERIODS) as StatsPeriod[]).includes(periodIn as StatsPeriod) ? (periodIn as StatsPeriod) : null;
    if (!period) throw new AppError(400, 'invalid_period', 'Zeitraum: today, 24h, 7d, 30d oder 3m');
    const rt = this.app.rt(stationId);
    const { from, to } = periodRange(period);
    const played = (rt.data.playLog ?? []).filter((e) => e.at >= from && e.at <= to);
    const byMedia = new Map<string, { title: string; artist: string; plays: number; sum: number; n: number }>();
    const byArtist = new Map<string, number>();
    const byGenre = new Map<string, number>();
    const byCat = new Map<string, number>();
    const lib = new Map(rt.data.library.map((m) => [m.id, m]));
    for (const e of played) {
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
      if (e.category !== 'music') continue;
      const s = byMedia.get(e.mediaId) ?? { title: e.title, artist: e.artist, plays: 0, sum: 0, n: 0 };
      s.plays++;
      if (typeof e.listeners === 'number') { s.sum += e.listeners; s.n++; }
      byMedia.set(e.mediaId, s);
      if (e.artist) byArtist.set(e.artist, (byArtist.get(e.artist) ?? 0) + 1);
      const g = lib.get(e.mediaId)?.genre?.trim();
      if (g) byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
    }
    const topSongs = [...byMedia.entries()].map(([mediaId, s]) => ({ mediaId, title: s.title, artist: s.artist, plays: s.plays, avgListeners: s.n ? Math.round(s.sum / s.n) : null }))
      .sort((a, b) => b.plays - a.plays || (b.avgListeners ?? 0) - (a.avgListeners ?? 0)).slice(0, 50);
    const withListeners = played.filter((e) => typeof e.listeners === 'number');
    const avgPerSong = withListeners.length ? Math.round(withListeners.reduce((s, e) => s + e.listeners!, 0) / withListeners.length) : null;
    const livePlays = played.filter((e) => e.live);

    // Hörer-Verlauf
    const { series, seriesStep, peak, byHour } = this.series(stationId, period, from, to);
    const hoursOnAir = Math.round(series.filter((p) => p.avg > 0 || p.peak > 0).length * (seriesStep === 'minutes' ? 1 / 6 : seriesStep === 'hours' ? 1 : 24) * 10) / 10;

    return {
      period, from, to,
      kpis: {
        played: played.length, listenersNow: this.app.listenersNow(stationId), avgPerSong, peak: Math.max(peak, ...withListeners.map((e) => e.listeners!)),
        livePlays: livePlays.length, uniqueSongs: byMedia.size,
        topSong: topSongs[0] ? { title: topSongs[0].title, artist: topSongs[0].artist, plays: topSongs[0].plays } : null, hoursOnAir,
      },
      played: played.slice(0, 300),
      topSongs,
      topArtists: [...byArtist.entries()].map(([artist, plays]) => ({ artist, plays })).sort((a, b) => b.plays - a.plays).slice(0, 20),
      series, seriesStep, byHour,
      genres: [...byGenre.entries()].map(([genre, plays]) => ({ genre, plays })).sort((a, b) => b.plays - a.plays).slice(0, 12),
      livePlays: livePlays.slice(0, 200),
      categories: [...byCat.entries()].map(([category, plays]) => ({ category, plays })).sort((a, b) => b.plays - a.plays),
    };
  }

  private series(stationId: string, period: StatsPeriod, from: number, to: number) {
    const rt = this.app.rt(stationId);
    const byHour: { sum: number; n: number }[] = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
    let peak = 0;
    const series: { at: number; avg: number; peak: number }[] = [];
    let seriesStep: 'minutes' | 'hours' | 'days';
    if (period === 'today' || period === '24h') {
      // 30-s-Stichproben → 10-Minuten-Raster
      seriesStep = 'minutes';
      const step = 600_000;
      const buckets = new Map<number, { sum: number; n: number; peak: number }>();
      for (const s of rt.data.recapSamples ?? []) {
        if (s.at < from || s.at > to) continue;
        const k = s.at - (s.at % step);
        const b = buckets.get(k) ?? { sum: 0, n: 0, peak: 0 };
        b.sum += s.listeners; b.n++; b.peak = Math.max(b.peak, s.listeners);
        buckets.set(k, b);
        peak = Math.max(peak, s.listeners);
        const h = byHour[new Date(s.at).getHours()]!; h.sum += s.listeners; h.n++;
      }
      for (const [at, b] of [...buckets.entries()].sort((a, c) => a[0] - c[0])) series.push({ at, avg: Math.round((b.sum / b.n) * 10) / 10, peak: b.peak });
    } else {
      const hours = (rt.data.listenerHours ?? []).filter((h) => h.at >= from - 3_600_000 && h.at <= to);
      for (const h of hours) {
        peak = Math.max(peak, h.peak);
        const bh = byHour[new Date(h.at).getHours()]!; bh.sum += h.sum; bh.n += h.n;
      }
      if (period === '7d') {
        seriesStep = 'hours';
        for (const h of hours) series.push({ at: h.at, avg: Math.round((h.sum / Math.max(1, h.n)) * 10) / 10, peak: h.peak });
      } else {
        seriesStep = 'days';
        const days = new Map<number, { sum: number; n: number; peak: number }>();
        for (const h of hours) {
          const d = new Date(h.at); d.setHours(0, 0, 0, 0);
          const b = days.get(d.getTime()) ?? { sum: 0, n: 0, peak: 0 };
          b.sum += h.sum; b.n += h.n; b.peak = Math.max(b.peak, h.peak);
          days.set(d.getTime(), b);
        }
        for (const [at, b] of [...days.entries()].sort((a, c) => a[0] - c[0])) series.push({ at, avg: Math.round((b.sum / Math.max(1, b.n)) * 10) / 10, peak: b.peak });
      }
    }
    return { series, seriesStep, peak, byHour: byHour.map((h) => (h.n ? Math.round((h.sum / h.n) * 10) / 10 : null)) };
  }
}
