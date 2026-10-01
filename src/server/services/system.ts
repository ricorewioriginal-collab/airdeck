// System: Updates, Netzwerkfreigabe und Android-Download, Liquidsoap-Skript, Monitoring (CPU/RAM/Durchsatz).

import type { AirDeckApp } from '../app.ts';
import { existsSync } from 'node:fs';
import { cpus, freemem, networkInterfaces, totalmem, uptime as osUptime } from 'node:os';
import { join } from 'node:path';
import { envVar } from '../legacy-branding.ts';
import { AppError } from '../model.ts';
import { readJson, writeFileAtomic } from '../store.ts';
import { DEFAULT_SOURCE, type UpdateSource } from '../update.ts';
import { liquidsoapScript } from '../liquidsoap.ts';

export class SystemService {
  private readonly app: AirDeckApp;

  constructor(app: AirDeckApp) {
    this.app = app;
  }

  cpuPrev = cpus().map((c) => c.times);

  /** Systemwerte für das Monitoring (CPU, RAM, Stream-Durchsatz). */
  system(): unknown {
    const now = cpus().map((c) => c.times);
    let idle = 0;
    let total = 0;
    now.forEach((t, i) => {
      const p = this.cpuPrev[i] ?? t;
      const d = (k: keyof typeof t) => t[k] - p[k];
      const sum = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
      total += sum;
      idle += d('idle');
    });
    this.cpuPrev = now;
    const outBytes = [...this.app.outputs.values()].reduce((a, o) => a + o.state.bytesSent, 0);
    const t = Date.now();
    const rate = this.lastOut ? ((outBytes - this.lastOut.bytes) / Math.max(1, t - this.lastOut.at)) * 1000 : 0;
    this.lastOut = { bytes: outBytes, at: t };
    return {
      cpu: total > 0 ? Math.round((1 - idle / total) * 100) : 0,
      ram: Math.round((1 - freemem() / totalmem()) * 100),
      uptimeS: Math.round(osUptime()),
      processMb: Math.round(process.memoryUsage().rss / 1048576),
      streamBytesPerSec: Math.max(0, Math.round(rate)),
      outputsConnected: [...this.app.outputs.values()].filter((o) => o.state.status === 'connected').length,
    };
  }

  lastOut: { bytes: number; at: number } | null = null;

  updateConfig(): UpdateSource & { autoCheck: boolean } {
    const s = this.app.docs.get<Partial<UpdateSource> & { autoCheck?: boolean }>('update', {});
    return { ...DEFAULT_SOURCE, ...s, tokenRef: 'update:token', autoCheck: s.autoCheck ?? true };
  }

  updateSettingsView(): unknown {
    const s = this.updateConfig();
    return {
      repo: s.repo, tag: s.tag, manifestUrl: s.manifestUrl ?? '', autoCheck: s.autoCheck, hasToken: this.app.secrets.has('update:token'),
      build: this.app.updater.current, canInstall: process.platform === 'win32' && this.app.packaged,
    };
  }

