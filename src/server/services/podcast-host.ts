// Echter öffentlicher Podcast-Link: (1) eigene öffentliche Basis-Adresse (Tunnel/Domain) mit Erreichbarkeitsprüfung,
// (2) Upload der Episoden zu einem kostenlosen Hoster (Buzzsprout, Podbean), der den öffentlichen Feed betreibt.
// Die Hoster-Clients sind reine Funktionen mit austauschbarem fetch und werden ohne Netz getestet.

import { isIP } from 'node:net';
import { openAsBlob, statSync } from 'node:fs';
import type { AnMaChaCastApp } from '../app.ts';
import { AppError, type Episode, type PodcastHost } from '../model.ts';

export type Fetch = typeof fetch;

const API_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 30 * 60_000;
const UA = 'AnMaChaCast/1.0';

/** true bei Adressen, die von außen nie erreichbar sind (localhost, LAN, ohne Domain-Endung). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || /\.(local|lan|internal|home|localdomain)$/.test(h)) return true;
  const kind = isIP(h);
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (kind === 6) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return !h.includes('.');
}

/** Öffentliche Basis-Adresse prüfen und vereinheitlichen (ohne Zugangsdaten, Query und Anker, ohne Schlussschrägstrich). */
export function normalizeBase(input: unknown): string | undefined {
  const raw = String(input ?? '').trim();
  if (!raw) return undefined;
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new AppError(400, 'invalid', 'Öffentliche Adresse ist keine gültige URL (z. B. https://radio.example.de)'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new AppError(400, 'invalid', 'Öffentliche Adresse muss mit https:// (oder http://) beginnen');
  if (u.username || u.password) throw new AppError(400, 'invalid', 'Öffentliche Adresse darf keine Zugangsdaten enthalten');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export interface PushInput {
  title: string;
  description: string;
  artist: string;
  explicit: boolean;
  season?: number;
  episodeNumber?: number;
  file: string;
  filename: string;
  contentType: string;
  /** im Hoster veröffentlichen (sonst Entwurf/privat) */
  publish: boolean;
}

export interface PushResult { id: string; url?: string; published: boolean; note?: string }

interface PushOpts { pollMs?: number; maxPolls?: number }

// Antworten sind JSON; bei Fehlern kommen je nach Hoster unterschiedliche Felder.
async function body(res: Response): Promise<Record<string, any>> {
  const t = await res.text();
  try { const j = JSON.parse(t); return j && typeof j === 'object' ? j : { value: j }; } catch { return t ? { raw: t.slice(0, 200) } : {}; }
}

function errorText(res: Response, b: Record<string, any>): string {
  const detail = b.error?.message ?? b.error_description ?? (typeof b.error === 'string' ? b.error : undefined) ?? b.message ?? b.raw;
  const hint = res.status === 401 || res.status === 403 ? ' – Zugangsdaten prüfen' : res.status === 429 ? ' – zu viele Anfragen, später erneut versuchen' : '';
  return `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}${hint}`;
}

async function call(f: Fetch, what: string, url: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Record<string, any>> {
  let res: Response;
  try { res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); } catch (err) { throw new AppError(502, 'host_unreachable', `${what}: nicht erreichbar (${(err as Error).message})`); }
  const b = await body(res);
  if (!res.ok) throw new AppError(502, 'host_error', `${what}: ${errorText(res, b)}`);
  return b;
}

async function put(f: Fetch, what: string, url: string, file: string, contentType?: string): Promise<void> {
  const blob = await openAsBlob(file, contentType ? { type: contentType } : undefined); // liest erst beim Senden, nicht in den Speicher
  let res: Response;
  try { res = await f(url, { method: 'PUT', body: blob, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) }); } catch (err) { throw new AppError(502, 'host_unreachable', `${what}: Upload fehlgeschlagen (${(err as Error).message})`); }
  if (!res.ok) throw new AppError(502, 'host_error', `${what}: ${errorText(res, await body(res))}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- Buzzsprout ----------

const BZ = 'https://www.buzzsprout.com';
const bzHeaders = (token: string): Record<string, string> => ({ Authorization: `Token token=${token}`, 'User-Agent': UA, Accept: 'application/json' });
const bzJson = (token: string): Record<string, string> => ({ ...bzHeaders(token), 'Content-Type': 'application/json; charset=utf-8' });

export async function buzzsproutPodcasts(f: Fetch, token: string): Promise<Array<{ id: string; title: string }>> {
  const r = await call(f, 'Buzzsprout', `${BZ}/api/podcasts`, { headers: bzHeaders(token) }) as unknown;
  const list = Array.isArray(r) ? r : [];
  return list.map((p: any) => ({ id: String(p.id), title: String(p.title ?? '') }));
}

export const buzzsproutFeed = (podcastId: string): string => `https://feeds.buzzsprout.com/${podcastId}.rss`;

export async function buzzsproutPush(f: Fetch, token: string, podcastId: string, ep: PushInput, opts: PushOpts = {}): Promise<PushResult> {
  if (!/^\d{1,12}$/.test(podcastId)) throw new AppError(400, 'invalid', 'Buzzsprout-Podcast-ID besteht nur aus Ziffern');
  const size = statSync(ep.file).size;
  const base = `${BZ}/api/${podcastId}/episodes`;
  const created = await call(f, 'Buzzsprout', `${base}`, {
    method: 'POST', headers: bzJson(token),
    body: JSON.stringify({
      title: ep.title, description: ep.description, artist: ep.artist, explicit: ep.explicit, private: true,
      ...(ep.season ? { season_number: ep.season } : {}), ...(ep.episodeNumber ? { episode_number: ep.episodeNumber } : {}),
    }),
  });
  const id = String(created.id ?? '');
  if (!id) throw new AppError(502, 'host_error', 'Buzzsprout: Episode ohne ID angelegt');
  let uploadId = '';
  try {
    const start = await call(f, 'Buzzsprout', `${base}/${id}/uploads`, { method: 'POST', headers: bzJson(token), body: JSON.stringify({ filename: ep.filename, type: ep.contentType, byte_size: size }) });
    const up = start.upload ?? {};
    uploadId = String(up.id ?? '');
    if (!uploadId || !up.upload_url || up.multipart) throw new AppError(502, 'host_error', 'Buzzsprout: Upload konnte nicht gestartet werden');
    await put(f, 'Buzzsprout', String(up.upload_url), ep.file); // ohne Authorization-Header, wie vorgegeben
    await call(f, 'Buzzsprout', `${base}/${id}/uploads/${encodeURIComponent(uploadId)}/complete`, { method: 'POST', headers: bzHeaders(token) });
  } catch (err) {
    if (uploadId) await f(`${base}/${id}/uploads/${encodeURIComponent(uploadId)}/abort`, { method: 'DELETE', headers: bzHeaders(token), signal: AbortSignal.timeout(API_TIMEOUT_MS) }).catch(() => undefined);
    throw err;
  }
  const result: PushResult = { id, published: false };
  // Kodierung läuft asynchron; veröffentlicht werden darf erst danach (duration != -1)
  let url: string | undefined;
  let done = false;
  for (let i = 0; i < (opts.maxPolls ?? 40); i++) {
    const cur = await call(f, 'Buzzsprout', `${base}/${id}`, { headers: bzHeaders(token) });
    url = typeof cur.audio_url === 'string' ? cur.audio_url : url;
    if (typeof cur.duration === 'number' && cur.duration !== -1) { done = true; break; }
    await sleep(opts.pollMs ?? 3000);
  }
  if (url) result.url = url;
  if (!ep.publish) { result.note = 'Als privater Entwurf bei Buzzsprout angelegt'; return result; }
  if (!done) { result.note = 'Buzzsprout kodiert noch – Episode dort in wenigen Minuten veröffentlichen'; return result; }
  await call(f, 'Buzzsprout', `${base}/${id}`, { method: 'PATCH', headers: bzJson(token), body: JSON.stringify({ private: false }) });
  result.published = true;
  return result;
}

// ---------- Podbean ----------

const PB = 'https://api.podbean.com/v1';

export async function podbeanToken(f: Fetch, clientId: string, clientSecret: string): Promise<string> {
  const r = await call(f, 'Podbean', `${PB}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  const t = String(r.access_token ?? '');
  if (!t) throw new AppError(502, 'host_error', 'Podbean: kein Zugriffstoken erhalten');
  return t;
}

export async function podbeanPush(f: Fetch, clientId: string, clientSecret: string, ep: PushInput): Promise<PushResult> {
  const token = await podbeanToken(f, clientId, clientSecret);
  const size = statSync(ep.file).size;
  const auth = await call(f, 'Podbean', `${PB}/files/uploadAuthorize?${new URLSearchParams({ access_token: token, filename: ep.filename, content_type: ep.contentType, filesize: String(size) })}`, { headers: { 'User-Agent': UA } });
  if (!auth.presigned_url || !auth.file_key) throw new AppError(502, 'host_error', 'Podbean: Upload nicht freigegeben');
  await put(f, 'Podbean', String(auth.presigned_url), ep.file, ep.contentType);
  const created = await call(f, 'Podbean', `${PB}/episodes`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({
      access_token: token, title: ep.title, content: ep.description, status: ep.publish ? 'publish' : 'draft', type: 'public', media_key: String(auth.file_key),
      ...(ep.episodeNumber ? { episode_number: String(ep.episodeNumber) } : {}), ...(ep.season ? { season_number: String(ep.season) } : {}),
    }),
  });
  const e = created.episode ?? created;
  const id = String(e.id ?? '');
  if (!id) throw new AppError(502, 'host_error', 'Podbean: Episode ohne ID angelegt');
  return { id, ...(typeof e.permalink_url === 'string' ? { url: e.permalink_url } : {}), published: ep.publish };
}

// ---------- Erreichbarkeit der eigenen öffentlichen Adresse ----------

export interface FeedCheck { ok: boolean; url: string; message: string; status?: number }

export async function checkPublicFeed(f: Fetch, baseUrl: string, stationId: string): Promise<FeedCheck> {
  const url = `${baseUrl}/api/v1/public/stations/${stationId}/podcast.xml`;
  if (isPrivateHost(new URL(baseUrl).hostname)) return { ok: false, url, message: 'Diese Adresse ist nur im eigenen Netz erreichbar. Podcast-Verzeichnisse brauchen eine öffentliche Adresse (Tunnel oder Domain).' };
  let res: Response;
  try { res = await f(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) }); } catch (err) { return { ok: false, url, message: `Nicht erreichbar: ${(err as Error).message}` }; }
  if (!res.ok) return { ok: false, url, status: res.status, message: res.status === 404 ? 'Server antwortet, aber der Feed fehlt (Sender nicht öffentlich?)' : `Server antwortet mit HTTP ${res.status}` };
  const text = (await res.text()).slice(0, 4096);
  if (!/<rss[\s>]/.test(text)) return { ok: false, url, status: res.status, message: 'Die Adresse liefert keinen Podcast-Feed – zeigt sie auf diesen Server?' };
  return { ok: true, url, status: res.status, message: 'Feed ist von außen erreichbar' };
}

// ---------- Dienst ----------

interface Credentials { token?: string; clientId?: string; clientSecret?: string }

export class PodcastHostService {
  private readonly app: AnMaChaCastApp;
  private readonly busy = new Set<string>();
  /** für Tests austauschbar */
  fetchFn: Fetch = (...a) => fetch(...a);
  opts: PushOpts = {};

  constructor(app: AnMaChaCastApp) { this.app = app; }

  private ref = (stationId: string) => `podcast-host:${stationId}`;

  private creds(stationId: string): Credentials {
    const raw = this.app.secrets.get(this.ref(stationId));
    try { return raw ? JSON.parse(raw) as Credentials : {}; } catch { return {}; }
  }

  view(stationId: string): (PodcastHost & { hasCredentials: boolean }) | null {
    const h = this.app.svc.podcast.config(stationId).host;
    return h ? { ...h, hasCredentials: this.app.secrets.has(this.ref(stationId)) } : null;
  }

  /** Hoster einrichten oder (kind leer) entfernen. Zugangsdaten bleiben leer = bisherige behalten. */
  save(stationId: string, input: Record<string, unknown>): PodcastHost | null {
    const rt = this.app.rt(stationId);
    const cfg = this.app.svc.podcast.config(stationId);
    const kind = String(input.kind ?? '');
    if (!kind) {
      delete cfg.host;
      this.app.secrets.delete(this.ref(stationId));
      rt.data.podcast = cfg;
      this.app.changed();
      return null;
    }
    if (kind !== 'buzzsprout' && kind !== 'podbean') throw new AppError(400, 'invalid', 'Hoster muss „buzzsprout“ oder „podbean“ sein');
    const cur = cfg.host?.kind === kind ? cfg.host : undefined;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    let creds: Credentials = cur ? this.creds(stationId) : {};
    const host: PodcastHost = { kind, autoPush: Boolean(input.autoPush ?? cur?.autoPush) };
    if (kind === 'buzzsprout') {
      const podcastId = str(input.podcastId ?? cur?.podcastId);
      if (!/^\d{1,12}$/.test(podcastId)) throw new AppError(400, 'invalid', 'Buzzsprout-Podcast-ID eintragen (nur Ziffern, steht in der Buzzsprout-Adresse)');
      host.podcastId = podcastId;
      host.feedUrl = buzzsproutFeed(podcastId);
      if (str(input.token)) creds = { token: str(input.token) };
      if (!creds.token) throw new AppError(400, 'invalid', 'Buzzsprout-API-Token eintragen (Buzzsprout → Profil → API)');
    } else {
      const feed = str(input.feedUrl ?? cur?.feedUrl);
      if (feed) host.feedUrl = normalizeBase(feed);
      if (str(input.clientId) || str(input.clientSecret)) creds = { clientId: str(input.clientId), clientSecret: str(input.clientSecret) };
      if (!creds.clientId || !creds.clientSecret) throw new AppError(400, 'invalid', 'Podbean Client-ID und Client-Secret eintragen (podbean.com/api → Meine Apps)');
    }
    this.app.secrets.set(this.ref(stationId), JSON.stringify(creds));
    cfg.host = host;
    rt.data.podcast = cfg;
    this.app.audit.write({ kind: 'podcast', event: 'host_configured', stationId, host: kind });
    this.app.changed();
    return host;
  }

  /** Zugangsdaten beim Hoster prüfen, ohne etwas anzulegen. */
  async test(stationId: string): Promise<{ ok: true; message: string; podcasts?: Array<{ id: string; title: string }> }> {
    const host = this.app.svc.podcast.config(stationId).host;
    if (!host) throw new AppError(409, 'no_host', 'Kein Hoster eingerichtet');
    const c = this.creds(stationId);
    if (host.kind === 'buzzsprout') {
      const podcasts = await buzzsproutPodcasts(this.fetchFn, c.token ?? '');
      const mine = podcasts.find((p) => p.id === host.podcastId);
      if (!mine) throw new AppError(404, 'not_found', `Podcast ${host.podcastId} gehört nicht zu diesem Token${podcasts.length ? ` (gefunden: ${podcasts.map((p) => `${p.title} = ${p.id}`).join(', ')})` : ''}`);
      return { ok: true, message: `Verbunden mit „${mine.title}“`, podcasts };
    }
    await podbeanToken(this.fetchFn, c.clientId ?? '', c.clientSecret ?? '');
    return { ok: true, message: 'Verbunden mit Podbean' };
  }

  /** Episode zum Hoster hochladen. Doppelter Upload wird verhindert. */
  async push(stationId: string, episodeId: string): Promise<Episode> {
    const rt = this.app.rt(stationId);
    const host = this.app.svc.podcast.config(stationId).host;
    if (!host) throw new AppError(409, 'no_host', 'Kein Hoster eingerichtet');
    const ep = rt.data.episodes?.find((e) => e.id === episodeId);
    if (!ep) throw new AppError(404, 'not_found', 'Episode nicht gefunden');
    if (ep.hosted) throw new AppError(409, 'already_hosted', `Schon bei ${ep.hosted.kind === 'buzzsprout' ? 'Buzzsprout' : 'Podbean'} angelegt`);
    const key = `${stationId}:${episodeId}`;
    if (this.busy.has(key)) throw new AppError(409, 'busy', 'Upload läuft schon');
    this.busy.add(key);
    try {
      const { path: file, rec } = this.app.svc.recorder.recordingFile(stationId, ep.recordingId);
      const cfg = this.app.svc.podcast.config(stationId);
      const ext = /\.[a-z0-9]{2,4}$/i.exec(rec.file)?.[0] ?? '.mp3';
      const input: PushInput = {
        title: ep.title, description: ep.description, artist: cfg.author, explicit: cfg.explicit,
        ...(ep.season ? { season: ep.season } : {}), ...(ep.episodeNumber ? { episodeNumber: ep.episodeNumber } : {}),
        file, filename: `${ep.id}${ext}`, contentType: rec.contentType || 'audio/mpeg', publish: !!ep.publishedAt,
      };
      const c = this.creds(stationId);
      const r = host.kind === 'buzzsprout'
        ? await buzzsproutPush(this.fetchFn, c.token ?? '', host.podcastId ?? '', input, this.opts)
        : await podbeanPush(this.fetchFn, c.clientId ?? '', c.clientSecret ?? '', input);
      ep.hosted = { kind: host.kind, id: r.id, at: Date.now(), ...(r.url ? { url: r.url } : {}) };
      this.app.audit.write({ kind: 'podcast', event: 'hosted', stationId, episode: ep.id, host: host.kind, published: r.published });
      this.app.publish('podcast.changed', stationId, this.app.svc.podcast.overview(stationId));
      this.app.changed();
      if (r.note) this.app.audit.write({ kind: 'podcast', event: 'host_note', stationId, episode: ep.id, note: r.note });
      return ep;
    } finally {
      this.busy.delete(key);
    }
  }

  /** Vom Auto-Veröffentlichen aufgerufen; Fehler landen im Protokoll statt den Recorder zu stören. */
  async autoPush(stationId: string, episodeId: string): Promise<void> {
    try { await this.push(stationId, episodeId); } catch (err) {
      this.app.audit.write({ kind: 'podcast', event: 'host_failed', stationId, episode: episodeId, message: (err as Error).message });
    }
  }

  async check(stationId: string): Promise<FeedCheck> {
    const base = this.app.svc.podcast.config(stationId).publicBaseUrl;
    if (!base) throw new AppError(409, 'no_public_url', 'Erst eine öffentliche Adresse eintragen');
    return checkPublicFeed(this.fetchFn, base, stationId);
  }
}
