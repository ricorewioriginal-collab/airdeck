// Fernzugriff ohne Portfreigabe (docs/architecture/NETWORK.md „Fernzugriff über einen Vermittler“):
// AnMaCha Cast baut selbst eine ausgehende HTTPS-Verbindung zu einem Vermittler (Hub) auf. Darüber kommen Anfragen herein,
// Antworten und Live-Ereignisse gehen per POST zurück. So ist ein AnMaCha Cast hinter einem Router (Studio-PC) von
// überall bedienbar, ohne Portfreigabe und ohne öffentliche Adresse.
//
// Protokoll (nur Bordmittel, ein Hub kann beliebig viele AnMaCha-Cast-Instanzen vermitteln):
//   GET  <hub>?action=adl_agent&link=<id>   Header X-Link-Key → Server-Sent Events, Ereignis „req“: {rid, method, path, body}
//   POST <hub>?action=adl_reply&link=<id>   {rid, status, body}
//   POST <hub>?action=adl_events&link=<id>  [{type, stationId, payload}]
//
// Jede Anfrage wird über die eigene API (Loopback) mit dem Geräte-Token dieses Fernzugriffs ausgeführt:
// Rolle, Sender, Scopes und Rate-Limit gelten genauso wie für jedes gekoppelte Gerät. Das Token ist unter
// „Geräte“ sichtbar und einzeln widerrufbar. Verbindungscode und Token liegen nur im Secret Store.

import { join } from 'node:path';
import type { AnMaChaCastApp } from '../app.ts';
import type { RelayTap } from '../relay.ts';
import { AppError, type Principal } from '../model.ts';
import { readJson, writeFileAtomic } from '../store.ts';
import { ROLE_SCOPES, type Role } from '../users.ts';

const LINK_ROLES: readonly Role[] = ['operator', 'dj', 'editor', 'viewer'];
/** Diese Ereignisse gehen an den Hub (Pegel und interne Systemmeldungen nicht). */
const EVENT_TYPES = new Set(['now_playing.changed', 'now_playing.live', 'queue.changed', 'MODE_CHANGED', 'automation.state_changed', 'deck.state_changed', 'playout.state', 'cardwall.changed', 'cardwall.triggered', 'stream.state_changed', 'sources.changed', 'library.changed', 'playlists.changed', 'planning.changed']);
/** Nur „hat sich geändert“ melden (für den Inhaltsabgleich), ohne die oft großen Listen mitzuschicken. */
const CHANGE_ONLY = new Set(['library.changed', 'playlists.changed', 'planning.changed']);
/** Über den Fernzugriff nie erreichbar: Anmeldung, Tokens/Geräte, Netzwerk- und Fernzugriffs-Einstellungen, Ereignis-Stream. */
const BLOCKED = /^\/api\/v1\/(auth\/|pair(ing)?\b|tokens\b|devices\b|users\b|app\/|events\b|system\/(restart|shutdown)|update\b|backup\b|storage\b|database\b|secrets?\b)/;
const MAX_REPLY = 2 * 1024 * 1024;
const MAX_FILE = 300 * 1024 * 1024;
const PING_TIMEOUT_MS = 65_000;

interface LinkConfig {
  hub: string;
  link: string;
  name: string;
  enabled: boolean;
  role: Role;
  stationIds: string[];
  /** Sendesignal (Programmbus) an den Vermittler übergeben, wenn er es anfordert – Standard aus */
  feed?: boolean;
  tokenId?: string;
}

/** Laufende Übergabe des Sendesignals eines Senders an den Vermittler */
interface Feed {
  stationId: string;
  tap: RelayTap;
  type: string;
  init: Buffer | null;
  sendInit: boolean;
  chunks: Buffer[];
  bytes: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
}
const FEED_TARGET = '/live';
const FEED_FLUSH_MS = 500;
const FEED_MAX_BUFFER = 2 * 1024 * 1024;

type State = 'off' | 'connecting' | 'online' | 'error';

