// Nachrichten & Wetter (laut.fm Radioadmin) - nach „Nachrichten & Wetter“ im AnMaCha Control Center
// (news-center.js): laut.fm erzeugt stündlich drei Beiträge (1 = Nachrichten + Wetter, 2 = Nachrichten,
// 3 = Wetter), Update 10 Minuten vor der vollen Stunde. Zugang = Sendername + Live-Passwort, beides steckt
// bereits im gespeicherten laut.fm-Ausgang (Mount = Sendername, Passwort im Secret-Store) - es wird nichts
// doppelt gespeichert. Die aktuellste Datei wird im Datenordner zwischengespeichert; zum Senden landet sie
// als Titel der Kategorie „news“ in der Bibliothek und läuft über den normalen Planungsweg (nach dem Titel
// oder sofort per Crossfade).

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnMaChaCastApp } from '../app.ts';
import type { JobMode } from '../../core/scheduler.ts';
import { AppError } from '../model.ts';

export const NEWS_IDS = [1, 2, 3] as const;
export type NewsId = (typeof NEWS_IDS)[number];
export const NEWS_LABEL: Record<NewsId, string> = { 1: 'Nachrichten + Wetter', 2: 'Nachrichten', 3: 'Wetter' };
const NEWS_URL = 'https://api.radioadmin.laut.fm/news/';
const STATION_RE = /^[a-z0-9-]{2,40}$/i;
const MAX_BYTES = 40 * 1024 * 1024;

export interface NewsCreds { station: string; password: string; outputId: string; outputName: string }
export interface NewsFileMeta { file: string; t: number; changedAt: number; bytes: number; md5: string; err: string }
export interface NewsConfig { outputId?: string }

/** laut.fm-Live-Server? (live.laut.fm, stream.laut.fm, *.laut.fm) */
export function isLautHost(host: string): boolean {
  return /(^|\.)laut\.fm$/i.test(host.trim());
}

/** Letzter laut.fm-Aktualisierungszeitpunkt (xx:50) vor „now“. */
export function newsBoundary(now = Date.now()): number {
  const d = new Date(now);
  d.setSeconds(0, 0);
  if (d.getMinutes() < 50) d.setHours(d.getHours() - 1);
  d.setMinutes(50);
  return d.getTime();
}

export class NewsService {
  private readonly meta = new Map<string, NewsFileMeta>();
  private readonly busy = new Map<string, Promise<NewsFileMeta>>();
  /** Test-/Austauschpunkt: Download-Funktion */
  fetchImpl: typeof fetch = (...a) => fetch(...a);

  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private dir(): string {
    const d = join(this.app.dataDir, 'news');
    mkdirSync(d, { recursive: true });
    return d;
  }

  config(stationId: string): NewsConfig {
    return this.app.rt(stationId).data.news ?? {};
  }

  saveConfig(stationId: string, input: Record<string, unknown>): NewsConfig {
    const rt = this.app.rt(stationId);
    const cfg: NewsConfig = { ...rt.data.news };
    if ('outputId' in input) {
      const id = typeof input.outputId === 'string' && input.outputId ? input.outputId : undefined;
      if (id && !this.candidates(stationId).some((c) => c.outputId === id)) throw new AppError(400, 'invalid_output', 'Dieser Ausgang ist kein laut.fm-Stream mit Passwort');
      cfg.outputId = id;
    }
    rt.data.news = cfg;
    this.app.changed();
    return cfg;
  }

  /** Alle laut.fm-Ausgänge dieses Senders, aus denen Sendername + Live-Passwort ableitbar sind. */
  candidates(stationId: string): NewsCreds[] {
    const out: NewsCreds[] = [];
    for (const o of this.app.outputs.values()) {
      const c = o.cfg;
      if (c.stationId !== stationId || !isLautHost(c.host)) continue;
      const station = c.mount.replace(/^\/+/, '').split('?')[0]!;
      const password = this.app.secrets.get(c.passwordRef);
      if (!STATION_RE.test(station) || !password) continue;
      out.push({ station, password, outputId: c.id, outputName: c.name });
    }
    return out;
  }

  creds(stationId: string): NewsCreds | null {
    const list = this.candidates(stationId);
    const want = this.config(stationId).outputId;
    return (want && list.find((c) => c.outputId === want)) || list[0] || null;
  }

  private key(c: NewsCreds, id: NewsId): string {
    return `${c.station.toLowerCase()}_${id}`;
  }

  private loadMeta(key: string): NewsFileMeta | null {
    const m = this.meta.get(key);
    if (m) return m;
    try {
      const j = JSON.parse(readFileSync(join(this.dir(), `${key}.json`), 'utf8')) as NewsFileMeta;
      if (j && j.file && existsSync(j.file)) { this.meta.set(key, j); return j; }
    } catch {
      // keine/kaputte Meta-Datei → neu holen
    }
    return null;
  }

  summary(stationId: string): unknown {
    const c = this.creds(stationId);
    const bound = newsBoundary();
    const files = NEWS_IDS.map((id) => {
      if (!c) return { id, label: NEWS_LABEL[id], have: false };
      const m = this.loadMeta(this.key(c, id));
      const have = !!m && !!m.file && existsSync(m.file);
      return { id, label: NEWS_LABEL[id], have, t: m?.t ?? 0, changedAt: m?.changedAt ?? 0, bytes: m?.bytes ?? 0, fresh: have && m!.t >= bound + 45_000, err: m?.err ?? '' };
    });
    return {
      creds: c ? { ok: true, station: c.station, outputId: c.outputId, outputName: c.outputName } : { ok: false },
      sources: this.candidates(stationId).map((x) => ({ outputId: x.outputId, station: x.station, name: x.outputName })),
      selected: this.config(stationId).outputId ?? '',
      nextUpdate: bound + 3_600_000,
      running: this.app.playouts.has(stationId),
      files,
    };
  }

