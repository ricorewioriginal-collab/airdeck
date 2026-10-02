// KI je Sender: Einstellungen der Automation, Redaktionsassistent (Text) und Voice Studio (Sprache).

import type { AirDeckApp } from '../app.ts';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { MEDIA_CATEGORIES, type MediaItem } from '../../core/automation.ts';
import { AppError, newId, type Principal } from '../model.ts';
import { DEFAULT_AI, type AiSource, type AiStationConfig } from '../ai/director.ts';
import { AiError, type TranscriptSegment } from '../ai/providers.ts';

const execFileP = promisify(execFile);
const CHAT_MAX = 200;
const TONES: Record<string, string> = {
  kuerzer: 'Kürze den Text deutlich (etwa die Hälfte), behalte die Kernaussage und den Stil.',
  laenger: 'Erweitere den Text um passende Details und Übergänge (etwa das Anderthalbfache), ohne zu schwafeln.',
  witziger: 'Mache den Text witziger und lockerer, mit einem Augenzwinkern - radiotauglich, ohne Kalauer-Overkill.',
  serioeser: 'Mache den Text seriöser, sachlicher und vertrauenswürdiger - klare Sprache, keine Übertreibungen.',
  radio: 'Formuliere den Text als gesprochene Radio-Moderation: kurze Sätze, aktiv, direkt an die Hörer gerichtet.',
};

/** SRT aus Segmenten (Zeitmarken hh:mm:ss,mmm). */
export function toSrt(segments: TranscriptSegment[]): string {
  const ts = (t: number) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return segments.map((seg, i) => `${i + 1}\n${ts(seg.start)} --> ${ts(seg.end)}\n${seg.text}\n`).join('\n');
}

/** JSON-Tabelle aus einer KI-Antwort herauslösen (auch wenn Prosa oder ```-Zäune drumherum stehen). */
export function parseJsonRows(text: string): Record<string, unknown>[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : null;
  } catch {
    return null;
  }
}

export class AiToolsService {
  private readonly app: AirDeckApp;

  constructor(app: AirDeckApp) {
    this.app = app;
  }

  aiConfig(stationId: string): AiStationConfig {
    const c = this.app.rt(stationId).data.ai;
    return { ...DEFAULT_AI, ...c, text: { ...DEFAULT_AI.text, ...c?.text }, voice: { ...DEFAULT_AI.voice, ...c?.voice }, music: { ...DEFAULT_AI.music, ...c?.music } };
  }

