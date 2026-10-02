// Motion-Mix-Video: aus einer Playlist ein fertiges MP4 erzeugen - animierter, senderfarbener
// Hintergrund, Audio-Wellenform und Titel-Einblendungen je Track, wie die "Motion Mix"-Videos von
// Foster Kent auf YouTube, aber mit eigenen, generativen Visuals (ffmpeg lavfi: gradients + showwaves)
// statt fremdem Bild-/Videomaterial. Läuft als Hintergrundjob (ffmpeg-Rendering braucht bei längeren
// Mixes Zeit), gleiches queued/running/succeeded/failed-Muster wie die MusikHub-Importjobs.

import type { AirDeckApp } from '../app.ts';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { playLength, type MediaItem } from '../../core/automation.ts';
import { probeDurationMs } from '../ffmpeg.ts';
import { AppError, newId, type MotionMixJob } from '../model.ts';

const MAX_TRACKS = 80;
const MAX_DURATION_MS = 3 * 60 * 60 * 1000;
const MAX_JOBS_PER_STATION = 20;
const WIDTH = 1280;
const HEIGHT = 720;
const CAPTION_SECONDS = 8;

export interface MotionMixPreset {
  label: string;
  /** gradients-Filter: 0=linear, 1=radial, 2=circular, 3=spiral */
  gradientType: 0 | 1 | 2 | 3;
  speed: number;
  waveMode: 'cline' | 'line' | 'p2p' | 'point';
  mono?: boolean;
}

export const MOTION_MIX_PRESETS: Record<string, MotionMixPreset> = {
  aurora: { label: 'Aurora (fließender Verlauf)', gradientType: 0, speed: 0.012, waveMode: 'cline' },
  nebula: { label: 'Nebula (kreisend)', gradientType: 2, speed: 0.02, waveMode: 'p2p' },
  spiral: { label: 'Spirale', gradientType: 3, speed: 0.015, waveMode: 'line' },
  mono: { label: 'Mono (schwarz/weiß, dezent)', gradientType: 0, speed: 0.01, waveMode: 'cline', mono: true },
};

