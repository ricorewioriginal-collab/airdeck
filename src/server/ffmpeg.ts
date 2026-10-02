// ffmpeg-Capability-Erkennung. Reihenfolge: ANMACHA_CAST_FFMPEG (Legacy: AIRDECK_FFMPEG) → mitgeliefertes ./ffmpeg/ → PATH.
// Ohne ffmpeg bleibt AnMaCha Cast lauffähig; nur das Server-Playout meldet dann "unsupported".

import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { envVar } from './legacy-branding.ts';

export interface FfmpegInfo {
  ffmpeg: string;
  ffprobe: string | null;
  /** ffplay für lokales Abhören über die PC-Lautsprecher */
  ffplay: string | null;
  version: string;
  encoders: { mp3: boolean; opus: boolean };
  /** custom = ANMACHA_CAST_FFMPEG, bundled = mitgeliefert (./ffmpeg/), system = PATH */
  source: 'custom' | 'bundled' | 'system';
}

const exe = process.platform === 'win32' ? '.exe' : '';
const TIMEOUT_MS = 15_000;
const OPTS = { encoding: 'utf8' as const, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 };

function runSync(bin: string, args: string[]): string | null {
  try {
    const r = spawnSync(bin, args, OPTS);
    return r.status === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

function runAsync(bin: string, args: string[]): Promise<string | null> {
  return new Promise((ok) => execFile(bin, args, OPTS, (err, stdout) => ok(err ? null : stdout)));
}

const isPath = (bin: string) => bin.includes('/') || bin.includes('\\');

// Reihenfolge: eigener Pfad → mitgeliefert → PATH. Schlägt ein Kandidat fehl, folgt der nächste.
function candidates(appRoot: string): { bin: string; source: FfmpegInfo['source'] }[] {
  const list: { bin: string; source: FfmpegInfo['source'] }[] = [];
  const custom = envVar(process.env, 'FFMPEG');
  if (custom) list.push({ bin: custom, source: 'custom' });
  list.push({ bin: join(appRoot, 'ffmpeg', `ffmpeg${exe}`), source: 'bundled' }, { bin: `ffmpeg${exe}`, source: 'system' });
  return list.filter((c) => !isPath(c.bin) || existsSync(c.bin));
}

/** Prüfschritte als Generator: dieselbe Logik für den blockierenden Start und die Suche im Betrieb. */
function* probe(appRoot: string): Generator<[string, string[]], FfmpegInfo | null, string | null> {
  const firstLine = (out: string | null) => (out ?? '').split('\n')[0]!.trim() || null;
  for (const { bin, source } of candidates(appRoot)) {
    const version = firstLine(yield [bin, ['-hide_banner', '-version']]);
    if (!version) continue;
    const probeBin = isPath(bin) ? join(dirname(bin), `ffprobe${exe}`) : `ffprobe${exe}`;
    const ffprobe = firstLine(yield [probeBin, ['-hide_banner', '-version']]) ? probeBin : null;
    const playBin = probeBin.replace(/ffprobe(\.exe)?$/, `ffplay${exe}`);
    const ffplay = firstLine(yield [playBin, ['-hide_banner', '-version']]) ? playBin : null;
    const enc = (yield [bin, ['-hide_banner', '-encoders']]) ?? '';
    return { ffmpeg: bin, ffprobe, ffplay, version, encoders: { mp3: /libmp3lame/.test(enc), opus: /libopus/.test(enc) }, source };
  }
  return null;
}

/** Beim Start (blockierend, es läuft noch nichts). */
export function detectFfmpeg(appRoot: string): FfmpegInfo | null {
  const g = probe(appRoot);
  let step = g.next(null);
  while (!step.done) step = g.next(runSync(...step.value));
  return step.value;
}

/** Erneute Suche im laufenden Betrieb, ohne den Prozess zu blockieren. */
export async function detectFfmpegAsync(appRoot: string): Promise<FfmpegInfo | null> {
  const g = probe(appRoot);
  let step = g.next(null);
  while (!step.done) step = g.next(await runAsync(...step.value));
  return step.value;
}

export interface MediaProbe {
  durationMs: number | null;
  tags: { title?: string; artist?: string; album?: string; genre?: string; year?: number; bpm?: number };
}

/** Laufzeit und ID3-/Vorbis-Tags einer Audiodatei. */
export function probeMedia(ffprobe: string, file: string): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const p = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', file], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve({ durationMs: null, tags: {} }));
    p.on('close', () => {
      try {
        const f = (JSON.parse(out) as { format?: { duration?: string; tags?: Record<string, string> } }).format ?? {};
        const t: Record<string, string> = {};
        for (const [k, v] of Object.entries(f.tags ?? {})) t[k.toLowerCase()] = String(v).trim().slice(0, 200);
        const s = Number.parseFloat(f.duration ?? '');
        const year = Number.parseInt(t.date ?? t.year ?? '', 10);
        const bpm = Number.parseInt(t.tbpm ?? t.bpm ?? '', 10);
        resolve({
          durationMs: Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : null,
          tags: {
            title: t.title || undefined, artist: t.artist || t.album_artist || undefined, album: t.album || undefined, genre: t.genre || undefined,
            year: year > 1000 && year < 3000 ? year : undefined, bpm: bpm > 0 && bpm < 400 ? bpm : undefined,
          },
        });
      } catch {
        resolve({ durationMs: null, tags: {} });
      }
    });
    setTimeout(() => p.kill(), 15_000).unref();
  });
}

