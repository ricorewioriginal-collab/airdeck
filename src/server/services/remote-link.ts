// Fernzugriff ohne Portfreigabe (docs/architecture/NETWORK.md „Fernzugriff über einen Vermittler“):
// AirDeck baut selbst eine ausgehende HTTPS-Verbindung zu einem Vermittler (Hub) auf. Darüber kommen Anfragen herein,
// Antworten und Live-Ereignisse gehen per POST zurück. So ist ein AirDeck hinter einem Router (Studio-PC) von
// überall bedienbar, ohne Portfreigabe und ohne öffentliche Adresse.
//
// Protokoll (nur Bordmittel, ein Hub kann beliebig viele AirDecks vermitteln):
//   GET  <hub>?action=adl_agent&link=<id>   Header X-Link-Key → Server-Sent Events, Ereignis „req“: {rid, method, path, body}
//   POST <hub>?action=adl_reply&link=<id>   {rid, status, body}
//   POST <hub>?action=adl_events&link=<id>  [{type, stationId, payload}]
//
// Jede Anfrage wird über die eigene API (Loopback) mit dem Geräte-Token dieses Fernzugriffs ausgeführt:
// Rolle, Sender, Scopes und Rate-Limit gelten genauso wie für jedes gekoppelte Gerät. Das Token ist unter
// „Geräte“ sichtbar und einzeln widerrufbar. Verbindungscode und Token liegen nur im Secret Store.

import { join } from 'node:path';
import type { AirDeckApp } from '../app.ts';
import { AppError, type Principal } from '../model.ts';
import { readJson, writeFileAtomic } from '../store.ts';
import { ROLE_SCOPES, type Role } from '../users.ts';

const LINK_ROLES: readonly Role[] = ['operator', 'dj', 'editor', 'viewer'];
/** Diese Ereignisse gehen an den Hub (Pegel und interne Systemmeldungen nicht). */
const EVENT_TYPES = new Set(['now_playing.changed', 'now_playing.live', 'queue.changed', 'MODE_CHANGED', 'automation.state_changed', 'deck.state_changed', 'playout.state', 'cardwall.changed', 'cardwall.triggered', 'stream.state_changed', 'sources.changed']);
/** Über den Fernzugriff nie erreichbar: Anmeldung, Tokens/Geräte, Netzwerk- und Fernzugriffs-Einstellungen, Ereignis-Stream. */
const BLOCKED = /^\/api\/v1\/(auth\/|pair(ing)?\b|tokens\b|devices\b|users\b|app\/|events\b|system\/(restart|shutdown)|update\b|backup\b|storage\b|database\b|secrets?\b)/;
const MAX_REPLY = 2 * 1024 * 1024;
const PING_TIMEOUT_MS = 65_000;

interface LinkConfig {
  hub: string;
  link: string;
  name: string;
  enabled: boolean;
  role: Role;
  stationIds: string[];
  tokenId?: string;
}

type State = 'off' | 'connecting' | 'online' | 'error';

export interface RemoteLinkView {
  configured: boolean;
  enabled: boolean;
  hub: string | null;
  name: string | null;
  role: Role | null;
  stationIds: string[];
  state: State;
  error: string | null;
  since: string | null;
}