export interface RemoteLinkView {
  configured: boolean;
  enabled: boolean;
  hub: string | null;
  name: string | null;
  role: Role | null;
  stationIds: string[];
  feed: boolean;
  /** Sender, deren Sendesignal gerade an den Vermittler geht */
  feeding: string[];
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
  private readonly app: AnMaChaCastApp;
  private readonly file: string;
  private running = false;
  private abort: AbortController | null = null;
  private wake: (() => void) | null = null;
  private unsub: (() => void) | null = null;
  private queue: { type: string; stationId?: string; payload: unknown }[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly feeds = new Map<string, Feed>();
  private gen = 0;
  private state: State = 'off';
  private error: string | null = null;
  private since: string | null = null;

  constructor(app: AnMaChaCastApp) {
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
      feed: !!c?.feed, feeding: [...this.feeds.keys()],
      state: c?.enabled ? this.state : 'off', error: c?.enabled ? this.error : null, since: this.since,
    };
  }

  /** Neu einrichten (mit Code) oder ändern (Rolle, Sender, an/aus). */
  configure(p: Principal, input: { code?: unknown; enabled?: unknown; role?: unknown; stationIds?: unknown; feed?: unknown }): RemoteLinkView {
    const cur = this.cfg();
    const code = typeof input.code === 'string' && input.code.trim() ? parseLinkCode(input.code) : null;
    if (!cur && !code) throw new AppError(400, 'no_code', 'Bitte den Verbindungscode aus dem Control Center einfügen');
    const role = LINK_ROLES.includes(input.role as Role) ? (input.role as Role) : (cur?.role ?? 'operator');
    const wanted = Array.isArray(input.stationIds) ? input.stationIds.map(String).filter((s) => s === '*' || this.app.stations.has(s)) : (cur?.stationIds ?? ['*']);
    const stationIds = wanted.includes('*') || !wanted.length ? ['*'] : wanted;
    const next: LinkConfig = {
      hub: code?.hub ?? cur!.hub, link: code?.link ?? cur!.link, name: code ? (code.name || 'Fernzugriff') : cur!.name,
      enabled: input.enabled === undefined ? true : input.enabled === true, role, stationIds, tokenId: cur?.tokenId,
      feed: input.feed === undefined ? (code ? false : !!cur?.feed) : input.feed === true,
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
    this.app.audit.write({ kind: 'network', event: 'remote_link', actor: p.id, hub: next.hub, enabled: next.enabled, role, stationIds, feed: next.feed });
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
    void this.loop(++this.gen);
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
    this.stopFeeds();
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
    return { 'X-Link-Key': this.app.secrets.get('remote-link:key') ?? '', 'User-Agent': `AnMaCha-Cast/${this.app.version} RemoteLink`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      this.wake = () => (clearTimeout(t), r());
    });
  }