  setUpdateSettings(input: Record<string, unknown>): unknown {
    const cur = this.updateConfig();
    const repo = typeof input.repo === 'string' && input.repo ? input.repo.trim() : cur.repo;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new AppError(400, 'invalid_repo', 'Repository im Format besitzer/name angeben');
    const manifestUrl = typeof input.manifestUrl === 'string' ? input.manifestUrl.trim() : cur.manifestUrl ?? '';
    if (manifestUrl && !/^https:\/\//.test(manifestUrl)) throw new AppError(400, 'invalid_url', 'Update-Adresse muss https:// sein');
    if (typeof input.token === 'string') {
      if (input.token) this.app.secrets.set('update:token', input.token.trim());
      else this.app.secrets.delete('update:token');
    }
    this.app.docs.set('update', {
      repo, tag: typeof input.tag === 'string' && input.tag ? input.tag : cur.tag, manifestUrl: manifestUrl || undefined,
      autoCheck: typeof input.autoCheck === 'boolean' ? input.autoCheck : cur.autoCheck,
    });
    return this.updateSettingsView();
  }

  checkUpdate(force = false): Promise<unknown> {
    return this.app.updater.check(this.updateConfig(), this.app.secrets.get('update:token'), force);
  }

  /** Windows (installiertes Programm): Setup laden, prüfen, still installieren, AirDeck beenden. */
  async installUpdate(exit: () => void): Promise<unknown> {
    if (process.platform !== 'win32' || !this.app.packaged) throw new AppError(409, 'not_supported', 'Automatische Installation nur im installierten Windows-Programm – sonst bitte manuell herunterladen');
    const info = await this.app.updater.check(this.updateConfig(), this.app.secrets.get('update:token'), true);
    if (info.error) throw new AppError(502, 'update_check_failed', info.error);
    if (!info.available || !info.assets.setup) throw new AppError(409, 'no_update', 'Kein neueres Update verfügbar');
    const file = await this.app.updater.download(info.assets.setup, this.app.secrets.get('update:token'));
    this.app.audit.write({ kind: 'update', event: 'install', from: this.app.updater.current, to: info.latest });
    this.app.updater.runWindowsSetup(file, this.app.headless);
    setTimeout(exit, 1500).unref();
    return { installing: true, to: info.latest };
  }

  liquidsoap(stationId: string, opts: { port?: number; mount?: string; processing?: boolean }): { script: string; env: string[] } {
    const rt = this.app.rt(stationId);
    const outputs = [...this.app.outputs.values()].filter((o) => o.cfg.stationId === stationId).map((o) => o.cfg);
    const port = Number.isInteger(opts.port) && opts.port! > 1023 && opts.port! < 65536 ? opts.port! : 8005;
    return liquidsoapScript(outputs, {
      stationName: rt.station.name, harborPort: port, harborMount: String(opts.mount ?? 'airdeck').replace(/[^\w/-]/g, '').slice(0, 40) || 'airdeck',
      bitrateKbps: rt.data.playout?.bitrateKbps ?? 128, processing: opts.processing !== false,
    });
  }

  /** Mitgelieferte APK (Windows-Paket) oder null. Legacy-Dateiname (vor der Umbenennung zu AnMaCha Cast gebaute Pakete) bleibt als Fallback erkannt. */
  localApk(): string | null {
    for (const name of ['AnMaCha-Cast-Android.apk', 'AirDeck-Android.apk']) {
      const f = join(this.app.appRoot, 'android', name);
      if (existsSync(f)) return f;
    }
    return null;
  }

  appConnect(): unknown {
    const lanSetting = readJson<{ lan?: boolean }>(join(this.app.dataDir, 'network.json'), {}).lan === true;
    const listening = this.app.listenHost === '0.0.0.0' || this.app.listenHost === '::';
    const addresses: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) addresses.push(`http://${a.address}:${this.app.listenPort}`);
    }
    return { lan: lanSetting, listening, restartNeeded: lanSetting !== listening && !envVar(process.env, 'HOST'), addresses, apk: this.localApk() ? 'local' : 'release' };
  }

  setNetwork(lan: boolean): unknown {
    this.writeNetwork({ lan });
    this.app.audit.write({ kind: 'network', event: 'lan', lan });
    return this.appConnect();
  }

  private readNetwork(): { lan?: boolean; webOrigins?: unknown } {
    return readJson<{ lan?: boolean; webOrigins?: unknown }>(join(this.app.dataDir, 'network.json'), {});
  }

  private writeNetwork(patch: { lan?: boolean; webOrigins?: string[] }): void {
    writeFileAtomic(join(this.app.dataDir, 'network.json'), JSON.stringify({ ...this.readNetwork(), ...patch }));
  }

  private originsCache: Set<string> | null = null;

  /** Webseiten, die AnMaCha Cast aus dem Browser heraus bedienen dürfen (zusätzlich zu ANMACHA_CAST_CORS_ORIGINS). */
  webOrigins(): string[] {
    const raw = this.readNetwork().webOrigins;
    return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string' && normalizeOrigin(o) === o) : [];
  }

  isWebOrigin(origin: string): boolean {
    this.originsCache ??= new Set(this.webOrigins());
    return this.originsCache.has(origin);
  }

  setWebOrigins(input: unknown): { webOrigins: string[] } {
    const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,]+/) : [];
    const out: string[] = [];
    for (const raw of list) {
      const s = String(raw ?? '').trim();
      if (!s) continue;
      const o = normalizeOrigin(s);
      if (!o) throw new AppError(400, 'invalid_origin', `„${s.slice(0, 80)}“ ist keine gültige Webseite. Erlaubt: https://name.de (ohne Pfad) oder http://localhost`);
      if (!out.includes(o)) out.push(o);
    }
    if (out.length > 20) throw new AppError(400, 'too_many', 'Höchstens 20 Webseiten');
    this.writeNetwork({ webOrigins: out });
    this.originsCache = new Set(out);
    this.app.audit.write({ kind: 'network', event: 'web_origins', origins: out });
    return { webOrigins: out };
  }
}

/** Nur reine Origins: https mit Hostname, http nur für diesen PC (localhost/127.0.0.1). Kein Pfad, keine Zugangsdaten. */
export function normalizeOrigin(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return null;
  return u.origin;
}
