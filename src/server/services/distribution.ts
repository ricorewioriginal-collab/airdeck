// Verbreitung: „Eigene Streams“ - bis zu zwei zusätzliche Mounts auf dem eigenen Icecast mit eigener Bitrate und
// öffentlichem Link. Technisch ein Zusatz-Stream-Profil (Encoder) plus ein Ausgang mit profileId; der Dienst legt
// beides gemeinsam an, übernimmt Server und Zugangsdaten des vorhandenen Icecast-Ausgangs und hält beide synchron.

import type { AnMaChaCastApp } from '../app.ts';
import { AppError, type Principal } from '../model.ts';
import type { OutputConfig } from '../icecast.ts';

export const MAX_OWN_STREAMS = 2;

export interface OwnStream {
  id: string;
  name: string;
  format: string;
  bitrateKbps: number;
  mount: string;
  link: string;
  enabled: boolean;
  status: string;
  error?: string;
  listeners: number | null;
}

/** Fremde Dienste (laut.fm) sind kein „eigener“ Icecast: dort gelten deren Mount-Regeln. */
const isThirdParty = (host: string) => /(^|\.)laut\.fm$/i.test(host);

export class DistributionService {
  private readonly app: AnMaChaCastApp;
  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  /** Ausgang des Hauptstreams auf dem eigenen Icecast: Quelle für Server und Zugangsdaten der eigenen Streams. */
  private base(stationId: string): OutputConfig | null {
    const cands = [...this.app.outputs.values()].map((o) => o.cfg).filter((c) => c.stationId === stationId && c.type === 'icecast' && !c.profileId && !c.own && !isThirdParty(c.host));
    // ein pausierter Hauptstream bleibt trotzdem die richtige Quelle für Server und Zugang
    return cands.find((c) => c.enabled) ?? cands[0] ?? null;
  }

  private ownOutputs(stationId: string) {
    return [...this.app.outputs.values()].filter((o) => o.cfg.stationId === stationId && o.cfg.own && o.cfg.profileId);
  }

  private link(c: OutputConfig): string {
    const defaultPort = c.tls ? 443 : 80;
    return `${c.tls ? 'https' : 'http'}://${c.host}${c.port === defaultPort ? '' : `:${c.port}`}${c.mount}`;
  }

  list(stationId: string): { max: number; source: { host: string; port: number; tls: boolean } | null; items: OwnStream[] } {
    const base = this.base(stationId);
    const profiles = this.app.listStreamProfiles(stationId);
    const items = this.ownOutputs(stationId).map((o): OwnStream => {
      const sp = profiles.find((x) => x.id === o.cfg.profileId);
      return {
        id: o.cfg.id,
        name: o.cfg.name,
        format: sp?.format ?? 'mp3',
        bitrateKbps: sp?.bitrateKbps ?? o.cfg.bitrateKbps ?? 0,
        mount: o.cfg.mount,
        link: this.link(o.cfg),
        enabled: o.cfg.enabled && sp?.enabled !== false,
        status: o.state.status,
        ...(o.state.error ? { error: o.state.error } : {}),
        listeners: o.state.listeners ?? null,
      };
    });
    return { max: MAX_OWN_STREAMS, source: base ? { host: base.host, port: base.port, tls: base.tls } : null, items };
  }

  private slug(name: string, taken: Set<string>): string {
    const s = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'stream';
    let m = `/${s}`;
    for (let i = 2; taken.has(m); i++) m = `/${s}-${i}`;
    return m;
  }

  create(p: Principal, stationId: string, input: Record<string, unknown>): OwnStream {
    const existing = this.ownOutputs(stationId);
    if (existing.length >= MAX_OWN_STREAMS) throw new AppError(409, 'limit', `Höchstens ${MAX_OWN_STREAMS} eigene Streams je Sender`);
    const base = this.base(stationId);
    if (!base) throw new AppError(409, 'no_icecast', 'Zuerst einen Icecast-Ausgang auf dem eigenen Server einrichten (nicht laut.fm) - von dort werden Server und Zugang übernommen');
    const password = this.app.secrets.get(base.passwordRef);
    if (!password) throw new AppError(409, 'no_password', 'Der Icecast-Ausgang hat kein gespeichertes Passwort');
    const name = String(input.name ?? '').trim().slice(0, 60) || 'Eigener Stream';
    const taken = new Set([...this.app.outputs.values()].filter((o) => o.cfg.host === base.host && o.cfg.port === base.port).map((o) => o.cfg.mount));
    const mount = this.slug(name, taken);
    const format = (input.format === 'aac' || input.format === 'opus' ? input.format : 'mp3') as string;
    const profile = this.app.saveStreamProfile(p, stationId, null, { name, format, bitrateKbps: input.bitrateKbps ?? 128, enabled: true });
    try {
      const out = this.app.saveOutput(p, stationId, null, {
        name, type: 'icecast', host: base.host, port: base.port, tls: base.tls, username: base.username, password,
        mount, sourceTarget: base.sourceTarget, profileId: profile.id, bitrateKbps: profile.bitrateKbps, enabled: true, own: true,
      }) as { id: string };
      this.app.audit.write({ kind: 'distribution', event: 'own_stream_created', actor: p.id, stationId, outputId: out.id, bitrateKbps: profile.bitrateKbps });
      return this.list(stationId).items.find((x) => x.id === out.id)!;
    } catch (err) {
      this.app.removeStreamProfile(p, stationId, profile.id); // kein verwaistes Profil, wenn der Ausgang scheitert
      throw err;
    }
  }

  private ownOf(stationId: string, id: string) {
    const o = this.ownOutputs(stationId).find((x) => x.cfg.id === id);
    if (!o) throw new AppError(404, 'not_found', 'Eigener Stream nicht gefunden');
    return o;
  }

  update(p: Principal, stationId: string, id: string, input: Record<string, unknown>): OwnStream {
    const o = this.ownOf(stationId, id);
    const profileId = o.cfg.profileId!;
    const patch: Record<string, unknown> = {};
    if (typeof input.name === 'string') patch.name = input.name.trim().slice(0, 60) || o.cfg.name;
    if (input.bitrateKbps !== undefined) patch.bitrateKbps = input.bitrateKbps;
    if (typeof input.enabled === 'boolean') patch.enabled = input.enabled;
    const prof = this.app.listStreamProfiles(stationId).find((x) => x.id === profileId);
    this.app.saveStreamProfile(p, stationId, profileId, { ...(patch.name ? { name: patch.name } : {}), ...(patch.bitrateKbps !== undefined ? { bitrateKbps: patch.bitrateKbps } : {}), enabled: patch.enabled ?? prof?.enabled ?? true });
    this.app.saveOutput(p, stationId, id, { ...(patch.name ? { name: patch.name } : {}), ...(patch.bitrateKbps !== undefined ? { bitrateKbps: patch.bitrateKbps } : {}), ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}) });
    this.app.audit.write({ kind: 'distribution', event: 'own_stream_updated', actor: p.id, stationId, outputId: id });
    return this.list(stationId).items.find((x) => x.id === id)!;
  }

  remove(p: Principal, stationId: string, id: string): void {
    const o = this.ownOf(stationId, id);
    const profileId = o.cfg.profileId!;
    this.app.removeOutput(p, stationId, id);
    try {
      this.app.removeStreamProfile(p, stationId, profileId);
    } catch {
      /* Profil wird noch anderweitig genutzt - bleibt bestehen */
    }
    this.app.audit.write({ kind: 'distribution', event: 'own_stream_removed', actor: p.id, stationId, outputId: id });
  }
}