/** Laufzeit einer Audiodatei in ms (oder null). */
export async function probeDurationMs(ffprobe: string, file: string): Promise<number | null> {
  return (await probeMedia(ffprobe, file)).durationMs;
}

export interface AudioDevice {
  id: string;
  name: string;
}

/** Aufnahmegeräte (Mikrofon/Line-In) für die Server-Automation. */
export function listInputDevices(ffmpeg: string): AudioDevice[] {
  if (process.platform === 'win32') {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const out: AudioDevice[] = [];
    for (const line of (r.stderr ?? '').split(/\r?\n/)) {
      const m = /"([^"]+)"\s*\(audio\)/.exec(line);
      if (m) out.push({ id: m[1]!, name: m[1]! });
    }
    return out;
  }
  if (process.platform === 'darwin') {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8', timeout: 8000 });
    const text = r.stderr ?? '';
    const audio = text.split(/AVFoundation audio devices:/)[1] ?? '';
    return [...audio.matchAll(/\[(\d+)\]\s+(.+)/g)].map((m) => ({ id: m[1]!, name: m[2]!.trim() }));
  }
  return [{ id: 'default', name: 'Standard-Eingang (PulseAudio/PipeWire)' }];
}

/** ffmpeg-Eingabeargumente für ein Aufnahmegerät. */
export function inputDeviceArgs(id: string): string[] {
  if (process.platform === 'win32') return ['-f', 'dshow', '-audio_buffer_size', '50', '-i', `audio=${id}`];
  if (process.platform === 'darwin') return ['-f', 'avfoundation', '-i', `:${id}`];
  return ['-f', 'pulse', '-i', id || 'default'];
}

/** Lautheit eines Titels messen (EBU R128): integrierte Lautheit (LUFS) und True-Peak (dBTP). */
export interface TrackAnalysis {
  lufs: number | null;
  truePeakDb: number;
  durationMs: number | null;
  /** Ende der digitalen Stille am Anfang (ms), null = keine */
  leadSilenceMs: number | null;
  /** Beginn der digitalen Stille am Ende (ms), null = keine */
  tailSilenceMs: number | null;
  /** Vollausgesteuerte Samples (Hinweis auf Übersteuerung) */
  clippedSamples: number;
  bitrateKbps: number | null;
  /** Die ganze Datei ist digital still */
  silent: boolean;
}

/** Stille-Schwelle: nur echte digitale Stille, leise Ein-/Ausblendungen bleiben unangetastet */
export const SILENCE_DB = -60;

/**
 * Track-Check in EINEM Durchlauf: Lautheit (EBU R128), True Peak, Stille am Anfang/Ende, Übersteuerung, Bitrate.
 * Liefert null, wenn die Datei nicht dekodierbar ist.
 */