/** Verbindungscode aus dem Vermittler: adl1.<base64url(JSON {h: Hub-Adresse, l: Link-ID, k: Schlüssel, n?: Name})> */
export function parseLinkCode(code: string): { hub: string; link: string; key: string; name: string } {
  const m = /^adl1\.([A-Za-z0-9_-]{20,2000})$/.exec(String(code ?? '').trim());
  if (!m) throw new AppError(400, 'invalid_code', 'Das ist kein gültiger Verbindungscode (beginnt mit „adl1.“)');
  let d: { h?: unknown; l?: unknown; k?: unknown; n?: unknown };
  try {
    d = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(400, 'invalid_code', 'Der Verbindungscode ist beschädigt – bitte neu kopieren');
  }
  let u: URL;
  try {
    u = new URL(String(d.h ?? ''));
  } catch {
    throw new AppError(400, 'invalid_code', 'Der Verbindungscode enthält keine gültige Vermittler-Adresse');
  }
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.username || u.password || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback))) {
    throw new AppError(400, 'invalid_code', 'Der Vermittler muss per https erreichbar sein');
  }
  const link = String(d.l ?? '');
  const key = String(d.k ?? '');
  if (!/^[a-z0-9]{8,40}$/.test(link) || !/^[A-Za-z0-9_-]{24,200}$/.test(key)) throw new AppError(400, 'invalid_code', 'Der Verbindungscode ist unvollständig');
  return { hub: u.toString().replace(/\/$/, ''), link, key, name: String(d.n ?? '').slice(0, 60) };
}

export class RemoteLinkService {
  private readonly app: AirDeckApp;
  private readonly file: string;
  private running = false;
  private abort: AbortController | null = null;
  private wake: (() => void) | null = null;
  private unsub: (() => void) | null = null;
  private queue: { type: string; stationId?: string; payload: unknown }[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private state: State = 'off';
  private error: string | null = null;
  private since: string | null = null;

  constructor(app: AirDeckApp) {
    this.app = app;
    this.file = join(app.dataDir, 'remote-link.json');
  }

  private cfg(): LinkConfig | null {
    const c = readJson<LinkConfig | null>(this.file, null);
    return c && c.hub && c.link ? c : null;
  }

  view(): RemoteLinkView {
    const c = this.cfg();
    return {
      configured: !!c, enabled: !!c?.enabled, hub: c?.hub ?? null, name: c?.name ?? null, role: c?.role ?? null, stationIds: c?.stationIds ?? [],
      state: c?.enabled ? this.state : 'off', error: c?.enabled ? this.error : null, since: this.since,
    };
  }

  /** Neu einrichten (mit Code) oder ändern (Rolle, Sender, an/aus). */
  configure(p: Principal, input: { code?: unknown; enabled?: unknown; role?: unknown; stationIds?: unknown }): RemoteLinkView {
    const cur = this.cfg();
    const code = typeof input.code === 'string' && input.code.trim() ? parseLinkCode(input.code) : null;
    if (!cur && !code) throw new AppError(400, 'no_code', 'Bitte den Verbindungscode aus dem Control Center einfügen');
    const role = LINK_ROLES.includes(input.role as Role) ? (input.role as Role) : (cur?.role ?? 'operator');
    const wanted = Array.isArray(input.stationIds) ? input.stationIds.map(String).filter((s) => s === '*' || this.app.stations.has(s)) : (cur?.stationIds ?? ['*']);
    const stationIds = wanted.includes('*') || !wanted.length ? ['*'] : wanted;
    const next: LinkConfig = {
      hub: code?.hub ?? cur!.hub, link: code?.link ?? cur!.link, name: code ? (code.name || 'Fernzugriff') : cur!.name,
      enabled: input.enabled === undefined ? true : input.enabled === true, role, stationIds, tokenId: cur?.tokenId,
    };
    // Rechte geändert oder neuer Code → eigenes Geräte-Token neu ausstellen (altes widerrufen)
    if (code || !cur || cur.role !== role || cur.stationIds.join() !== stationIds.join() || !this.app.secrets.get('remote-link:token')) {
      if (next.tokenId) try { this.app.svc.auth.revokeToken(next.tokenId); } catch { /* bereits widerrufen */ }
      const { token, info } = this.app.svc.auth.createToken({ name: `Fernzugriff: ${next.name}`, scopes: ROLE_SCOPES[role], roles: [role], stationIds });
      const rec = this.app.svc.auth.tokens.find((t) => t.id === info.id);
      if (rec) {
        rec.device = { platform: 'web', pairedAt: new Date().toISOString(), ip: 'Vermittler' };
        this.app.docs.set('tokens', this.app.svc.auth.tokens);
      }
      next.tokenId = info.id;
      this.app.secrets.set('remote-link:token', token);
    }
    if (code) this.app.secrets.set('remote-link:key', code.key);
    writeFileAtomic(this.file, JSON.stringify(next));
    this.app.audit.write({ kind: 'network', event: 'remote_link', actor: p.id, hub: next.hub, enabled: next.enabled, role, stationIds });
    this.restart();
    return this.view();
  }

  remove(p: Principal): RemoteLinkView {
    const cur = this.cfg();
    this.stop();
    if (cur?.tokenId) try { this.app.svc.auth.revokeToken(cur.tokenId); } catch { /* bereits widerrufen */ }
    this.app.secrets.delete('remote-link:token');
    this.app.secrets.delete('remote-link:key');
    writeFileAtomic(this.file, 'null');
    this.app.audit.write({ kind: 'network', event: 'remote_link_removed', actor: p.id });
    this.state = 'off';
    this.error = null;
    return this.view();
  }

  start(): void {
    const c = this.cfg();
    if (this.running || !c?.enabled) return;
    this.running = true;
    this.unsub = this.app.subscribe((e) => this.onEvent(e.type, e.stationId, e.payload));
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.unsub?.();
    this.unsub = null;
    this.abort?.abort();
    this.wake?.();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.queue = [];
    this.setState('off');
  }

  private restart(): void {
    this.stop();
    this.start();
  }

  private setState(s: State, err: string | null = null): void {
    if (s !== this.state) this.since = new Date().toISOString();
    this.state = s;
    this.error = err;
    this.app.publish('remote_link.state', undefined, { state: s, error: err });
  }

  private url(action: string): string {
    const c = this.cfg()!;
    return `${c.hub}${c.hub.includes('?') ? '&' : '?'}action=${action}&link=${encodeURIComponent(c.link)}`;
  }

  private headers(json = false): Record<string, string> {
    return { 'X-Link-Key': this.app.secrets.get('remote-link:key') ?? '', 'User-Agent': `AirDeck/${this.app.version} RemoteLink`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      this.wake = () => (clearTimeout(t), r());
    });
  }