  setAiConfig(p: Principal, stationId: string, input: Record<string, any>): AiStationConfig {
    const cur = this.aiConfig(stationId);
    const str = (v: unknown, max: number, d: string) => (typeof v === 'string' ? v.trim().slice(0, max) : d);
    const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    const target = (t: any, d: any) => (t && typeof t === 'object' ? {
      providerId: str(t.providerId, 40, d?.providerId ?? ''), model: str(t.model, 120, d?.model ?? ''),
      ...(typeof t.temperature === 'number' ? { temperature: Math.max(0, Math.min(2, t.temperature)) } : {}),
      ...(typeof t.maxTokens === 'number' ? { maxTokens: int(t.maxTokens, 50, 8000, 600) } : d?.maxTokens ? { maxTokens: d.maxTokens } : {}),
    } : d);
    const voice = (t: any, d: any) => (t && typeof t === 'object' ? {
      providerId: str(t.providerId, 40, d?.providerId ?? ''), voice: str(t.voice, 300, d?.voice ?? ''), model: str(t.model, 120, d?.model ?? '') || undefined,
      ...(typeof t.speed === 'number' ? { speed: Math.max(0.5, Math.min(2, t.speed)) } : {}),
    } : d);
    const sources: AiSource[] = Array.isArray(input.sources) ? input.sources.slice(0, 12).map((s: any, i: number) => {
      const url = String(s.url ?? '').trim();
      if (!/^https?:\/\//.test(url)) throw new AppError(400, 'invalid_url', `Quelle ${i + 1}: URL muss mit http(s):// beginnen`);
      return { id: str(s.id, 40, '') || newId('ais'), name: str(s.name, 60, `Quelle ${i + 1}`), url, kind: ['rss', 'json', 'text'].includes(s.kind) ? s.kind : 'rss', use: ['news', 'weather', 'info'].includes(s.use) ? s.use : 'info' };
    }) : cur.sources;
    const next: AiStationConfig = {
      enabled: bool(input.enabled, cur.enabled),
      approval: bool(input.approval, cur.approval),
      everySongs: int(input.everySongs, 0, 20, cur.everySongs),
      topOfHourNews: bool(input.topOfHourNews, cur.topOfHourNews),
      language: str(input.language, 40, cur.language) || 'Deutsch',
      persona: str(input.persona, 400, cur.persona),
      style: str(input.style, 600, cur.style),
      maxWords: int(input.maxWords, 10, 300, cur.maxWords),
      sources,
      text: { ...target(input.text, cur.text), fallback: input.text && 'fallback' in input.text ? (input.text.fallback?.providerId ? target(input.text.fallback, undefined) : undefined) : cur.text.fallback },
      voice: { ...voice(input.voice, cur.voice), fallback: input.voice && 'fallback' in input.voice ? (input.voice.fallback?.providerId ? voice(input.voice.fallback, undefined) : undefined) : cur.voice.fallback },
      music: input.music && typeof input.music === 'object' ? {
        enabled: bool(input.music.enabled, cur.music.enabled), lookahead: int(input.music.lookahead, 1, 10, cur.music.lookahead),
        instructions: str(input.music.instructions, 600, cur.music.instructions), jingleEvery: int(input.music.jingleEvery, 0, 20, cur.music.jingleEvery),
      } : cur.music,
      keepGenerated: int(input.keepGenerated, 5, 500, cur.keepGenerated),
    };
    if (next.enabled && !next.text.providerId) throw new AppError(400, 'no_provider', 'Für die KI-Automation zuerst einen Text-Provider und ein Modell wählen');
    if (next.enabled && next.everySongs > 0 && !next.voice.providerId) throw new AppError(400, 'no_voice', 'Für Moderationen einen Sprach-Provider und eine Stimme wählen');
    this.app.rt(stationId).data.ai = next;
    this.app.audit.write({ kind: 'ai', event: 'config', actor: p.id, stationId, enabled: next.enabled, music: next.music.enabled, approval: next.approval });
    this.app.changed();
    return next;
  }

  /** KI-Sprachdatei als Medium ablegen (wird automatisch aufgeräumt). */
  addGeneratedMedia(stationId: string, audio: Buffer, ext: string, title: string, category: MediaItem['category'], generated = true): MediaItem {
    const id = newId('m');
    const file = `${id}.${ext === 'wav' ? 'wav' : 'mp3'}`;
    writeFileSync(join(this.app.mediaDir, stationId, file), audio);
    return this.app.svc.media.addMedia(stationId, {
      id, title: title.slice(0, 200), artist: this.app.rt(stationId).station.name, category, file, durationMs: null, addedAt: Date.now(),
      folder: generated ? 'KI' : 'KI-Studio', ...(generated ? { generatedBy: 'ai' as const } : {}),
    });
  }

  /** KI-Werkzeug: Text erzeugen (Assistent, Spot-Texte, Sendungsplanung). */
  async aiText(stationId: string, prompt: string, system?: string): Promise<unknown> {
    const c = this.aiConfig(stationId);
    if (!prompt.trim()) throw new AppError(400, 'empty', 'Bitte eine Anweisung eingeben');
    try {
      const r = await this.app.ai.text(stationId, 'assistant', [c.text, c.text.fallback], system?.trim() || `Du bist der Redaktionsassistent des Radiosenders „${this.app.rt(stationId).station.name}“. Antworte auf ${c.language}.`, prompt.slice(0, 20_000), 90_000);
      return { text: r.text, providerId: r.providerId, model: r.model, cost: r.cost };
    } catch (err) {
      throw new AppError(502, 'ai_failed', (err as Error).message);
    }
  }

  /** KI-Werkzeug: Text vertonen und in die Bibliothek legen (Voice Studio, Spots, Jingles). */
  async aiSpeech(stationId: string, input: { text?: string; title?: string; category?: string; voice?: string; providerId?: string; model?: string }): Promise<MediaItem> {
    const c = this.aiConfig(stationId);
    const text = String(input.text ?? '').trim();
    if (!text) throw new AppError(400, 'empty', 'Kein Text');
    if (text.length > 5000) throw new AppError(413, 'too_long', 'Höchstens 5000 Zeichen');
    const target = input.providerId ? { providerId: input.providerId, voice: input.voice ?? '', model: input.model } : { ...c.voice, ...(input.voice ? { voice: input.voice } : {}) };
    try {
      const r = await this.app.ai.voice(stationId, 'voice_studio', [target, input.providerId ? undefined : c.voice.fallback], text, 120_000);
      const category = (MEDIA_CATEGORIES as readonly string[]).includes(String(input.category)) ? (input.category as MediaItem['category']) : 'tts';
      return this.addGeneratedMedia(stationId, r.audio, r.ext, input.title?.trim() || text.slice(0, 60), category, false);
    } catch (err) {
      throw new AppError(err instanceof AiError && err.code === 'no_voice' ? 400 : 502, 'ai_failed', (err as Error).message);
    }
  }

  // ---------- KI-Werkstatt (nach ki-tools.html im Control Center) ----------

  chat(stationId: string): { at: number; role: 'user' | 'assistant'; text: string }[] {
    return this.app.rt(stationId).data.aiChat ?? [];
  }

  chatClear(stationId: string): void {
    this.app.rt(stationId).data.aiChat = [];
    this.app.changed();
  }

  /** KI-Assistent mit Verlauf: die letzten Beiträge gehen als Kontext mit, der Verlauf bleibt je Sender gespeichert. */
  async chatSend(stationId: string, prompt: string, instruction?: string): Promise<{ reply: string; model: string; cost: number }> {
    const text = prompt.trim();
    if (!text) throw new AppError(400, 'empty', 'Bitte eine Frage oder Aufgabe eingeben');
    const rt = this.app.rt(stationId);
    const history = (rt.data.aiChat ??= []);
    const c = this.aiConfig(stationId);
    const context = history.slice(-12).map((m) => `${m.role === 'user' ? 'Nutzer' : 'Assistent'}: ${m.text}`).join('\n');
    const system = `Du bist der KI-Assistent des Radiosenders „${rt.station.name}“: Moderationstexte, Social-Media-Posts, Gewinnspiel-Ideen, Sendeplanung, Recherche. Antworte auf ${c.language}, konkret und radiotauglich. ${instruction?.trim() ? `Zusätzliche Anweisung des Senders: ${instruction.trim().slice(0, 600)}` : ''}`;
    const full = context ? `Bisheriger Verlauf:\n${context}\n\nNeue Nachricht: ${text}` : text;
    try {
      const r = await this.app.ai.text(stationId, 'assistant', [c.text, c.text.fallback], system, full.slice(0, 20_000), 90_000);
      history.push({ at: Date.now(), role: 'user', text: text.slice(0, 4000) }, { at: Date.now(), role: 'assistant', text: r.text.slice(0, 20_000) });
      if (history.length > CHAT_MAX) history.splice(0, history.length - CHAT_MAX);
      this.app.changed();
      return { reply: r.text, model: r.model, cost: r.cost };
    } catch (err) {
      throw new AppError(502, 'ai_failed', (err as Error).message);
    }
  }

  /** Prompt-Verbesserer: aus einer knappen Idee eine präzise Anweisung machen. */
  async improvePrompt(stationId: string, prompt: string): Promise<{ text: string }> {
    if (!prompt.trim()) throw new AppError(400, 'empty', 'Bitte eine Idee eingeben');
    const r = await this.aiText(stationId, prompt.slice(0, 4000), 'Du bist ein Prompt-Verbesserer für Radio-Redaktionen. Forme die Eingabe in eine präzise, vollständige Anweisung an eine KI um: Ziel, Zielgruppe, Länge, Tonfall, Format. Gib nur die verbesserte Anweisung aus.') as { text: string };
    return { text: r.text };
  }

  /** Ton-Knöpfe der Spot-Werkstatt: kürzer / länger / witziger / seriöser / radio. */
  async rewrite(stationId: string, text: string, tone: string): Promise<{ text: string }> {
    const t = TONES[tone];
    if (!t) throw new AppError(400, 'invalid_tone', `Ton: ${Object.keys(TONES).join(', ')}`);
    if (!text.trim()) throw new AppError(400, 'empty', 'Kein Text');
    const r = await this.aiText(stationId, text.slice(0, 8000), `${t} Gib nur den überarbeiteten Text aus, ohne Vorrede.`) as { text: string };
    return { text: r.text };
  }

  /**
   * Spot-Werkstatt, Schritt 4: Sprecher-Datei über ein Musikbett legen. Das Bett wird per Sidechain
   * unter der Stimme abgesenkt (Ducking), läuft kurz nach und blendet aus; Ergebnis landet als Titel
   * in der Bibliothek (Standard: Werbung).
   */
  async spotMix(stationId: string, input: { voiceMediaId?: string; bedMediaId?: string; duckDb?: number; tailMs?: number; bedDb?: number; title?: string; category?: string }): Promise<MediaItem> {
    const ff = this.app.ffmpeg;
    if (!ff) throw new AppError(501, 'unsupported', 'Spot-Mix benötigt ffmpeg auf dem Server');
    const voice = this.app.svc.media.media(stationId, String(input.voiceMediaId ?? ''));
    const bed = this.app.svc.media.media(stationId, String(input.bedMediaId ?? ''));
    if (voice.url || bed.url) throw new AppError(400, 'stream', 'Stimme und Bett müssen Dateien sein, keine Streams');
    const voiceSec = Math.max(1, (voice.durationMs ?? 30_000) / 1000);
    const tail = Math.max(0, Math.min(15, (input.tailMs ?? 2500) / 1000));
    const lead = 0.6;
    const total = lead + voiceSec + tail;
    const bedGain = Math.pow(10, Math.max(-30, Math.min(0, input.bedDb ?? -6)) / 20);
    const ratio = Math.max(2, Math.min(20, Math.round(Math.abs(input.duckDb ?? -12) / 1.5)));
    const out = join(this.app.mediaDir, stationId, `${newId('m')}.mp3`);
    const filter = [
      `[0:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(lead * 1000)}|${Math.round(lead * 1000)},apad=pad_dur=${tail.toFixed(2)},asplit=2[v][vsc]`,
      `[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},volume=${bedGain.toFixed(3)}[b]`,
      `[b][vsc]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=25:release=600[bd]`,
      `[bd]afade=t=in:st=0:d=${Math.min(0.5, lead).toFixed(2)},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[bf]`,
      `[v][bf]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[out]`,
    ].join(';');
    try {
      await execFileP(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', this.app.svc.media.mediaPath(stationId, voice), '-stream_loop', '-1', '-i', this.app.svc.media.mediaPath(stationId, bed),
        '-filter_complex', filter, '-map', '[out]', '-t', total.toFixed(2), '-c:a', 'libmp3lame', '-b:a', '160k', out], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      rmSync(out, { force: true });
      throw new AppError(502, 'mix_failed', `ffmpeg: ${String((err as { stderr?: string }).stderr ?? (err as Error).message).trim().slice(-300)}`);
    }
    const category = (MEDIA_CATEGORIES as readonly string[]).includes(String(input.category)) ? (input.category as MediaItem['category']) : 'ad';
    const id = out.replace(/^.*[\\/]/, '').replace(/\.mp3$/, '');
    return this.app.svc.media.addMedia(stationId, { id, title: (input.title?.trim() || `${voice.title} (mit Bett)`).slice(0, 200), artist: this.app.rt(stationId).station.name, category, file: `${id}.mp3`, durationMs: Math.round(total * 1000), addedAt: Date.now(), folder: 'KI-Studio' });
  }

  /** Sendeablauf-Planer: KI liefert eine Tabelle (JSON), die im Studio bearbeitet und exportiert werden kann. */
  async planShow(stationId: string, input: { topic?: string; minutes?: number; startTime?: string; notes?: string }): Promise<{ rows: { time: string; minutes: number; segment: string; content: string }[]; raw: string }> {
    const topic = String(input.topic ?? '').trim();
    if (!topic) throw new AppError(400, 'empty', 'Thema oder Sendungsname angeben');
    const minutes = Math.max(15, Math.min(360, Math.round(Number(input.minutes) || 60)));
    const start = /^\d{1,2}:\d{2}$/.test(String(input.startTime ?? '')) ? String(input.startTime) : '10:00';
    const rt = this.app.rt(stationId);
    const cats = [...new Set(rt.data.library.map((m) => m.category))].join(', ');
    const system = `Du planst Radiosendungen für „${rt.station.name}“. Antworte ausschließlich mit einem JSON-Array von Objekten {"time":"HH:MM","minutes":Zahl,"segment":"Musik|Moderation|Nachrichten|Wetter|Werbung|Jingle|Rubrik|Interview|Hörer","content":"Inhalt / Moderationsstichpunkte / Titelvorschlag"}. Die Summe der Minuten muss ${minutes} ergeben, Start ${start}, Nachrichten zur vollen Stunde, Musikblöcke mit 2-4 Titeln je 3-4 Minuten. Verfügbare Kategorien: ${cats || 'music'}.`;
    const r = await this.aiText(stationId, `Sendung: ${topic}. Länge ${minutes} Minuten ab ${start} Uhr.${input.notes ? ` Hinweise: ${String(input.notes).slice(0, 1500)}` : ''}`, system) as { text: string };
    const rows = (parseJsonRows(r.text) ?? []).map((x) => ({ time: String(x.time ?? ''), minutes: Math.max(0, Math.round(Number(x.minutes) || 0)), segment: String(x.segment ?? 'Rubrik').slice(0, 40), content: String(x.content ?? '').slice(0, 600) }));
    return { rows, raw: r.text };
  }

  /** Transkription: lokales whisper (openai-whisper CLI) wenn vorhanden, sonst Whisper-API eines OpenAI(-kompatiblen) Providers. */
  async transcribe(stationId: string, input: { mediaId?: string; language?: string }): Promise<{ text: string; srt: string; segments: TranscriptSegment[]; engine: string }> {
    const m = this.app.svc.media.media(stationId, String(input.mediaId ?? ''));
    if (m.url) throw new AppError(400, 'stream', 'Streams können nicht transkribiert werden');
    const path = this.app.svc.media.mediaPath(stationId, m);
    if (!existsSync(path)) throw new AppError(404, 'missing_file', 'Datei fehlt');
    const language = /^[a-z]{2}$/.test(String(input.language ?? '')) ? String(input.language) : 'de';
    const local = this.app.ai.transcribers().length === 0 || process.env.ANMACHA_CAST_WHISPER ? this.localWhisper() : null;
    if (local) {
      const dir = mkdtempSync(join(tmpdir(), 'cast-whisper-'));
      try {
        await execFileP(local, [path, '--language', language, '--output_format', 'srt', '--output_dir', dir, '--model', process.env.ANMACHA_CAST_WHISPER_MODEL || 'base', '--fp16', 'False'], { timeout: 20 * 60_000, maxBuffer: 8 * 1024 * 1024 });
        const srtFile = readdirSync(dir).find((f) => f.endsWith('.srt'));
        if (!srtFile) throw new Error('whisper lieferte keine SRT-Datei');
        const srt = readFileSync(join(dir, srtFile), 'utf8');
        const segments = parseSrt(srt);
        return { text: segments.map((x) => x.text).join(' '), srt, segments, engine: 'whisper (lokal)' };
      } catch (err) {
        throw new AppError(502, 'whisper_failed', `Lokales whisper: ${(err as Error).message.slice(-300)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    try {
      const r = await this.app.ai.transcribe(stationId, readFileSync(path), m.file, language);
      return { text: r.text, srt: toSrt(r.segments), segments: r.segments, engine: r.providerId };
    } catch (err) {
      throw new AppError(502, 'ai_failed', (err as Error).message);
    }
  }

  private localWhisper(): string | null {
    const cand = process.env.ANMACHA_CAST_WHISPER || 'whisper';
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cand], { encoding: 'utf8' });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim().split(/\r?\n/)[0]! : null;
  }
}

/** SRT → Segmente (für die Textansicht nach lokaler Transkription). */
export function parseSrt(srt: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const t = (s: string) => { const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0; };
  for (const block of srt.split(/\r?\n\r?\n/)) {
    const lines = block.trim().split(/\r?\n/);
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;
    const [a, b] = lines[idx]!.split('-->');
    out.push({ start: t(a ?? ''), end: t(b ?? ''), text: lines.slice(idx + 1).join(' ').trim() });
  }
  return out;
}
