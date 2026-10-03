// Voice Studio: Sprachaufnahmen und Jingles schneiden und aufbereiten (Wellenform-Schnitt, Rauschentfernung, EQ,
// Kompressor, Gate, Lautstärke, Fades). Alles läuft als ffmpeg-Filterkette auf dem Server; Vorhören rendert eine
// Vorschau, Speichern legt das Ergebnis als neuen Titel in die Bibliothek (das Original bleibt unverändert).
// Stimm-Klonen ist bewusst nicht enthalten (nur mit lokaler Engine sinnvoll, siehe docs/CONTROL_CENTER_TODO.md).

import type { AnMaChaCastApp } from '../app.ts';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MEDIA_CATEGORIES, type MediaItem } from '../../core/automation.ts';
import { probeDurationMs } from '../ffmpeg.ts';
import { AppError, newId } from '../model.ts';

const execFileP = promisify(execFile);

export const DENOISE = ['off', 'light', 'strong'] as const;
export const EQ_PRESETS = ['off', 'voice', 'warm', 'bright', 'phone'] as const;

export interface Range {
  fromMs: number;
  toMs: number;
}

export interface VoiceEditSpec {
  /** nur diesen Bereich behalten (Dateizeit in ms) */
  keep?: Range | null;
  /** diese Bereiche herausschneiden (Dateizeit in ms) */
  cuts?: Range[];
  /** lange Pausen (> 0,6 s) im Inneren entfernen */
  stripSilence?: boolean;
  denoise?: (typeof DENOISE)[number];
  eq?: (typeof EQ_PRESETS)[number];
  compressor?: boolean;
  gate?: boolean;
  gainDb?: number;
  normalize?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  title?: string;
  category?: string;
}

const MIN_SEGMENT_MS = 20;
const CLICK_FADE_S = 0.008;

/** Bereiche begrenzen, sortieren und zusammenfassen. */
function normRanges(list: Range[], max: number): Range[] {
  const r = list
    .map((x) => ({ fromMs: Math.max(0, Math.min(max, Number(x.fromMs) || 0)), toMs: Math.max(0, Math.min(max, Number(x.toMs) || 0)) }))
    .filter((x) => x.toMs - x.fromMs >= 1)
    .sort((a, b) => a.fromMs - b.fromMs);
  const out: Range[] = [];
  for (const x of r) {
    const last = out[out.length - 1];
    if (last && x.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, x.toMs);
    else out.push({ ...x });
  }
  return out;
}

/** Übrig bleibende Abschnitte: behalten-Bereich (oder ganze Datei) minus Schnitte. */
export function keptSegments(durationMs: number, spec: Pick<VoiceEditSpec, 'keep' | 'cuts'>): Range[] {
  const base: Range = spec.keep ? { fromMs: Math.max(0, spec.keep.fromMs), toMs: Math.min(durationMs, spec.keep.toMs) } : { fromMs: 0, toMs: durationMs };
  let segs: Range[] = base.toMs > base.fromMs ? [base] : [];
  for (const c of normRanges(spec.cuts ?? [], durationMs)) {
    const next: Range[] = [];
    for (const s of segs) {
      if (c.toMs <= s.fromMs || c.fromMs >= s.toMs) next.push(s);
      else {
        if (c.fromMs > s.fromMs) next.push({ fromMs: s.fromMs, toMs: c.fromMs });
        if (c.toMs < s.toMs) next.push({ fromMs: c.toMs, toMs: s.toMs });
      }
    }
    segs = next;
  }
  return segs.filter((s) => s.toMs - s.fromMs >= MIN_SEGMENT_MS);
}