  private async loop(): Promise<void> {
    let delay = 2000;
    while (this.running) {
      const ac = new AbortController();
      this.abort = ac;
      let watchdog: NodeJS.Timeout | null = null;
      const feed = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => ac.abort(), PING_TIMEOUT_MS);
      };
      try {
        if (this.state !== 'online') this.setState('connecting', this.error);
        feed();
        const r = await fetch(this.url('adl_agent'), { headers: { ...this.headers(), Accept: 'text/event-stream' }, signal: ac.signal });
        if (r.status === 401 || r.status === 403) {
          this.setState('error', 'Der Vermittler hat den Verbindungscode abgelehnt (widerrufen oder falsch) – im Control Center einen neuen Code erzeugen');
          delay = 60_000;
        } else if (!r.ok || !r.body) {
          throw new Error(`Vermittler antwortet mit HTTP ${r.status}`);
        } else {
          this.setState('online');
          delay = 2000;
          await this.readStream(r.body, feed);
          if (this.running) this.setState('connecting', 'Verbindung zum Vermittler unterbrochen – verbinde neu');
        }
      } catch (err) {
        if (!this.running) break;
        const msg = ac.signal.aborted ? 'Vermittler antwortet nicht mehr – verbinde neu' : `Vermittler nicht erreichbar: ${(err as Error).message}`;
        this.setState('error', msg);
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }
      if (!this.running) break;
      await this.sleep(delay);
      delay = Math.min(delay * 2, 60_000);
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>, feed: () => void): Promise<void> {
    const dec = new TextDecoder();
    let buf = '';
    let event = 'message';
    let data = '';
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      feed();
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line === '') {
          if (event === 'req' && data) void this.handle(data);
          event = 'message';
          data = '';
        } else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart();
      }
      if (buf.length > 1024 * 1024) buf = ''; // kaputter Strom: nicht unbegrenzt puffern
    }
  }

  /** Eine vermittelte Anfrage über die eigene API ausführen und die Antwort zurückschicken. */
  private async handle(raw: string): Promise<void> {
    let rid = '';
    let status = 500;
    let body: unknown = null;
    try {
      const q = JSON.parse(raw) as { rid?: unknown; method?: unknown; path?: unknown; body?: unknown };
      rid = String(q.rid ?? '').slice(0, 64);
      const method = String(q.method ?? 'GET').toUpperCase();
      const path = String(q.path ?? '');
      if (!rid) return;
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !path.startsWith('/api/v1/') || path.includes('..') || /[\s\\]/.test(path) || BLOCKED.test(path)) {
        status = 403;
        body = { error: 'forbidden', message: 'Über den Fernzugriff nicht erlaubt' };
      } else {
        const host = this.app.listenHost === '0.0.0.0' || this.app.listenHost === '::' ? '127.0.0.1' : this.app.listenHost;
        const r = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${this.app.listenPort}${path}`, {
          method,
          headers: { Authorization: `Bearer ${this.app.secrets.get('remote-link:token') ?? ''}`, 'Content-Type': 'application/json' },
          body: method === 'GET' || method === 'DELETE' || q.body === undefined ? undefined : JSON.stringify(q.body),
          signal: AbortSignal.timeout(20_000),
        });
        status = r.status;
        const type = r.headers.get('content-type') ?? '';
        const len = Number(r.headers.get('content-length') ?? 0);
        if (!type.includes('json') || len > MAX_REPLY) {
          await r.body?.cancel();
          if (r.ok) body = { error: 'unsupported', message: 'Diese Antwort (Datei/Audio) wird über den Fernzugriff nicht übertragen' };
          if (r.ok) status = 415;
        } else {
          const text = await r.text();
          body = text.length > MAX_REPLY ? { error: 'too_large', message: 'Antwort zu groß für den Fernzugriff' } : text ? JSON.parse(text) : null;
          if (text.length > MAX_REPLY) status = 413;
        }
      }
    } catch (err) {
      status = 502;
      body = { error: 'remote_link', message: `Anfrage im AirDeck fehlgeschlagen: ${(err as Error).message}` };
    }
    try {
      await fetch(this.url('adl_reply'), { method: 'POST', headers: this.headers(true), body: JSON.stringify({ rid, status, body }), signal: AbortSignal.timeout(20_000) });
    } catch {
      /* Hub nicht erreichbar: der Aufrufer bekommt dort ein Timeout */
    }
  }

  private onEvent(type: string, stationId: string | undefined, payload: unknown): void {
    if (this.state !== 'online' || !EVENT_TYPES.has(type) || !stationId) return;
    const c = this.cfg();
    if (!c || !(c.stationIds.includes('*') || c.stationIds.includes(stationId))) return;
    // Sendebus-Status kommt jede Sekunde: je Sender nur den neuesten behalten
    if (type === 'playout.state') this.queue = this.queue.filter((q) => !(q.type === type && q.stationId === stationId));
    this.queue.push({ type, stationId, payload });
    if (this.queue.length > 500) this.queue.splice(0, this.queue.length - 500);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 300);
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    const batch = this.queue;
    this.queue = [];
    if (!batch.length || this.state !== 'online') return;
    try {
      await fetch(this.url('adl_events'), { method: 'POST', headers: this.headers(true), body: JSON.stringify(batch), signal: AbortSignal.timeout(10_000) });
    } catch {
      /* Ereignisse sind flüchtig; der Client holt den Stand beim nächsten Abruf ohnehin neu */
    }
  }
}