export function analyzeTrack(ffmpeg: string, file: string, timeoutMs = 180_000): Promise<TrackAnalysis | null> {
  return new Promise((resolve) => {
    const af = `ebur128=peak=true:framelog=quiet,silencedetect=n=${SILENCE_DB}dB:d=0.25,astats=measure_perchannel=none:measure_overall=Peak_level+Peak_count`;
    const p = spawn(ffmpeg, ['-hide_banner', '-nostats', '-nostdin', '-i', file, '-vn', '-af', af, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    // Kopf (Dauer, Bitrate) und Stille-Meldungen merken, vom Rest nur das Ende (Zusammenfassungen)
    let head = '';
    let tail = '';
    const silences: { start: number; end: number | null }[] = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stderr!.on('data', (d: Buffer) => {
      const t = d.toString();
      if (head.length < 4000) head += t;
      tail = (tail + t).slice(-8000);
      for (const m of t.matchAll(/silence_start: (-?\d+(?:\.\d+)?)/g)) silences.push({ start: Math.max(0, Number(m[1])), end: null });
      for (const m of t.matchAll(/silence_end: (\d+(?:\.\d+)?)/g)) {
        const open = silences.findLast((x) => x.end === null);
        if (open) open.end = Number(m[1]);
      }
    });
    p.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      const summary = tail.slice(tail.lastIndexOf('Summary:'));
      const i = /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(summary);
      const tp = /True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?|-inf)\s+dBFS/.exec(summary);
      const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(head);
      const durationMs = dur ? Math.round((Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])) * 1000) : null;
      const br = /bitrate: (\d+) kb\/s/.exec(head);
      const peakLevel = /Peak level dB:\s*(-?\d+(?:\.\d+)?|-inf)/.exec(tail);
      const peakCount = /Peak count:\s*(\d+(?:\.\d+)?)/.exec(tail);
      const lufsRaw = i ? Number(i[1]) : NaN;
      // Stille am Anfang: beginnt bei 0; am Ende: bis zum Dateiende (ohne silence_end oder end ≈ Dauer)
      const first = silences[0];
      const leadEnd = first && first.start < 0.05 && first.end !== null ? Math.round(first.end * 1000) : null;
      // Stille bis (fast) zum Dateiende: die ganze Datei ist still – keine Cue-Punkte, sondern ein Hinweis
      const silent = leadEnd !== null && durationMs !== null && leadEnd >= durationMs - 100;
      const leadSilenceMs = silent ? null : leadEnd;
      const last = silences[silences.length - 1];
      const tailOpen = !!last && (last.end === null || (durationMs !== null && last.end * 1000 >= durationMs - 50));
      // eine einzige Stille vom Anfang bis zum Ende (ganz stille Datei) ist weder Anfang noch Ende eines Titels
      const tailSilenceMs = tailOpen && !(last === first && first.start < 0.05) ? Math.round(last!.start * 1000) : null;
      resolve({
        // Stille/zu kurz: ebur128 meldet −70 LUFS – dann keine Anpassung
        lufs: Number.isFinite(lufsRaw) && lufsRaw > -69 ? lufsRaw : null,
        truePeakDb: tp && tp[1] !== '-inf' ? Number(tp[1]) : -90,
        durationMs,
        leadSilenceMs,
        tailSilenceMs,
        clippedSamples: peakLevel && peakLevel[1] !== '-inf' && Number(peakLevel[1]) >= -0.05 && peakCount ? Math.round(Number(peakCount[1])) : 0,
        bitrateKbps: br ? Number(br[1]) : null,
        silent: silent || (!!first && first.start < 0.05 && first.end === null),
      });
    });
  });
}

/** Nur Lautheit (für bestehende Aufrufer) */
export async function analyzeLoudness(ffmpeg: string, file: string, timeoutMs = 180_000): Promise<{ lufs: number; truePeakDb: number } | null> {
  const r = await analyzeTrack(ffmpeg, file, timeoutMs);
  return r && r.lufs !== null ? { lufs: r.lufs, truePeakDb: r.truePeakDb } : null;
}

/** Zusatz-Streams-Teststream: kurzer Testton (nur bei Bedarf einmal erzeugt, danach wiederverwendet). */
export function generateTestTone(ffmpeg: string, file: string, seconds = 3, freq = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=f=${freq}:d=${seconds}`, file], { windowsHide: true });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg beendete sich mit Code ${code}`))));
  });
}

// ---------- Tonart-Analyse (Krumhansl-Schmuckler, Camelot) ----------