/** Text für ffmpeg drawtext sicher in einfache Anführungszeichen einbetten (ffmpeg-eigene Escaping-Regeln, kein Shell). */
function escDrawtext(s: string): string {
  const clean = s.replace(/[\u0000-\u001f%]/g, ' ').replace(/'/g, `'\\''`).trim();
  return `'${clean}'`;
}

interface TrackSegment {
  media: MediaItem;
  path: string;
  startMs: number;
  durationMs: number;
}

export class MotionMixService {
  private readonly app: AirDeckApp;
  private readonly running = new Set<string>();

  constructor(app: AirDeckApp) {
    this.app = app;
  }

  presets(): Array<{ id: string } & MotionMixPreset> {
    return Object.entries(MOTION_MIX_PRESETS).map(([id, p]) => ({ id, ...p }));
  }

  jobs(stationId: string): MotionMixJob[] {
    return this.app.rt(stationId).data.motionMixJobs ?? [];
  }

  private dir(stationId: string): string {
    return join(this.app.dataDir, 'motionmix', stationId);
  }

  job(stationId: string, id: string): MotionMixJob {
    const j = this.jobs(stationId).find((x) => x.id === id);
    if (!j) throw new AppError(404, 'not_found', 'Motion-Mix-Job nicht gefunden');
    return j;
  }

  /** Datei eines fertigen Jobs (zum Herunterladen) - nur wenn tatsächlich erfolgreich gerendert. */
  file(stationId: string, id: string): string {
    const j = this.job(stationId, id);
    if (j.status !== 'succeeded' || !j.file) throw new AppError(409, 'not_ready', 'Video ist noch nicht fertig');
    const file = join(this.dir(stationId), j.file);
    if (!existsSync(file)) throw new AppError(404, 'not_found', 'Videodatei fehlt');
    return file;
  }

  async start(stationId: string, playlistId: string, presetId: string): Promise<MotionMixJob> {
    if (!this.app.ffmpeg) throw new AppError(409, 'no_ffmpeg', 'ffmpeg wird für Motion-Mix-Videos benötigt');
    const preset = MOTION_MIX_PRESETS[presetId];
    if (!preset) throw new AppError(400, 'invalid_preset', 'Unbekannte Vorlage');
    const rt = this.app.rt(stationId);
    const pl = rt.data.playlists?.find((p) => p.id === playlistId);
    if (!pl) throw new AppError(404, 'not_found', 'Playlist nicht gefunden');
    const order = pl.mode === 'shuffle' && pl.shuffleOrder?.length === pl.items.length ? pl.shuffleOrder : pl.items;
    const byId = new Map(rt.data.library.map((m) => [m.id, m]));
    const items = order.map((id) => byId.get(id)).filter((m): m is MediaItem => !!m && !m.url).slice(0, MAX_TRACKS);
    if (!items.length) throw new AppError(400, 'empty', 'Playlist enthält keine lokalen Titel (Streams können nicht gerendert werden)');

    const job: MotionMixJob = {
      id: newId('mmx'), playlistId, playlistName: pl.name, preset: presetId, status: 'queued', progress: 0,
      trackCount: items.length, durationMs: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const list = (rt.data.motionMixJobs ??= []);
    list.unshift(job);
    if (list.length > MAX_JOBS_PER_STATION) {
      const drop = list.splice(MAX_JOBS_PER_STATION);
      for (const d of drop) if (d.file) rmSync(join(this.dir(stationId), d.file), { force: true });
    }
    this.app.publish('motionmix.changed', stationId, this.jobs(stationId));
    this.app.changed();
    setImmediate(() => this.run(stationId, job.id, items, preset));
    return job;
  }

  private async run(stationId: string, jobId: string, items: MediaItem[], preset: MotionMixPreset): Promise<void> {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);
    const rt = this.app.rt(stationId);
    const job = rt.data.motionMixJobs?.find((j) => j.id === jobId);
    if (!job) {
      this.running.delete(jobId);
      return;
    }
    job.status = 'running';
    job.updatedAt = Date.now();
    this.app.publish('motionmix.changed', stationId, this.jobs(stationId));
    try {
      const segments = await this.resolveSegments(stationId, items);
      const totalMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
      if (totalMs <= 0) throw new AppError(400, 'empty', 'Keine spielbaren Titel mit bekannter Länge');
      if (totalMs > MAX_DURATION_MS) throw new AppError(400, 'too_long', `Mix ist länger als ${Math.round(MAX_DURATION_MS / 3_600_000)} Stunden`);
      job.durationMs = totalMs;
      const dir = this.dir(stationId);
      mkdirSync(dir, { recursive: true });
      const file = `${jobId}.mp4`;
      await this.render(stationId, segments, totalMs, preset, join(dir, file), (pct) => {
        job.progress = pct;
        job.updatedAt = Date.now();
      });
      job.status = 'succeeded';
      job.progress = 100;
      job.file = file;
      this.app.audit.write({ kind: 'motionmix', event: 'rendered', stationId, jobId, trackCount: segments.length, durationMs: totalMs });
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof AppError ? err.message : (err as Error).message;
      this.app.audit.write({ kind: 'motionmix', event: 'failed', stationId, jobId, error: job.error });
    }
    job.updatedAt = Date.now();
    this.app.publish('motionmix.changed', stationId, this.jobs(stationId));
    this.app.changed();
    this.running.delete(jobId);
  }

  private async resolveSegments(stationId: string, items: MediaItem[]): Promise<TrackSegment[]> {
    const media = this.app.svc.media;
    const segments: TrackSegment[] = [];
    let t = 0;
    for (const m of items) {
      const path = media.mediaPath(stationId, m);
      if (!existsSync(path)) continue;
      let durationMs = playLength(m);
      if (durationMs == null && this.app.ffmpeg?.ffprobe) durationMs = await probeDurationMs(this.app.ffmpeg.ffprobe, path);
      if (!durationMs || durationMs <= 0) continue;
      segments.push({ media: m, path, startMs: t, durationMs });
      t += durationMs;
    }
    return segments;
  }

  /** Baut den ffmpeg-Filtergraph und rendert das MP4. Fortschritt aus `-progress pipe:1` (out_time_ms). */
  private render(
    stationId: string, segments: TrackSegment[], totalMs: number, preset: MotionMixPreset, outFile: string, onProgress: (pct: number) => void,
  ): Promise<void> {
    const station = this.app.rt(stationId).station;
    const logo = this.app.svc.stations.stationLogo(stationId);
    const c0 = preset.mono ? '#141414' : station.primaryColor;
    const c1 = preset.mono ? '#303030' : station.accentColor;
    const waveColor = preset.mono ? '#ffffff' : station.accentColor;
    const totalSec = (totalMs / 1000).toFixed(2);

    const inputs: string[] = [];
    for (const s of segments) inputs.push('-i', s.path);
    const logoIndex = segments.length;
    if (logo) inputs.push('-loop', '1', '-i', logo.path);

    const parts: string[] = [];
    segments.forEach((_, i) => parts.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`));
    parts.push(`${segments.map((_, i) => `[a${i}]`).join('')}concat=n=${segments.length}:v=0:a=1[aout]`);
    parts.push('[aout]asplit=2[amux][avis]');
    parts.push(`[avis]showwaves=s=${WIDTH - 80}x200:mode=${preset.waveMode}:colors=${waveColor}:rate=25[wraw]`);
    parts.push('[wraw]format=rgba,colorchannelmixer=aa=0.75[wave]');
    parts.push(`gradients=size=${WIDTH}x${HEIGHT}:d=${totalSec}:speed=${preset.speed}:type=${preset.gradientType}:c0=${c0}:c1=${c1}:rate=25[bg]`);
    let last = 'bg';
    parts.push(`[${last}][wave]overlay=40:${HEIGHT - 240}[bg1]`);
    last = 'bg1';
    if (logo) {
      parts.push(`[${logoIndex}:v]scale=96:-1[logo]`);
      parts.push(`[${last}][logo]overlay=W-120:24[bg2]`);
      last = 'bg2';
    }
    parts.push(
      `[${last}]drawtext=text=${escDrawtext(station.name)}:fontsize=28:fontcolor=white:x=40:y=28:box=1:boxcolor=black@0.35:boxborderw=10[t0]`,
    );
    last = 't0';
    segments.forEach((s, i) => {
      const startSec = (s.startMs / 1000).toFixed(2);
      const endSec = (Math.min(s.startMs + CAPTION_SECONDS * 1000, s.startMs + s.durationMs) / 1000).toFixed(2);
      const caption = escDrawtext(s.media.artist ? `${s.media.artist} – ${s.media.title}` : s.media.title);
      const label = `t${i + 1}`;
      parts.push(
        `[${last}]drawtext=text=${caption}:fontsize=34:fontcolor=white:x=40:y=${HEIGHT - 280}:box=1:boxcolor=black@0.45:boxborderw=14:enable='between(t\\,${startSec}\\,${endSec})'[${label}]`,
      );
      last = label;
    });
    const filterComplex = parts.join(';');

    return new Promise((resolve, reject) => {
      const args = [
        '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
        ...inputs,
        '-filter_complex', filterComplex,
        '-map', `[${last}]`, '-map', '[amux]',
        '-t', totalSec,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
        '-progress', 'pipe:1',
        outFile,
      ];
      const p = spawn(this.app.ffmpeg!.ffmpeg, args, { windowsHide: true });
      let stderr = '';
      p.stderr?.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-4000);
      });
      let buf = '';
      p.stdout?.on('data', (d: Buffer) => {
        buf += d.toString();
        const m = /out_time_ms=(\d+)/.exec(buf);
        if (m) onProgress(Math.min(99, Math.round((Number(m[1]) / 1000 / totalMs) * 100)));
        buf = buf.slice(-200);
      });
      p.on('error', (e) => reject(e));
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg beendete sich mit Code ${code}`));
      });
    });
  }

  deleteJob(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    const j = this.job(stationId, id);
    if (j.status === 'running' || j.status === 'queued') throw new AppError(409, 'busy', 'Job läuft noch');
    if (j.file) rmSync(join(this.dir(stationId), j.file), { force: true });
    rt.data.motionMixJobs = (rt.data.motionMixJobs ?? []).filter((x) => x.id !== id);
    this.app.publish('motionmix.changed', stationId, this.jobs(stationId));
    this.app.changed();
  }
}
