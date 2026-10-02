// Planung: Playlists, Zeitplan-Jobs, Stunden-Uhr, Sendeplan und deren Ausführung im Takt des Kerns.

import { existsSync } from 'node:fs';
import type { AnMaChaCastApp } from '../app.ts';
import { MEDIA_CATEGORIES, pickNext as pickFromPool, shuffleSeparated, type MediaItem } from '../../core/automation.ts';
import {
  activeWindow, clockDue, dueJobs, nextOccurrence, validateClock, validateWindow,
  type ClockEvent, type JobTarget, type ProgramPlan, type Repeat, type ScheduledJob,
} from '../../core/scheduler.ts';
import { AppError, newId, safeColor, type Playlist, type RotationPool } from '../model.ts';
import { blockMatch, normalizeBlock, type SmartBlock } from '../../core/smartblocks.ts';
import { NEWS_LABEL } from './news.ts';

export type PreflightStatus = 'ok' | 'warning' | 'empty' | 'missing';

export interface PreflightItem {
  source: 'job' | 'clock' | 'plan' | 'pool';
  id: string;
  label: string;
  status: PreflightStatus;
  message: string;
}

export interface PreflightReport {
  generatedAt: number;
  items: PreflightItem[];
  summary: { ok: number; warnings: number; problems: number };
}