  /** Jede Verbindungsschleife gehört zu einer Generation: nach stop()/start() endet die alte sicher (sonst verdrängen sich zwei Schleifen gegenseitig). */
  private async loop(gen: number): Promise<void> {
    const alive = () => this.running && gen === this.gen;
    let delay = 2000;
    while (alive()) {
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
          this.stopFeeds();   // der Vermittler fordert das Signal nach dem Neuverbinden wieder an
          if (alive()) this.setState('connecting', 'Verbindung zum Vermittler unterbrochen – verbinde neu');
        }
      } catch (err) {
        if (!alive()) break;
        const msg = ac.signal.aborted ? 'Vermittler antwortet nicht mehr – verbinde neu' : `Vermittler nicht erreichbar: ${(err as Error).message}`;
        this.setState('error', msg);
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }
      if (!alive()) break;
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
          else if (event === 'feed' && data) this.onFeedRequest(data);
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
      const q = JSON.parse(raw) as { rid?: unknown; method?: unknown; path?: unknown; body?: unknown; pull?: unknown; push?: unknown };
      rid = String(q.rid ?? '').slice(0, 64);
      const method = String(q.method ?? 'GET').toUpperCase();
      const path = String(q.path ?? '');
      if (!rid) return;
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !path.startsWith('/api/v1/') || path.includes('..') || /[\s\\]/.test(path) || BLOCKED.test(path)) {
        status = 403;
        body = { error: 'forbidden', message: 'Über den Fernzugriff nicht erlaubt' };
      } else if (q.pull !== undefined || q.push !== undefined) {
        [status, body] = await this.transfer(method, path, q.pull, q.push);
      } else {
        const r = await fetch(this.local(path), {
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
      body = { error: 'remote_link', message: `Anfrage im AnMaCha Cast fehlgeschlagen: ${(err as Error).message}` };
    }
    try {
      await fetch(this.url('adl_reply'), { method: 'POST', headers: this.headers(true), body: JSON.stringify({ rid, status, body }), signal: AbortSignal.timeout(20_000) });
    } catch {
      /* Hub nicht erreichbar: der Aufrufer bekommt dort ein Timeout */
    }
  }

  private local(path: string): string {
    const host = this.app.listenHost === '0.0.0.0' || this.app.listenHost === '::' ? '127.0.0.1' : this.app.listenHost;
    return `http://${host.includes(':') ? `[${host}]` : host}:${this.app.listenPort}${path}`;
  }

  /**
   * Dateiübertragung für den Inhaltsabgleich, nur mit dem Vermittler selbst (gleiche Herkunft wie die Vermittler-Adresse):
   *  pull: Datei beim Vermittler holen und per PUT an die eigene API geben (z. B. /stations/x/media?name=…)
   *  push: Datei per GET aus der eigenen API lesen und an den Vermittler hochladen.
   */
  private async transfer(method: string, path: string, pull: unknown, push: unknown): Promise<[number, unknown]> {
    const c = this.cfg();
    const target = String(pull ?? push ?? '');
    let ok = false;
    try {
      ok = !!c && new URL(target).origin === new URL(c.hub).origin;
    } catch {
      /* ungültige Adresse */
    }
    if (!ok || (pull !== undefined && method !== 'PUT') || (push !== undefined && method !== 'GET')) {
      return [403, { error: 'forbidden', message: 'Dateiübertragung nur mit dem Vermittler erlaubt' }];
    }
    const auth = { Authorization: `Bearer ${this.app.secrets.get('remote-link:token') ?? ''}` };
    const signal = AbortSignal.timeout(10 * 60_000);
    if (pull !== undefined) {
      const src = await fetch(target, { headers: this.headers(), signal });
      if (!src.ok || !src.body) return [502, { error: 'pull_failed', message: `Datei beim Vermittler nicht abrufbar (HTTP ${src.status})` }];
      if (Number(src.headers.get('content-length') ?? 0) > MAX_FILE) {
        await src.body.cancel();
        return [413, { error: 'too_large', message: 'Datei zu groß' }];
      }
      const r = await fetch(this.local(path), {
        method: 'PUT', headers: { ...auth, 'Content-Type': src.headers.get('content-type') ?? 'application/octet-stream', ...(src.headers.get('content-length') ? { 'Content-Length': src.headers.get('content-length')! } : {}) },
        body: src.body, duplex: 'half', signal,
      } as RequestInit);
      const text = await r.text();
      return [r.status, text && (r.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : null];
    }
    const r = await fetch(this.local(path), { headers: auth, signal, redirect: 'manual' });   // Stream-Titel leiten nur weiter: nichts übertragen
    if (r.status !== 200 || !r.body) {
      if (r.status >= 300 && r.status < 400) return [415, { error: 'unsupported', message: 'Stream-Titel haben keine Datei' }];
      const text = await r.text().catch(() => '');
      return [r.status, text && (r.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : null];
    }
    if (Number(r.headers.get('content-length') ?? 0) > MAX_FILE) {
      await r.body.cancel();
      return [413, { error: 'too_large', message: 'Datei zu groß' }];
    }
    const up = await fetch(target, {
      method: 'POST', headers: { ...this.headers(), 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream', ...(r.headers.get('content-length') ? { 'Content-Length': r.headers.get('content-length')! } : {}) },
      body: r.body, duplex: 'half', signal,
    } as RequestInit);
    await up.body?.cancel();
    return up.ok ? [200, { pushed: true }] : [502, { error: 'push_failed', message: `Upload zum Vermittler fehlgeschlagen (HTTP ${up.status})` }];
  }

  // ---------- Sendesignal übergeben ----------

  /** Anforderung des Vermittlers: {stationId, on}. Nur wenn hier freigegeben und der Sender zum Fernzugriff gehört. */
  private onFeedRequest(raw: string): void {
    let q: { stationId?: unknown; on?: unknown };
    try {
      q = JSON.parse(raw) as typeof q;
    } catch {
      return;
    }
    const sid = String(q.stationId ?? ''), c = this.cfg();
    if (q.on !== true) return this.stopFeed(sid);
    if (!c?.feed || !this.app.stations.has(sid) || !(c.stationIds.includes('*') || c.stationIds.includes(sid)) || this.feeds.has(sid)) return;
    const f: Feed = {
      stationId: sid, type: '', init: null, sendInit: false, chunks: [], bytes: 0, timer: null, busy: false,
      tap: {
        onStart: (type, init) => {
          f.type = type;
          f.init = init ?? null;
          f.sendInit = !!init;
          f.chunks = [];
          f.bytes = 0;
        },
        onData: (chunk) => {
          f.chunks.push(chunk);
          f.bytes += chunk.length;
          while (f.bytes > FEED_MAX_BUFFER && f.chunks.length > 1) f.bytes -= f.chunks.shift()!.length;   // Vermittler zu langsam: Älteres verwerfen
        },
        onStop: () => void this.feedPost(f, Buffer.alloc(0), { 'X-Feed-End': '1' }),
      },
    };
    this.feeds.set(sid, f);
    f.timer = setInterval(() => void this.feedFlush(f), FEED_FLUSH_MS);
    this.app.relayFor(sid, FEED_TARGET).addTap(f.tap);
    this.app.audit.write({ kind: 'network', event: 'remote_link_feed', stationId: sid, on: true });
  }

  private async feedFlush(f: Feed): Promise<void> {
    if (f.busy || !f.type || (!f.bytes && !f.sendInit)) return;
    const body = Buffer.concat(f.sendInit && f.init ? [f.init, ...f.chunks] : f.chunks);
    const init = f.sendInit;
    f.chunks = [];
    f.bytes = 0;
    f.sendInit = false;
    await this.feedPost(f, body, init ? { 'X-Feed-Init': '1' } : {});
  }

  private async feedPost(f: Feed, body: Buffer, extra: Record<string, string>): Promise<void> {
    const c = this.cfg();
    if (!c) return;
    f.busy = true;
    try {
      const r = await fetch(`${this.url('adl_feed')}&s=${encodeURIComponent(f.stationId)}`, {
        method: 'POST', headers: { ...this.headers(), 'Content-Type': f.type || 'application/octet-stream', ...extra }, body, signal: AbortSignal.timeout(10_000),
      });
      await r.body?.cancel();
      if (r.status === 404 || r.status === 410) this.stopFeed(f.stationId);   // Vermittler will das Signal nicht mehr
    } catch {
      /* Aussetzer: der Vermittler fällt nach kurzer Zeit auf seine eigene Automation zurück */
    } finally {
      f.busy = false;
    }
  }

  private stopFeed(sid: string): void {
    const f = this.feeds.get(sid);
    if (!f) return;
    this.feeds.delete(sid);
    if (f.timer) clearInterval(f.timer);
    this.app.relayFor(sid, FEED_TARGET).removeTap(f.tap);
    this.app.audit.write({ kind: 'network', event: 'remote_link_feed', stationId: sid, on: false });
  }

  private stopFeeds(): void {
    for (const sid of [...this.feeds.keys()]) this.stopFeed(sid);
  }

  private onEvent(type: string, stationId: string | undefined, payload: unknown): void {
    if (this.state !== 'online' || !EVENT_TYPES.has(type) || !stationId) return;
    const c = this.cfg();
    if (!c || !(c.stationIds.includes('*') || c.stationIds.includes(stationId))) return;
    // Sendebus-Status kommt jede Sekunde: je Sender nur den neuesten behalten
    if (type === 'playout.state' || CHANGE_ONLY.has(type)) this.queue = this.queue.filter((q) => !(q.type === type && q.stationId === stationId));
    this.queue.push({ type, stationId, payload: CHANGE_ONLY.has(type) ? null : payload });
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