const num = (v: unknown, min: number, max: number, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

/**
 * ffmpeg-Filterkette für die Bearbeitung. Rein berechnend (testbar ohne ffmpeg). Liefert die Kette und die Länge
 * nach Schnitt in ms (ohne Stille-Entfernung, die Länge hängt dort vom Inhalt ab).
 */
export function buildVoiceFilter(durationMs: number, spec: VoiceEditSpec): { filter: string; segments: Range[]; outMs: number } {
  const segs = keptSegments(durationMs, spec);
  if (!segs.length) throw new AppError(400, 'empty_result', 'Nach den Schnitten bleibt nichts übrig');
  const parts: string[] = [];
  const labels: string[] = [];
  segs.forEach((s, i) => {
    const len = (s.toMs - s.fromMs) / 1000;
    const f = Math.min(CLICK_FADE_S, len / 2);
    parts.push(`[0:a]atrim=start=${(s.fromMs / 1000).toFixed(3)}:end=${(s.toMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${f.toFixed(3)},afade=t=out:st=${(len - f).toFixed(3)}:d=${f.toFixed(3)}[s${i}]`);
    labels.push(`[s${i}]`);
  });
  const outMs = segs.reduce((a, s) => a + (s.toMs - s.fromMs), 0);
  const chain: string[] = [];
  if (spec.denoise === 'light') chain.push('afftdn=nr=12:nf=-45');
  else if (spec.denoise === 'strong') chain.push('highpass=f=70', 'afftdn=nr=25:nf=-38');
  if (spec.gate) chain.push('agate=threshold=0.02:ratio=3:attack=10:release=250');
  switch (spec.eq) {
    case 'voice': chain.push('highpass=f=90', 'equalizer=f=3000:t=q:w=1:g=3'); break;
    case 'warm': chain.push('highpass=f=70', 'equalizer=f=200:t=q:w=1:g=3', 'equalizer=f=7000:t=q:w=1:g=-2'); break;
    case 'bright': chain.push('equalizer=f=6000:t=q:w=1:g=3', 'equalizer=f=250:t=q:w=1:g=-2'); break;
    case 'phone': chain.push('highpass=f=400', 'lowpass=f=3400'); break;
    default: break;
  }
  if (spec.compressor) chain.push('acompressor=threshold=-18dB:ratio=3:attack=15:release=200:makeup=4');
  if (spec.stripSilence) chain.push('silenceremove=stop_periods=-1:stop_duration=0.6:stop_threshold=-50dB:stop_silence=0.15');
  const gain = num(spec.gainDb, -30, 30, 0);
  if (gain !== 0) chain.push(`volume=${gain.toFixed(1)}dB`);
  if (spec.normalize) chain.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  const fi = num(spec.fadeInMs, 0, 30_000, 0) / 1000;
  const fo = num(spec.fadeOutMs, 0, 30_000, 0) / 1000;
  if (fi > 0) chain.push(`afade=t=in:st=0:d=${fi.toFixed(2)}`);
  // Ausblenden ohne die endgültige Länge zu kennen (Stille-Entfernung ändert sie): umdrehen, einblenden, zurückdrehen
  if (fo > 0) chain.push('areverse', `afade=t=in:st=0:d=${fo.toFixed(2)}`, 'areverse');
  chain.push('alimiter=limit=0.97');
  const joined = labels.length > 1 ? `${labels.join('')}concat=n=${labels.length}:v=0:a=1[cat]` : null;
  const head = joined ? `${parts.join(';')};${joined}` : parts.join(';').replace(/\[s0\]$/, '[cat]');
  const filter = `${head};[cat]aresample=44100,aformat=channel_layouts=stereo,${chain.join(',')}[out]`;
  return { filter, segments: segs, outMs };
}

export class VoiceService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private async run(stationId: string, mediaId: string, spec: VoiceEditSpec, outFile: string): Promise<number> {
    const ff = this.app.ffmpeg;
    if (!ff) throw new AppError(501, 'unsupported', 'Voice Studio benötigt ffmpeg auf dem Server');
    const m = this.app.svc.media.media(stationId, mediaId);
    if (m.url) throw new AppError(400, 'stream', 'Streams lassen sich nicht bearbeiten');
    const src = this.app.svc.media.mediaPath(stationId, m);
    const dur = m.durationMs ?? (ff.ffprobe ? await probeDurationMs(ff.ffprobe, src) : null);
    if (!dur) throw new AppError(422, 'unknown_length', 'Die Länge der Datei ist unbekannt');
    if (spec.denoise && !(DENOISE as readonly string[]).includes(spec.denoise)) throw new AppError(400, 'invalid', 'Rauschentfernung: off, light oder strong');
    if (spec.eq && !(EQ_PRESETS as readonly string[]).includes(spec.eq)) throw new AppError(400, 'invalid', `EQ: ${EQ_PRESETS.join(', ')}`);
    const { filter } = buildVoiceFilter(dur, spec);
    try {
      await execFileP(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', src, '-filter_complex', filter, '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', outFile], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      rmSync(outFile, { force: true });
      throw new AppError(502, 'edit_failed', `ffmpeg: ${String((err as { stderr?: string }).stderr ?? (err as Error).message).trim().slice(-300)}`);
    }
    return (ff.ffprobe ? await probeDurationMs(ff.ffprobe, outFile) : null) ?? buildVoiceFilter(dur, spec).outMs;
  }

  /** Vorschau rendern (eine Datei je Sender, wird bei jedem Aufruf überschrieben). Liefert den Dateipfad. */
  async preview(stationId: string, mediaId: string, spec: VoiceEditSpec): Promise<string> {
    const dir = join(this.app.dataDir, 'voice-preview');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${stationId.replace(/[^A-Za-z0-9_-]/g, '_')}.mp3`);
    await this.run(stationId, mediaId, spec, file);
    return file;
  }

  /** Bearbeitung als neuen Titel in die Bibliothek legen. */
  async save(stationId: string, mediaId: string, spec: VoiceEditSpec): Promise<MediaItem> {
    const orig = this.app.svc.media.media(stationId, mediaId);
    const id = newId('m');
    const file = `${id}.mp3`;
    const out = join(this.app.mediaDir, stationId, file);
    const durationMs = await this.run(stationId, mediaId, spec, out);
    const category = (MEDIA_CATEGORIES as readonly string[]).includes(String(spec.category)) ? (spec.category as MediaItem['category']) : orig.category;
    return this.app.svc.media.addMedia(stationId, {
      id, title: (spec.title?.trim() || `${orig.title} (bearbeitet)`).slice(0, 200), artist: orig.artist || this.app.rt(stationId).station.name,
      category, file, durationMs, addedAt: Date.now(), folder: 'Voice Studio',
    });
  }
}
