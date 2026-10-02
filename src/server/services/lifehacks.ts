// Playlist-Lifehacks: Werkzeuge, die der normale Betrieb nicht bietet (Gesundheitscheck, Laufzeit-
// Kalkulator, Zusammenführen, Top-Tracks, Massen-Tagger, Analyse, Track-Suche, Jahr-Batch, Vergleich,
// Massenlöschung). Abgeglichen mit dem Lifehacks-Tab aus dem laut.fm-Verwaltungszentrum (anmacha_control_center/
// automation.html), auf die Playlist/MediaItem-Struktur von AnMaCha Cast übertragen.

import type { AnMaChaCastApp } from '../app.ts';
import type { MediaItem } from '../../core/automation.ts';
import { AppError, type Playlist } from '../model.ts';

export interface HealthCheckReport {
  duplicates: { title: string; artist: string; ids: string[] }[];
  noMetadata: { id: string; title: string; artist: string; missing: string[] }[];
  tooShort: { id: string; title: string; artist: string; durationMs: number }[];
  unassigned: { id: string; title: string; artist: string }[];
}

export interface RuntimeReport {
  playlistId: string;
  trackCount: number;
  totalMs: number;
  /** Mit geschätztem Werbepuffer (adBufferPct % zusätzlich) */
  withBufferMs: number;
}

export interface PlaylistAnalysis {
  trackCount: number;
  avgDurationMs: number;
  genreMix: { genre: string; count: number }[];
  decades: { decade: string; count: number }[];
  topArtists: { artist: string; count: number }[];
}

export interface TrackFinderHit {
  media: MediaItem;
  playlists: { id: string; name: string }[];
}

const MIN_CLIP_MS = 60_000;