  /** Aktuellste Datei (Cache oder frisch von laut.fm). */
  async latest(stationId: string, id: NewsId, force = false): Promise<NewsFileMeta> {
    if (!NEWS_IDS.includes(id)) throw new AppError(400, 'invalid_news', 'Beitrag 1 (Kombi), 2 (Nachrichten) oder 3 (Wetter)');
    const c = this.creds(stationId);
    if (!c) throw new AppError(409, 'no_lautfm', 'Kein laut.fm-Zugang: zuerst unter „Verbreitung“ den laut.fm-Live-Stream (Sendername + Live-Passwort) als Ausgang anlegen');
    const key = this.key(c, id);
    const m = this.loadMeta(key);
    if (m && !force && m.file && existsSync(m.file) && m.t >= newsBoundary() + 45_000) return m;
    const running = this.busy.get(key);
    if (running) return running;
    const p = this.download(c, id, key, m).finally(() => this.busy.delete(key));
    this.busy.set(key, p);
    return p;
  }

  private async download(c: NewsCreds, id: NewsId, key: string, prev: NewsFileMeta | null): Promise<NewsFileMeta> {
    const dir = this.dir();
    const tmp = join(dir, `${key}.tmp`);
    try {
      const r = await this.fetchImpl(NEWS_URL + id, {
        headers: { Authorization: `Basic ${Buffer.from(`${c.station}:${c.password}`).toString('base64')}`, 'User-Agent': 'AnMaChaCast' },
        signal: AbortSignal.timeout(60_000),
      }).catch(() => { throw new AppError(502, 'upstream_unreachable', 'laut.fm nicht erreichbar'); });
      if (r.status === 401 || r.status === 403) throw new AppError(403, 'lautfm_rejected', 'laut.fm lehnt den Zugang ab (Sendername/Live-Passwort des Ausgangs prüfen)');
      if (!r.ok) throw new AppError(502, 'lautfm_error', `laut.fm antwortete ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000) throw new AppError(502, 'lautfm_empty', 'laut.fm lieferte keine Audiodatei (Beitrag noch nicht erzeugt?)');
      if (buf.length > MAX_BYTES) throw new AppError(502, 'lautfm_too_big', 'Datei zu groß');
      writeFileSync(tmp, buf);
      const md5 = (await import('node:crypto')).createHash('md5').update(buf).digest('hex');
      const dest = join(dir, `${key}_${Date.now()}.mp3`);
      renameSync(tmp, dest);
      const now = Date.now();
      const meta: NewsFileMeta = { file: dest, t: now, changedAt: prev && prev.md5 === md5 ? prev.changedAt : now, bytes: buf.length, md5, err: '' };
      this.meta.set(key, meta);
      writeFileSync(join(dir, `${key}.json`), JSON.stringify(meta));
      // alte Versionen (> 3 h) wegräumen
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (f.startsWith(`${key}_`) && p !== dest && now - statSync(p).mtimeMs > 3 * 3_600_000) rmSync(p, { force: true });
      }
      return meta;
    } catch (err) {
      rmSync(tmp, { force: true });
      const msg = (err as Error).message;
      if (prev) { prev.err = msg; this.meta.set(key, prev); } else this.meta.set(key, { file: '', t: 0, changedAt: 0, bytes: 0, md5: '', err: msg });
      throw err;
    }
  }

  /** Datei zum Anhören/Herunterladen (Pfad); holt bei Bedarf frisch. */
  async filePath(stationId: string, id: NewsId): Promise<string> {
    return (await this.latest(stationId, id)).file;
  }

  /**
   * Jetzt senden: aktuellste Datei als Bibliothekstitel (Kategorie news, Ordner „Nachrichten“) ablegen -
   * je Beitrag genau ein Titel, der bei jedem Einsatz erneuert wird - und über den Planungsweg abspielen.
   */
  async air(stationId: string, id: NewsId, mode: JobMode = 'track', origin = 'news'): Promise<{ mediaId: string; label: string }> {
    const meta = await this.latest(stationId, id);
    const rt = this.app.rt(stationId);
    const mediaId = `news-${id}`;
    const file = `${mediaId}.mp3`;
    mkdirSync(join(this.app.mediaDir, stationId), { recursive: true });
    writeFileSync(join(this.app.mediaDir, stationId, file), readFileSync(meta.file));
    const label = `${NEWS_LABEL[id]} ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    const existing = rt.data.library.find((m) => m.id === mediaId);
    if (existing) {
      existing.title = label;
      existing.durationMs = null;
      existing.addedAt = Date.now();
      this.app.publish('library.changed', stationId, { updated: existing });
    } else {
      this.app.svc.media.addMedia(stationId, { id: mediaId, title: label, artist: 'laut.fm', category: 'news', file, durationMs: null, addedAt: Date.now(), folder: 'Nachrichten' });
    }
    this.app.svc.planning.executeTarget(stationId, { kind: 'media', mediaId, mode, label }, origin);
    return { mediaId, label };
  }
}