export class PlanningService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  lastSchedAt = Date.now();

  readonly activePlanId = new Map<string, string | null>();

  playlists(stationId: string): Playlist[] {
    return this.app.rt(stationId).data.playlists ?? [];
  }

  savePlaylist(stationId: string, id: string | null, input: { name?: string; color?: string; items?: unknown; mode?: unknown }): Playlist {
    const rt = this.app.rt(stationId);
    const list = (rt.data.playlists ??= []);
    let pl = id ? list.find((p) => p.id === id) : undefined;
    if (id && !pl) throw new AppError(404, 'not_found', 'Playlist nicht gefunden');
    if (!pl) {
      pl = { id: newId('pl'), name: 'Neue Playlist', color: '#19c3e6', items: [] };
      list.push(pl);
    }
    if (typeof input.name === 'string' && input.name.trim()) pl.name = input.name.trim().slice(0, 80);
    if (input.color !== undefined) pl.color = safeColor(input.color, pl.color);
    if (Array.isArray(input.items)) {
      const valid = new Set(rt.data.library.map((m) => m.id));
      pl.items = input.items.map(String).filter((x) => valid.has(x)).slice(0, 5000);
      delete pl.shuffleOrder; // Reihenfolge ist ungültig geworden, wird bei Bedarf neu gemischt
    }
    if (input.mode === 'manual' || input.mode === 'shuffle') pl.mode = input.mode;
    this.app.publish('playlists.changed', stationId, list);
    this.app.changed();
    return pl;
  }

  /** Playlist im Shuffle-Modus neu mischen: Fisher-Yates, danach direkt aufeinanderfolgende Titel desselben Interpreten möglichst auflösen. */
  reshufflePlaylist(stationId: string, id: string): Playlist {
    const rt = this.app.rt(stationId);
    const pl = rt.data.playlists?.find((p) => p.id === id);
    if (!pl) throw new AppError(404, 'not_found', 'Playlist nicht gefunden');
    const byId = new Map(rt.data.library.map((m) => [m.id, m]));
    const order = shuffleSeparated(pl.items, (mid) => byId.get(mid)?.artist ?? '');
    pl.shuffleOrder = order;
    this.app.publish('playlists.changed', stationId, rt.data.playlists);
    this.app.changed();
    return pl;
  }

  deletePlaylist(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    if (rt.data.plans?.some((p) => p.playlistId === id)) throw new AppError(409, 'in_use', 'Playlist wird im Sendeplan verwendet');
    rt.data.playlists = (rt.data.playlists ?? []).filter((p) => p.id !== id);
    if (rt.data.rotationPool) rt.data.rotationPool.entries = rt.data.rotationPool.entries.filter((e) => e.playlistId !== id);
    this.app.publish('playlists.changed', stationId, rt.data.playlists);
    this.app.changed();
  }

  saveQueueAsPlaylist(stationId: string, name: string): Playlist {
    return this.savePlaylist(stationId, null, { name, items: this.app.rt(stationId).queue.list().map((q) => q.mediaId) });
  }

  /** Titel einer Playlist - bei dynamischen Playlisten frisch aus dem Smart Block gezogen. */
  playlistItems(stationId: string, pl: Playlist): string[] {
    const rt = this.app.rt(stationId);
    if (pl.block) {
      const blk = rt.data.smartBlocks?.find((b) => b.id === pl.block);
      return blk ? blockMatch(rt.data.library, blk, { plays: this.playCounts(stationId) }).map((m) => m.id) : [];
    }
    return pl.items.filter((id) => rt.data.library.some((m) => m.id === id));
  }

  private playCounts(stationId: string): Map<string, number> {
    const plays = new Map<string, number>();
    for (const e of this.app.rt(stationId).data.playLog ?? []) plays.set(e.mediaId, (plays.get(e.mediaId) ?? 0) + 1);
    return plays;
  }

  /** Playlist abspielen: ersetzt die Queue und schaltet per Crossfade weiter. Im Shuffle-Modus mit gemischter Reihenfolge. */
  playPlaylist(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    const pl = rt.data.playlists?.find((p) => p.id === id);
    if (pl?.block) {
      const items = this.playlistItems(stationId, pl);
      if (!items.length) throw new AppError(404, 'empty', 'Der Smart Block liefert gerade keine Titel');
      rt.queue.clear();
      for (const mid of items) rt.queue.add(mid, 'manual');
      this.app.publishQueue(stationId);
      this.app.advance(stationId);
      return;
    }
    if (!pl || !pl.items.length) throw new AppError(404, 'empty', 'Playlist ist leer oder existiert nicht');
    let order = pl.items;
    if (pl.mode === 'shuffle') {
      if (!pl.shuffleOrder || pl.shuffleOrder.length !== pl.items.length || pl.shuffleOrder.some((mid) => !pl.items.includes(mid))) this.reshufflePlaylist(stationId, id);
      order = pl.shuffleOrder ?? pl.items;
    }
    rt.queue.clear();
    for (const mid of order) rt.queue.add(mid, 'manual');
    this.app.publishQueue(stationId);
    this.app.advance(stationId);
  }

  planning(stationId: string): unknown {
    const d = this.app.rt(stationId).data;
    const now = new Date();
    return {
      jobs: [...(d.jobs ?? [])].sort((a, b) => a.at - b.at), clockEvents: d.clockEvents ?? [], plans: d.plans ?? [],
      recPlans: d.recPlans ?? [], activePlanId: activeWindow(d.plans ?? [], now)?.id ?? null,
    };
  }

  saveJob(stationId: string, input: Record<string, unknown>): ScheduledJob {
    const rt = this.app.rt(stationId);
    const at = typeof input.at === 'string' || typeof input.at === 'number' ? new Date(input.at).getTime() : NaN;
    if (!Number.isFinite(at)) throw new AppError(400, 'invalid_time', 'Ungültiger Zeitpunkt');
    const repeat = (['none', 'hourly', 'daily', 'weekdays', 'weekly'] as Repeat[]).includes(input.repeat as Repeat) ? (input.repeat as Repeat) : 'none';
    const job: ScheduledJob = { id: newId('job'), at, repeat, ...this.jobTarget(stationId, input) };
    (rt.data.jobs ??= []).push(job);
    this.planningChanged(stationId);
    return job;
  }

  deleteJob(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    rt.data.jobs = (rt.data.jobs ?? []).filter((j) => j.id !== id);
    this.planningChanged(stationId);
  }

  saveClockEvent(stationId: string, id: string | null, input: Record<string, unknown>): ClockEvent {
    const rt = this.app.rt(stationId);
    const list = (rt.data.clockEvents ??= []);
    const ints = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number))].sort((a, b) => a - b) : []);
    const ev: ClockEvent = {
      id: id ?? newId('clk'), enabled: input.enabled !== false, minutes: ints(input.minutes), hours: ints(input.hours), days: ints(input.days),
      ...this.jobTarget(stationId, input),
    };
    try {
      validateClock(ev);
    } catch (err) {
      throw new AppError(400, 'invalid_clock', (err as Error).message);
    }
    const i = list.findIndex((e) => e.id === ev.id);
    if (id && i === -1) throw new AppError(404, 'not_found', 'Uhr-Event nicht gefunden');
    if (i === -1) list.push(ev);
    else list[i] = ev;
    this.planningChanged(stationId);
    return ev;
  }

  deleteClockEvent(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    rt.data.clockEvents = (rt.data.clockEvents ?? []).filter((e) => e.id !== id);
    this.planningChanged(stationId);
  }

  /** Uhr-Event sofort auslösen (Test). */
  fireClockEvent(stationId: string, id: string): void {
    const ev = this.app.rt(stationId).data.clockEvents?.find((e) => e.id === id);
    if (!ev) throw new AppError(404, 'not_found', 'Uhr-Event nicht gefunden');
    this.executeTarget(stationId, ev, 'manual');
  }

  savePlan(stationId: string, id: string | null, input: Record<string, unknown>): ProgramPlan {
    const rt = this.app.rt(stationId);
    const list = (rt.data.plans ??= []);
    const plan: ProgramPlan = {
      id: id ?? newId('plan'), label: String(input.label ?? 'Sendung').slice(0, 80), days: Array.isArray(input.days) ? input.days.map(Number) : [],
      from: String(input.from ?? ''), to: String(input.to ?? ''), playlistId: String(input.playlistId ?? ''), shuffle: input.shuffle === true,
    };
    try {
      validateWindow(plan);
    } catch (err) {
      throw new AppError(400, 'invalid_window', (err as Error).message);
    }
    if (!rt.data.playlists?.some((p) => p.id === plan.playlistId)) throw new AppError(400, 'invalid_playlist', 'Playlist wählen');
    const i = list.findIndex((p) => p.id === plan.id);
    if (id && i === -1) throw new AppError(404, 'not_found', 'Sendeplan-Eintrag nicht gefunden');
    if (i === -1) list.push(plan);
    else list[i] = plan;
    this.planningChanged(stationId);
    return plan;
  }

  deletePlan(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    rt.data.plans = (rt.data.plans ?? []).filter((p) => p.id !== id);
    this.planningChanged(stationId);
  }

  jobTarget(stationId: string, input: Record<string, unknown>): JobTarget {
    const kind = input.kind as JobTarget['kind'];
    const mode = (['now', 'track', 'fx'] as const).includes(input.mode as never) ? (input.mode as JobTarget['mode']) : 'track';
    const label = typeof input.label === 'string' ? input.label.slice(0, 80) : undefined;
    const rt = this.app.rt(stationId);
    switch (kind) {
      case 'media':
        this.app.svc.media.media(stationId, String(input.mediaId ?? ''));
        return { kind, mediaId: String(input.mediaId), mode, label };
      case 'folder':
        if (!rt.data.library.some((m) => (m.folder ?? '') === String(input.folder ?? ''))) throw new AppError(400, 'empty_folder', 'Ordner ist leer');
        return { kind, folder: String(input.folder ?? ''), mode, label };
      case 'url': {
        const m = this.app.svc.media.addUrlMedia(stationId, { url: String(input.url ?? ''), title: label, durationMs: Number(input.durationMs) || undefined });
        return { kind: 'media', mediaId: m.id, mode, label: label ?? m.title };
      }
      case 'playlist':
        if (!rt.data.playlists?.some((p) => p.id === input.playlistId)) throw new AppError(400, 'invalid_playlist', 'Playlist wählen');
        return { kind, playlistId: String(input.playlistId), mode: 'now', label };
      case 'category': {
        const category = String(input.category ?? '');
        if (!(MEDIA_CATEGORIES as readonly string[]).includes(category)) throw new AppError(400, 'invalid_category', 'Unbekannte Kategorie');
        if (!rt.data.library.some((m) => m.category === category)) throw new AppError(400, 'empty_category', 'In dieser Kategorie ist noch nichts hochgeladen');
        return { kind, category, mode, label };
      }
      case 'news': {
        const newsId = Number(input.newsId);
        if (![1, 2, 3].includes(newsId)) throw new AppError(400, 'invalid_news', 'Beitrag 1 (Kombi), 2 (Nachrichten) oder 3 (Wetter)');
        if (!this.app.svc.news.creds(stationId)) throw new AppError(409, 'no_lautfm', 'Kein laut.fm-Zugang: zuerst den laut.fm-Live-Stream als Ausgang anlegen');
        return { kind, newsId, mode: mode === 'fx' ? 'track' : mode, label: label ?? NEWS_LABEL[newsId as 1 | 2 | 3] };
      }
      case 'ai': {
        const aiKind = input.aiKind === 'news' ? 'news' : 'break';
        if (!this.app.svc.ai.aiConfig(stationId).enabled) throw new AppError(409, 'ai_disabled', 'KI-Regisseur ist aus: zuerst unter KI einen Text- und Stimm-Anbieter einrichten und einschalten');
        return { kind, aiKind, mode: 'track', label: label ?? (aiKind === 'news' ? 'KI-Nachrichten' : 'KI-Ansage') };
      }
      default:
        throw new AppError(400, 'invalid_kind', 'Art: media, folder, url, playlist, category, news oder ai');
    }
  }

  planningChanged(stationId: string): void {
    this.app.publish('planning.changed', stationId, this.planning(stationId));
    this.app.changed();
  }

  /**
   * Preflight/Simulation (Abschnitt 23): prüft den kompletten Sendeplan (Zeitplan-Jobs, Uhr-Events,
   * Sendeplan-Sendungen) UND die Uhr-Vorlage auf fehlende Dateien/Streams, leere Ordner/Playlists und
   * Pools, die für die aktuellen Rotationsregeln zu klein sind - bevor es auf Sendung geht, nicht erst
   * live beim Abspielen. Reine Prüfung, verändert nichts.
   */
  preflight(stationId: string): PreflightReport {
    const rt = this.app.rt(stationId);
    const lib = rt.data.library;
    const now = Date.now();
    const items: PreflightItem[] = [];
    const available = (m: MediaItem): boolean => (m.url ? !!m.url.trim() : existsSync(this.app.svc.media.mediaPath(stationId, m)));

    const checkTarget = (source: PreflightItem['source'], id: string, label: string, t: JobTarget): void => {
      if (t.kind === 'media') {
        const m = lib.find((x) => x.id === t.mediaId);
        if (!m) { items.push({ source, id, label, status: 'missing', message: `Titel wurde gelöscht (${t.mediaId})` }); return; }
        if (!available(m)) {
          items.push({ source, id, label, status: 'missing', message: `Datei/URL fehlt: „${m.title}“` });
          return;
        }
        items.push({ source, id, label, status: 'ok', message: m.artist ? `${m.artist} – ${m.title}` : m.title });
      } else if (t.kind === 'folder') {
        const pool = lib.filter((m) => (m.folder ?? '') === t.folder && available(m));
        if (!pool.length) { items.push({ source, id, label, status: 'empty', message: `Ordner „${t.folder}“ ist leer` }); return; }
        items.push({ source, id, label, status: 'ok', message: `Ordner „${t.folder}“ (${pool.length} Titel)` });
      } else if (t.kind === 'playlist') {
        const pl = rt.data.playlists?.find((p) => p.id === t.playlistId);
        if (!pl) { items.push({ source, id, label, status: 'missing', message: 'Playlist wurde gelöscht' }); return; }
        const valid = pl.items.filter((mid) => { const m = lib.find((x) => x.id === mid); return m && available(m); });
        if (!valid.length) { items.push({ source, id, label, status: 'empty', message: `Playlist „${pl.name}“ ist leer oder alle Titel fehlen` }); return; }
        if (valid.length < pl.items.length) {
          items.push({ source, id, label, status: 'warning', message: `Playlist „${pl.name}“: ${pl.items.length - valid.length} von ${pl.items.length} Titeln fehlen` });
          return;
        }
        items.push({ source, id, label, status: 'ok', message: `Playlist „${pl.name}“ (${valid.length} Titel)` });
      } else if (t.kind === 'category') {
        const pool = lib.filter((m) => m.category === t.category && available(m));
        if (!pool.length) { items.push({ source, id, label, status: 'empty', message: `Kategorie „${t.category}“ ist leer` }); return; }
        items.push({ source, id, label, status: 'ok', message: `Kategorie „${t.category}“ (${pool.length} Titel)` });
      } else if (t.kind === 'news') {
        if (!this.app.svc.news.creds(stationId)) { items.push({ source, id, label, status: 'missing', message: 'Kein laut.fm-Zugang (Ausgang fehlt)' }); return; }
        items.push({ source, id, label, status: 'ok', message: 'laut.fm-Nachrichten (zur Startzeit geholt)' });
      } else if (t.kind === 'ai') {
        if (!this.app.svc.ai.aiConfig(stationId).enabled) { items.push({ source, id, label, status: 'warning', message: 'KI-Regisseur ist aus – Ansage entfällt' }); return; }
        items.push({ source, id, label, status: 'ok', message: t.aiKind === 'news' ? 'KI-Nachrichten (zur Startzeit erzeugt)' : 'KI-Ansage (zur Startzeit erzeugt)' });
      }
    };

    for (const j of rt.data.jobs ?? []) {
      if (j.repeat === 'none' && j.at <= now) continue; // vorbei, nicht mehr relevant
      checkTarget('job', j.id, j.label || `Zeitplan: ${j.kind}`, j);
    }
    for (const e of rt.data.clockEvents ?? []) {
      if (!e.enabled) continue;
      checkTarget('clock', e.id, e.label || `Uhr-Event: ${e.kind}`, e);
    }
    for (const p of rt.data.plans ?? []) {
      checkTarget('plan', p.id, p.label, { kind: 'playlist', playlistId: p.playlistId, mode: 'now' });
    }

    // Uhr-Vorlage (Kategorien-Takt): reicht der Pool je Kategorie für die aktuellen Rotationsregeln?
    for (const cat of new Set(rt.data.clock.slots)) {
      const poolSize = lib.filter((m) => m.category === cat && available(m)).length;
      const id = `pool-${cat}`;
      const label = `Uhr-Vorlage: Kategorie „${cat}“`;
      if (poolSize === 0) items.push({ source: 'pool', id, label, status: 'empty', message: `Keine Titel in Kategorie „${cat}“ - dieser Takt kann nicht gefüllt werden` });
      else if (poolSize <= rt.data.rotation.titleSeparation) items.push({ source: 'pool', id, label, status: 'warning', message: `Nur ${poolSize} Titel in „${cat}“, aber Titeltrennung verlangt ${rt.data.rotation.titleSeparation} - Regel kann nicht eingehalten werden, Titel wiederholen sich früher` });
      else items.push({ source: 'pool', id, label, status: 'ok', message: `${poolSize} Titel in „${cat}“` });
    }

    const summary = {
      ok: items.filter((i) => i.status === 'ok').length,
      warnings: items.filter((i) => i.status === 'warning').length,
      problems: items.filter((i) => i.status === 'empty' || i.status === 'missing').length,
    };
    return { generatedAt: now, items, summary };
  }

  // ---------- Smart Blocks & Allgemeine Rotation ----------

  smartBlocks(stationId: string): (SmartBlock & { count: number })[] {
    const rt = this.app.rt(stationId);
    return (rt.data.smartBlocks ?? []).map((b) => ({ ...b, count: blockMatch(rt.data.library, b, { ignoreLimit: true }).length }));
  }

  saveSmartBlock(stationId: string, id: string | null, input: Record<string, unknown>): SmartBlock {
    const rt = this.app.rt(stationId);
    const list = (rt.data.smartBlocks ??= []);
    if (!id && list.length >= 60) throw new AppError(400, 'too_many', 'Maximal 60 Smart Blocks');
    let blk: SmartBlock;
    try {
      blk = normalizeBlock(input, id ?? newId('blk'));
    } catch (err) {
      throw new AppError(400, 'invalid_block', (err as Error).message);
    }
    const i = list.findIndex((b) => b.id === blk.id);
    if (id && i === -1) throw new AppError(404, 'not_found', 'Smart Block nicht gefunden');
    if (i === -1) list.push(blk);
    else list[i] = blk;
    this.app.publish('playlists.changed', stationId, rt.data.playlists ?? []);
    this.app.changed();
    return blk;
  }

  deleteSmartBlock(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    rt.data.smartBlocks = (rt.data.smartBlocks ?? []).filter((b) => b.id !== id);
    // dynamische Playlisten daraus werden leer, bleiben aber bestehen
    for (const p of rt.data.playlists ?? []) if (p.block === id) { delete p.block; p.items = []; }
    this.app.publish('playlists.changed', stationId, rt.data.playlists ?? []);
    this.app.changed();
  }

  /** Vorschau: gespeicherter Block (id) oder Entwurf (block) → Treffer, Minuten, Gesamtzahl passender Titel. */
  previewSmartBlock(stationId: string, input: { id?: unknown; block?: unknown }): { items: unknown[]; count: number; minutes: number; totalMatching: number } {
    const rt = this.app.rt(stationId);
    let blk: SmartBlock | undefined;
    if (input.block && typeof input.block === 'object') {
      try { blk = normalizeBlock(input.block as Record<string, unknown>, 'preview'); } catch (err) { throw new AppError(400, 'invalid_block', (err as Error).message); }
    } else blk = rt.data.smartBlocks?.find((b) => b.id === String(input.id ?? ''));
    if (!blk) throw new AppError(404, 'not_found', 'Smart Block nicht gefunden');
    const items = blockMatch(rt.data.library, blk, { plays: this.playCounts(stationId) });
    const total = blockMatch(rt.data.library, blk, { ignoreLimit: true }).length;
    return {
      items: items.slice(0, 200).map((m) => ({ id: m.id, title: m.title, artist: m.artist, category: m.category, durationMs: m.durationMs })),
      count: items.length, minutes: Math.round(items.reduce((a, m) => a + (m.durationMs ?? 0), 0) / 60_000), totalMatching: total,
    };
  }

  /** Smart Block als Playlist: dynamisch (frisch gezogen) oder als feste Momentaufnahme. */
  smartBlockToPlaylist(stationId: string, id: string, snapshot: boolean, name?: string): Playlist {
    const rt = this.app.rt(stationId);
    const blk = rt.data.smartBlocks?.find((b) => b.id === id);
    if (!blk) throw new AppError(404, 'not_found', 'Smart Block nicht gefunden');
    const pl = this.savePlaylist(stationId, null, { name: (name?.trim() || `${blk.name}${snapshot ? ' (Momentaufnahme)' : ''}`).slice(0, 80), color: '#818cf8' });
    if (snapshot) pl.items = blockMatch(rt.data.library, blk, { plays: this.playCounts(stationId) }).map((m) => m.id);
    else pl.block = blk.id;
    this.app.publish('playlists.changed', stationId, rt.data.playlists ?? []);
    this.app.changed();
    return pl;
  }

  rotationPool(stationId: string): RotationPool {
    return this.app.rt(stationId).data.rotationPool ?? { on: false, entries: [] };
  }

  setRotationPool(stationId: string, input: Record<string, unknown>): RotationPool {
    const rt = this.app.rt(stationId);
    const ids = new Set((rt.data.playlists ?? []).map((p) => p.id));
    const entries = (Array.isArray(input.entries) ? input.entries : []).slice(0, 20)
      .map((e: Record<string, unknown>) => ({ playlistId: String(e.playlistId ?? ''), weight: Math.max(1, Math.min(20, Math.floor(Number(e.weight)) || 1)) }))
      .filter((e) => ids.has(e.playlistId));
    const on = input.on === true;
    if (on && !entries.length) throw new AppError(400, 'empty_pool', 'Mindestens eine Playlist für die Allgemeine Rotation wählen');
    rt.data.rotationPool = { on, entries };
    this.app.publish('automation.state_changed', stationId, this.app.automationView(stationId));
    this.app.changed();
    return rt.data.rotationPool;
  }

  /**
   * Allgemeine Rotation füllen: Playlist nach Gewicht ziehen, darin der Reihe nach (eigener Zähler je Playlist),
   * Interpreten-/Titelabstand über pickNext. Liefert false, wenn der Pool nichts liefern kann.
   */
  fillFromPool(stationId: string, random: () => number = Math.random): boolean {
    const rt = this.app.rt(stationId);
    const pool = rt.data.rotationPool;
    if (!pool?.on) return false;
    const lists = pool.entries.map((e) => ({ e, pl: rt.data.playlists?.find((p) => p.id === e.playlistId) })).filter((x): x is { e: RotationPool['entries'][number]; pl: Playlist } => !!x.pl);
    const resolved = lists.map((x) => ({ ...x, items: this.playlistItems(stationId, x.pl) })).filter((x) => x.items.length);
    if (!resolved.length) return false;
    const cursors = (rt.data.poolCursor ??= {});
    const total = resolved.reduce((a, x) => a + x.e.weight, 0);
    let guard = rt.data.minQueue * 3;
    while (rt.queue.length < rt.data.minQueue && guard-- > 0) {
      let r = random() * total;
      let pick = resolved[0]!;
      for (const x of resolved) { r -= x.e.weight; if (r < 0) { pick = x; break; } }
      const recent = [...rt.queue.list().map((q) => q.mediaId).reverse(), ...rt.data.history];
      let next: string | undefined;
      if (pick.pl.mode === 'shuffle' || pick.pl.block) {
        const lib = rt.data.library.filter((m) => pick.items.includes(m.id));
        next = pickFromPool(lib.map((m) => ({ ...m, category: 'music' as const })), 'music', recent, rt.data.rotation, random)?.id ?? pick.items[0];
      } else {
        const c = (cursors[pick.pl.id] ?? 0) % pick.items.length;
        next = pick.items[c];
        cursors[pick.pl.id] = c + 1;
      }
      if (next) rt.queue.add(next, 'plan');
    }
    return true;
  }

  executeTarget(stationId: string, t: JobTarget, origin: string): void {
    const rt = this.app.rt(stationId);
    if (t.kind === 'news') {
      // Datei wird zur Startzeit frisch geholt; air() führt danach selbst executeTarget(media) aus.
      this.app.svc.news.air(stationId, (t.newsId ?? 1) as 1 | 2 | 3, t.mode === 'fx' ? 'track' : t.mode, origin)
        .catch((err: Error) => this.app.audit.write({ kind: 'schedule', event: 'news_failed', stationId, label: t.label, error: err.message }));
      return;
    }
    if (t.kind === 'ai') {
      // Text + Stimme werden zur Startzeit erzeugt; der Regisseur hängt das Ergebnis vorn in die Warteschlange (oder zur Freigabe).
      this.app.director.produce(stationId, t.aiKind ?? 'break')
        .then((r) => { if (!r) this.app.audit.write({ kind: 'schedule', event: 'ai_busy', stationId, label: t.label }); })
        .catch((err: Error) => this.app.audit.write({ kind: 'schedule', event: 'ai_failed', stationId, label: t.label, error: err.message }));
      return;
    }
    if (t.kind === 'playlist') {
      this.playPlaylist(stationId, t.playlistId!);
    } else {
      let m: MediaItem | undefined;
      if (t.kind === 'media') m = rt.data.library.find((x) => x.id === t.mediaId);
      else {
        const pool = t.kind === 'category'
          ? rt.data.library.filter((x) => x.category === t.category)
          : rt.data.library.filter((x) => (x.folder ?? '') === t.folder);
        const picked = pickFromPool(pool.map((x) => ({ ...x, category: 'music' as const })), 'music', rt.data.history, rt.data.rotation);
        m = picked ? rt.data.library.find((x) => x.id === picked.id) : undefined;
      }
      if (!m) {
        this.app.audit.write({ kind: 'schedule', event: 'target_missing', stationId, label: t.label });
        return;
      }
      if (t.mode === 'fx') {
        const po = this.app.playouts.get(stationId);
        if (po) po.playout.playCart(m, true);
        else this.app.publish('automation.command', stationId, { action: 'fx', mediaId: m.id });
      } else {
        rt.queue.add(m.id, 'schedule', 0);
        this.app.publishQueue(stationId);
        if (t.mode === 'now') this.app.advance(stationId);
      }
    }
    this.app.audit.write({ kind: 'schedule', event: 'fired', stationId, origin, label: t.label, mode: t.mode });
    this.app.publish('schedule.fired', stationId, { label: t.label, kind: t.kind, mode: t.mode, origin });
  }

  processSchedules(): void {
    const now = Date.now();
    const from = this.lastSchedAt;
    this.lastSchedAt = now;
    const minuteChanged = Math.floor(from / 60000) !== Math.floor(now / 60000);
    for (const [stationId, rt] of this.app.stations) {
      // Zeitplan-Jobs
      const jobs = rt.data.jobs ?? [];
      const due = dueJobs(jobs, from, now);
      for (const j of due) {
        this.executeTarget(stationId, j, 'job');
        const next = nextOccurrence(j, now);
        if (next === null) rt.data.jobs = (rt.data.jobs ?? []).filter((x) => x.id !== j.id);
        else j.at = next;
      }
      // Verpasste einmalige Jobs (PC war aus) nicht nachholen, sondern aufräumen/weiterschieben
      for (const j of rt.data.jobs ?? []) {
        if (j.at < now - 60_000) {
          const next = nextOccurrence(j, now);
          if (next === null) rt.data.jobs = (rt.data.jobs ?? []).filter((x) => x.id !== j.id);
          else j.at = next;
        }
      }
      if (due.length) this.planningChanged(stationId);
      if (!minuteChanged) continue;
      const d = new Date(now);
      for (const ev of clockDue(rt.data.clockEvents ?? [], d)) this.executeTarget(stationId, ev, 'clock');
      // Sendeplan-Wechsel: automatisch gefüllte Einträge verwerfen, damit das neue Programm sofort greift
      const planId = activeWindow(rt.data.plans ?? [], d)?.id ?? null;
      if (this.activePlanId.has(stationId) && this.activePlanId.get(stationId) !== planId) {
        rt.queue.pruneOrigins(['clock', 'plan']);
        this.app.autoFill(rt);
        this.app.publishQueue(stationId);
        this.app.publish('planning.changed', stationId, this.planning(stationId));
      }
      this.activePlanId.set(stationId, planId);
      // Aufnahme-Zeitfenster
      const recPlan = activeWindow(rt.data.recPlans ?? [], d);
      const active = this.app.svc.recorder.recorders.get(stationId);
      if (recPlan && !active) this.app.svc.recorder.startRecording(stationId, recPlan.label, recPlan.id);
      if (!recPlan && active?.rec.planId) this.app.svc.recorder.stopRecording(stationId);
      // Zusatz-Streams mit Zeitfenster: pünktlich an-/abschalten (z. B. Simulcast nur zur Sendezeit)
      if ((rt.data.streamProfiles ?? []).some((sp) => sp.window)) this.app.syncStreamProfiles(stationId);
    }
  }
}