export class LifehacksService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private playlist(stationId: string, id: string): Playlist {
    const pl = this.app.rt(stationId).data.playlists?.find((p) => p.id === id);
    if (!pl) throw new AppError(404, 'not_found', 'Playlist nicht gefunden');
    return pl;
  }

  private byId(stationId: string): Map<string, MediaItem> {
    return new Map(this.app.rt(stationId).data.library.map((m) => [m.id, m]));
  }

  /** 1: Gesundheitscheck – Duplikate, fehlende Metadaten, zu kurze Clips, nicht zugewiesene Titel. */
  healthCheck(stationId: string): HealthCheckReport {
    const rt = this.app.rt(stationId);
    const lib = rt.data.library;
    const assigned = new Set((rt.data.playlists ?? []).flatMap((p) => p.items));

    const byKey = new Map<string, string[]>();
    for (const m of lib) {
      const key = `${m.title.trim().toLowerCase()}::${m.artist.trim().toLowerCase()}`;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(m.id);
    }
    const duplicates = [...byKey.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([, ids]) => {
        const first = lib.find((m) => m.id === ids[0])!;
        return { title: first.title, artist: first.artist, ids };
      });

    const noMetadata = lib
      .map((m) => {
        const missing: string[] = [];
        if (!m.artist.trim()) missing.push('Interpret');
        if (!m.title.trim()) missing.push('Titel');
        if (m.durationMs == null) missing.push('Laufzeit');
        return missing.length ? { id: m.id, title: m.title, artist: m.artist, missing } : null;
      })
      .filter((x): x is HealthCheckReport['noMetadata'][number] => x !== null);

    const tooShort = lib
      .filter((m) => m.durationMs != null && m.durationMs < MIN_CLIP_MS && m.category === 'music')
      .map((m) => ({ id: m.id, title: m.title, artist: m.artist, durationMs: m.durationMs! }));

    const unassigned = lib.filter((m) => !assigned.has(m.id)).map((m) => ({ id: m.id, title: m.title, artist: m.artist }));

    return { duplicates, noMetadata, tooShort, unassigned };
  }

  /** 2: Laufzeit-Kalkulator – Gesamtlänge der Playlist, optional mit Werbepuffer-Schätzung. */
  runtime(stationId: string, playlistId: string, adBufferPct = 0): RuntimeReport {
    const pl = this.playlist(stationId, playlistId);
    const lib = this.byId(stationId);
    const totalMs = pl.items.reduce((sum, id) => sum + (lib.get(id)?.durationMs ?? 0), 0);
    const pct = Math.max(0, Math.min(100, Number(adBufferPct) || 0));
    return { playlistId, trackCount: pl.items.length, totalMs, withBufferMs: Math.round(totalMs * (1 + pct / 100)) };
  }

  /** 3: Playlisten zusammenführen – Titel aus source in target übernehmen, Duplikate überspringen. */
  merge(stationId: string, targetId: string, sourceId: string): { added: number; skipped: number } {
    if (targetId === sourceId) throw new AppError(400, 'same_playlist', 'Ziel und Quelle müssen unterschiedlich sein');
    const target = this.playlist(stationId, targetId);
    const source = this.playlist(stationId, sourceId);
    const have = new Set(target.items);
    let added = 0;
    let skipped = 0;
    for (const id of source.items) {
      if (have.has(id)) { skipped++; continue; }
      have.add(id);
      target.items.push(id);
      added++;
    }
    delete target.shuffleOrder;
    this.app.publish('playlists.changed', stationId, this.app.rt(stationId).data.playlists);
    this.app.changed();
    return { added, skipped };
  }

  /** 4: Top-Tracks der letzten N Stunden → neue Playlist. */
  topTracksPlaylist(stationId: string, opts: { n?: number; name?: string; hours?: number }): Playlist {
    const rt = this.app.rt(stationId);
    const hours = Math.max(1, Math.min(24 * 30, Number(opts.hours) || 24));
    const since = Date.now() - hours * 3_600_000;
    const n = Math.max(1, Math.min(200, Number(opts.n) || 20));
    const counts = new Map<string, number>();
    for (const e of rt.data.playLog ?? []) {
      if (e.at < since) continue;
      counts.set(e.mediaId, (counts.get(e.mediaId) ?? 0) + 1);
    }
    const lib = new Set(rt.data.library.map((m) => m.id));
    const ranked = [...counts.entries()].filter(([id]) => lib.has(id)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
    const name = (opts.name?.trim() || `Top ${n}`).slice(0, 80);
    return this.app.svc.planning.savePlaylist(stationId, null, { name, items: ranked });
  }

  /** 5: Massen-Tagger – Tags für alle Titel einer Playlist hinzufügen oder entfernen. */
  massTag(stationId: string, playlistId: string, tags: string[], mode: 'add' | 'remove'): { changed: number } {
    const pl = this.playlist(stationId, playlistId);
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    if (!clean.length) throw new AppError(400, 'no_tags', 'Mindestens ein Tag angeben');
    let changed = 0;
    for (const id of pl.items) {
      const m = this.app.svc.media.media(stationId, id);
      const cur = new Set(m.tags ?? []);
      const before = cur.size;
      if (mode === 'add') for (const t of clean) cur.add(t);
      else for (const t of clean) cur.delete(t);
      if (cur.size !== before) {
        this.app.svc.media.updateMedia(stationId, id, { tags: [...cur] });
        changed++;
      }
    }
    return { changed };
  }

  /** 6: Playlist-Analyse – Genre-Mix, Jahrzehnte, Ø-Länge, beliebteste Artists. */
  analyze(stationId: string, playlistId: string): PlaylistAnalysis {
    const pl = this.playlist(stationId, playlistId);
    const lib = this.byId(stationId);
    const items = pl.items.map((id) => lib.get(id)).filter((m): m is MediaItem => !!m);
    const count = (list: (string | undefined)[]) => {
      const m = new Map<string, number>();
      for (const v of list) { if (!v) continue; m.set(v, (m.get(v) ?? 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const genreMix = count(items.map((m) => m.genre)).map(([genre, c]) => ({ genre, count: c }));
    const decades = count(items.map((m) => (m.year ? `${Math.floor(m.year / 10) * 10}er` : undefined))).map(([decade, c]) => ({ decade, count: c }));
    const topArtists = count(items.map((m) => m.artist)).slice(0, 10).map(([artist, c]) => ({ artist, count: c }));
    const durations = items.map((m) => m.durationMs ?? 0).filter((d) => d > 0);
    const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return { trackCount: items.length, avgDurationMs, genreMix, decades, topArtists };
  }

  /** 8: Globale Track-Suche – Titel in allen Playlisten finden. */
  trackFinder(stationId: string, query: string): TrackFinderHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const rt = this.app.rt(stationId);
    const hits = rt.data.library.filter((m) => m.title.toLowerCase().includes(q) || m.artist.toLowerCase().includes(q)).slice(0, 100);
    return hits.map((media) => ({
      media,
      playlists: (rt.data.playlists ?? []).filter((p) => p.items.includes(media.id)).map((p) => ({ id: p.id, name: p.name })),
    }));
  }

  /** 9: Erscheinungsjahr für alle Titel einer Playlist eintragen, die noch kein Jahr haben. */
  fillYear(stationId: string, playlistId: string, year: number): { filled: number; skipped: number } {
    if (!Number.isFinite(year) || year < 1900 || year > 2100) throw new AppError(400, 'invalid_year', 'Ungültiges Jahr');
    const pl = this.playlist(stationId, playlistId);
    let filled = 0;
    let skipped = 0;
    for (const id of pl.items) {
      const m = this.app.svc.media.media(stationId, id);
      if (m.year != null) { skipped++; continue; }
      this.app.svc.media.updateMedia(stationId, id, { year });
      filled++;
    }
    return { filled, skipped };
  }

  /** 10: Playlist-Vergleich – Titel, die nur in A bzw. nur in B vorkommen. */
  compare(stationId: string, aId: string, bId: string): { onlyA: MediaItem[]; onlyB: MediaItem[] } {
    const a = this.playlist(stationId, aId);
    const b = this.playlist(stationId, bId);
    const lib = this.byId(stationId);
    const bSet = new Set(b.items);
    const aSet = new Set(a.items);
    const onlyA = a.items.filter((id) => !bSet.has(id)).map((id) => lib.get(id)).filter((m): m is MediaItem => !!m);
    const onlyB = b.items.filter((id) => !aSet.has(id)).map((id) => lib.get(id)).filter((m): m is MediaItem => !!m);
    return { onlyA, onlyB };
  }

  /** 11: Mehrere Playlisten auf einmal löschen (Titel bleiben in der Bibliothek erhalten). */
  deleteMany(stationId: string, ids: string[]): { deleted: string[] } {
    const deleted: string[] = [];
    for (const id of ids) {
      try {
        this.app.svc.planning.deletePlaylist(stationId, id);
        deleted.push(id);
      } catch {
        // z. B. im Sendeplan verwendet – überspringen statt die ganze Aktion abzubrechen
      }
    }
    return { deleted };
  }
}
