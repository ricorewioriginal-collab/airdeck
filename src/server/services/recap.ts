// Sendungs-Rückblick: fasst einen Sendezeitraum zusammen (gespielte Titel mit Uhrzeit, Hörer-Spitze,
// gesendete Datenmenge) - als JSON, CSV-Export oder E-Mail. Basiert auf dem ohnehin vorhandenen
// Play-Log und einer leichten 30-s-Stichprobe (Hörer/Bytes), nicht auf einer vollständigen Aufzeichnung
// (dafür ist der Recorder da, siehe services/recorder.ts).

import type { AnMaChaCastApp } from '../app.ts';
import { AppError, type PlayLogEntry } from '../model.ts';

export interface RecapReport {
  stationId: string;
  from: number;
  to: number;
  durationMs: number;
  tracks: PlayLogEntry[];
  trackCount: number;
  listenersPeak: number;
  /** null = zu wenige Stichproben im Zeitraum für eine verlässliche Schätzung */
  bytesSent: number | null;
  /** Meistgespielt im Zeitraum (nur Musik), absteigend nach Einsätzen */
  topTracks: TopTrack[];
}

export interface TopTrack {
  mediaId: string;
  title: string;
  artist: string;
  plays: number;
}

/** Meistgespielt-Ranking aus Play-Log-Einträgen (gleicher Titel = gleiche mediaId). */
export function topTracks(entries: PlayLogEntry[], limit = 10): TopTrack[] {
  const map = new Map<string, TopTrack>();
  for (const e of entries) {
    if (e.category !== 'music') continue;
    const t = map.get(e.mediaId) ?? { mediaId: e.mediaId, title: e.title, artist: e.artist, plays: 0 };
    t.plays++;
    map.set(e.mediaId, t);
  }
  return [...map.values()].sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title, 'de')).slice(0, limit);
}

const csvField = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export class RecapService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  generate(stationId: string, from: number, to: number): RecapReport {
    if (!(from < to)) throw new AppError(400, 'invalid_range', 'Der Zeitraum muss mit „von“ vor „bis“ beginnen');
    const rt = this.app.rt(stationId);
    const tracks = (rt.data.playLog ?? []).filter((e) => e.at >= from && e.at <= to).sort((a, b) => a.at - b.at);
    const samples = (rt.data.recapSamples ?? []).filter((s) => s.at >= from && s.at <= to).sort((a, b) => a.at - b.at);
    const listenersPeak = samples.reduce((max, s) => Math.max(max, s.listeners), 0);
    const bytesSent = samples.length >= 2 ? Math.max(0, samples[samples.length - 1]!.bytesTotal - samples[0]!.bytesTotal) : null;
    return { stationId, from, to, durationMs: to - from, tracks, trackCount: tracks.length, listenersPeak, bytesSent, topTracks: topTracks(tracks) };
  }

  /** Semikolon-CSV (Excel-tauglich) mit Kopfzeile und Titelliste. */
  csv(report: RecapReport): string {
    const rt = this.app.rt(report.stationId);
    const lines: string[] = [];
    lines.push(`Sendungs-Rückblick;${csvField(rt.station.name)}`);
    lines.push(`Von;${csvField(new Date(report.from).toLocaleString('de-DE'))}`);
    lines.push(`Bis;${csvField(new Date(report.to).toLocaleString('de-DE'))}`);
    lines.push(`Dauer (Minuten);${Math.round(report.durationMs / 60_000)}`);
    lines.push(`Anzahl Titel;${report.trackCount}`);
    lines.push(`Hörer-Spitze;${report.listenersPeak}`);
    lines.push(`Gesendete Datenmenge (MB);${report.bytesSent == null ? 'unbekannt' : (report.bytesSent / 1_048_576).toFixed(1)}`);
    if (report.topTracks.length) {
      lines.push('');
      lines.push(['Platz', 'Interpret', 'Titel', 'Einsätze'].map(csvField).join(';'));
      report.topTracks.forEach((t, i) => lines.push([i + 1, t.artist, t.title, t.plays].map(csvField).join(';')));
    }
    lines.push('');
    lines.push(['Uhrzeit', 'Interpret', 'Titel', 'Kategorie'].map(csvField).join(';'));
    for (const t of report.tracks) {
      lines.push([new Date(t.at).toLocaleString('de-DE'), t.artist, t.title, t.category].map(csvField).join(';'));
    }
    return lines.join('\r\n') + '\r\n';
  }

  private text(report: RecapReport): string {
    const rt = this.app.rt(report.stationId);
    const lines = [
      `Sendungs-Rückblick – ${rt.station.name}`,
      `Von ${new Date(report.from).toLocaleString('de-DE')} bis ${new Date(report.to).toLocaleString('de-DE')} (${Math.round(report.durationMs / 60_000)} Minuten)`,
      `${report.trackCount} Titel · Hörer-Spitze ${report.listenersPeak} · gesendete Datenmenge ${report.bytesSent == null ? 'unbekannt' : `${(report.bytesSent / 1_048_576).toFixed(1)} MB`}`,
      ...(report.topTracks.length ? ['', 'Meistgespielt:', ...report.topTracks.map((t, i) => `${i + 1}. ${t.artist ? `${t.artist} – ` : ''}${t.title} (${t.plays}×)`)] : []),
      '',
      ...report.tracks.map((t) => `${new Date(t.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}  ${t.artist ? `${t.artist} – ` : ''}${t.title}`),
    ];
    return lines.join('\n');
  }

  /** Rückblick per E-Mail versenden, über den für den Sender konfigurierten SMTP-Kanal (siehe Notfall-Programm-Alarmierung). */
  async email(stationId: string, from: number, to: number, toAddress?: string): Promise<boolean> {
    const cfg = this.app.rt(stationId).data.integrations?.email;
    if (!cfg) throw new AppError(400, 'no_email', 'Zuerst unter Benachrichtigungen einen E-Mail-Kanal einrichten');
    const report = this.generate(stationId, from, to);
    const rt = this.app.rt(stationId);
    const ok = await this.app.notifier.sendCustomEmail(cfg, `Sendungs-Rückblick – ${rt.station.name}`, this.text(report), toAddress?.trim() || undefined);
    this.app.audit.write({ kind: 'recap', event: ok ? 'emailed' : 'email_failed', stationId, from, to });
    return ok;
  }
}