export interface KeyAnalysis {
  /** Grundton, z. B. "A" */
  root: string;
  mode: 'major' | 'minor';
  /** Lesbar, z. B. "A Moll" */
  name: string;
  /** Camelot-Rad, z. B. "8A" (DJ-Kompatibilität) */
  camelot: string;
  /** Parallele Tonart, z. B. "C Dur" */
  relative: string;
  /** 20…97 % – Abstand zum zweitbesten Kandidaten */
  confidence: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i]! - ma, y = b[i]! - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Tonart aus einem 12-stufigen Chroma-Vektor (0 = C) bestimmen. null bei leerem Chroma. */
export function keyFromChroma(chromaIn: ArrayLike<number>): KeyAnalysis | null {
  const chroma = Array.from(chromaIn);
  const max = Math.max(...chroma);
  if (!(max > 0)) return null;
  const c = chroma.map((x) => x / max);
  const scores: { root: number; mode: 'major' | 'minor'; corr: number }[] = [];
  for (let root = 0; root < 12; root++) {
    for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]] as const) {
      const rotated = profile.map((_, i) => profile[(i - root + 12) % 12]!);
      scores.push({ root, mode, corr: pearson(c, rotated) });
    }
  }
  scores.sort((a, b) => b.corr - a.corr);
  const best = scores[0]!;
  let confidence = 50;
  if (scores[1] && Math.abs(best.corr) > 1e-6) confidence = Math.round(((best.corr - scores[1].corr) / best.corr) * 200 + 40);
  if (!Number.isFinite(confidence)) confidence = 50;
  const root = NOTE_NAMES[best.root]!;
  const relRoot = best.mode === 'major' ? (best.root + 9) % 12 : (best.root + 3) % 12;
  return {
    root, mode: best.mode, name: `${root} ${best.mode === 'major' ? 'Dur' : 'Moll'}`,
    camelot: best.mode === 'major' ? `${CAMELOT_MAJOR[best.root]}B` : `${CAMELOT_MINOR[best.root]}A`,
    relative: `${NOTE_NAMES[relRoot]} ${best.mode === 'major' ? 'Moll' : 'Dur'}`,
    confidence: Math.max(20, Math.min(97, confidence)),
  };
}

/** Chroma-Vektor aus 16-bit-Mono-PCM per Goertzel-Filter über C2…B6 (fünf Oktaven), fensterweise. */
export function chromaFromPcm(pcm: Int16Array, sampleRate: number): Float64Array {
  const chroma = new Float64Array(12);
  const win = 4096;
  const C2 = 440 * Math.pow(2, -4.75) * 4; // C2 ≈ 65,4 Hz
  const tones: { pc: number; coeff: number }[] = [];
  for (let n = 0; n < 60; n++) {
    const hz = C2 * Math.pow(2, n / 12);
    if (hz * 2 >= sampleRate) break;
    tones.push({ pc: n % 12, coeff: 2 * Math.cos((2 * Math.PI * hz) / sampleRate) });
  }
  for (let start = 0; start + win <= pcm.length; start += win) {
    let energy = 0;
    for (let i = 0; i < win; i++) { const v = pcm[start + i]! / 32768; energy += v * v; }
    if (energy / win < 1e-6) continue; // Stille überspringen
    for (const t of tones) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < win; i++) {
        s0 = pcm[start + i]! / 32768 + t.coeff * s1 - s2;
        s2 = s1; s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - t.coeff * s1 * s2;
      chroma[t.pc] = (chroma[t.pc] ?? 0) + Math.sqrt(Math.max(0, power));
    }
  }
  return chroma;
}

/** Tonart einer Datei: die ersten 60 s (ab 10 s, wenn länger) als Mono-PCM dekodieren und auswerten. null = nicht lesbar/still. */
export function analyzeKey(ffmpeg: string, file: string, timeoutMs = 60_000): Promise<KeyAnalysis | null> {
  const rate = 11025;
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-nostats', '-nostdin', '-loglevel', 'error', '-i', file, '-vn', '-t', '60', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks: Buffer[] = [];
    let total = 0;
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout!.on('data', (d: Buffer) => { if (total < rate * 2 * 70) { chunks.push(d); total += d.length; } });
    p.on('error', () => { clearTimeout(timer); resolve(null); });
    p.on('close', () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (buf.length < rate * 2) return resolve(null);
      const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
      resolve(keyFromChroma(chromaFromPcm(pcm, rate)));
    });
  });
}
