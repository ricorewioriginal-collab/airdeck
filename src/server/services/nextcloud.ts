// Nextcloud-Brücke: Medien per WebDAV durchsuchen und übernehmen, Mitschnitte hochladen.

import type { AirDeckApp } from '../app.ts';
import { mkdirSync, rmSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { extname, join } from 'node:path';
import { MEDIA_CATEGORIES, parseFileName, type MediaItem } from '../../core/automation.ts';
import { AUDIO_FILE_RE, AppError, canSee, newId, type Principal } from '../model.ts';
import { UserStore } from '../users.ts';
import { Nextcloud, NextcloudError, cleanPath, type NextcloudConfig } from '../nextcloud.ts';

type CloudOwner = { kind: 'user' | 'station'; id: string };

interface HubNextcloudSource {
  id: string;
  owner: CloudOwner;
  name: string;
  url: string;
  user: string;
  root: string;
  secretRef: string;
  allowPrivateNetwork: boolean;
  createdAt: number;
  updatedAt: number;
  revision: number;
  lastScanAt: number | null;
  lastError: string | null;
  createdByUserId: string;
  stationContextId: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  syncQuotaBytes: number;
  syncMaxFileBytes: number;
  nextSyncAt: number | null;
  lastSyncAt: number | null;
  syncFailures: number;
  offlineUntil: number | null;
}

interface HubNextcloudEntry {
  sourceId: string;
  path: string;
  name: string;
  size: number;
  type: string;
  modified: string | null;
  indexedAt: number;
}

interface HubNextcloudJob {
  id: string;
  sourceId: string;
  kind: 'scan' | 'retrieve' | 'sync';
  status: 'queued' | 'running' | 'done' | 'failed';
  createdAt: number;
  updatedAt: number;
  files: number;
  path?: string;
  itemId?: string;
  error: string | null;
}

interface HubNextcloudState {
  version: 1;
  sources: HubNextcloudSource[];
  entries: HubNextcloudEntry[];
  jobs: HubNextcloudJob[];
}

const HUB_NC_MAX_FILES = 1000;
const HUB_NC_MAX_JOBS = 500;
const HUB_NC_MAX_DEPTH = 5;
const HUB_NC_DEFAULT_QUOTA = 2 * 1024 * 1024 * 1024;
const HUB_NC_DEFAULT_MAX_FILE = 500 * 1024 * 1024;
const HUB_NC_MIN_SYNC_MINUTES = 5;
const HUB_NC_MAX_SYNC_MINUTES = 24 * 60;
const hasScope = (p: Principal, scope: string) => p.scopes.includes('*') || p.scopes.includes(scope);

export class NextcloudService {
  private readonly app: AirDeckApp;
  private syncRunning = false;

  constructor(app: AirDeckApp) {
    this.app = app;
  }

  private privateAddress(address: string): boolean {
    const a = address.toLowerCase();
    if (a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80:')) return true;
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
    if (!m) return false;
    const x = Number(m[1]), y = Number(m[2]);
    return x === 0 || x === 10 || x === 127 || x === 169 && y === 254 || x === 172 && y >= 16 && y <= 31
      || x === 192 && y === 168 || x === 100 && y >= 64 && y <= 127 || x >= 224;
  }

  private hubFetch(source: HubNextcloudSource): typeof fetch {
    const base = new URL(source.url);
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      let target = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (target.origin !== base.origin) throw new NextcloudError(502, 'Nextcloud-Weiterleitung auf fremden Host blockiert');
        if (!source.allowPrivateNetwork) {
          const addresses = await lookup(target.hostname, { all: true }).catch(() => []);
          if (!addresses.length) throw new NextcloudError(502, 'Nextcloud-Host konnte nicht aufgelöst werden');
          if (addresses.some((x) => this.privateAddress(x.address))) throw new NextcloudError(502, 'Private oder lokale Nextcloud-Adresse ist für diese Quelle nicht freigegeben');
        }
        const response = await fetch(target, { ...init, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('location');
        if (!location) return response;
        target = new URL(location, target);
      }
      throw new NextcloudError(502, 'Zu viele Nextcloud-Weiterleitungen');
    }) as typeof fetch;
  }

  private hubState(): HubNextcloudState {
    const state = this.app.docs.get<HubNextcloudState>('musikhub-nextcloud', { version: 1, sources: [], entries: [], jobs: [] });
    for (const source of state.sources) {
      source.createdByUserId ??= source.owner.kind === 'user' ? source.owner.id : '';
      source.stationContextId ??= source.owner.kind === 'station' ? source.owner.id : '';
      source.syncEnabled ??= false;
      source.syncIntervalMinutes = Math.min(HUB_NC_MAX_SYNC_MINUTES, Math.max(HUB_NC_MIN_SYNC_MINUTES, Number(source.syncIntervalMinutes) || 60));
      source.syncQuotaBytes = Math.max(1, Number(source.syncQuotaBytes) || HUB_NC_DEFAULT_QUOTA);
      source.syncMaxFileBytes = Math.max(1, Math.min(HUB_NC_DEFAULT_MAX_FILE, Number(source.syncMaxFileBytes) || HUB_NC_DEFAULT_MAX_FILE));
      source.nextSyncAt ??= source.syncEnabled ? Date.now() : null;
      source.lastSyncAt ??= null;
      source.syncFailures ??= 0;
      source.offlineUntil ??= null;
    }
    return state;
  }

  private saveHubState(state: HubNextcloudState): void {
    this.app.docs.set('musikhub-nextcloud', state);
  }

  private pushHubJob(state: HubNextcloudState, job: HubNextcloudJob): void {
    this.pushHubJob(state, job);
    if (state.jobs.length > HUB_NC_MAX_JOBS) state.jobs = state.jobs.slice(-HUB_NC_MAX_JOBS);
  }

  private assertNoRunningJob(sourceId: string, kind: HubNextcloudJob['kind'], path?: string): void {
    const running = this.hubState().jobs.find((job) =>
      job.sourceId === sourceId
      && job.kind === kind
      && job.status === 'running'
      && (path === undefined || job.path === path));
    if (running) throw new AppError(409, 'job_running', kind === 'sync'
      ? 'Für diese Cloudquelle läuft bereits eine Synchronisierung'
      : kind === 'scan'
        ? 'Für diese Cloudquelle läuft bereits ein Scan'
        : 'Diese Cloud-Datei wird bereits abgerufen');
  }

  private backgroundPrincipal(source: HubNextcloudSource): Principal {
    const userId = source.owner.kind === 'user' ? source.owner.id : source.createdByUserId;
    const user = userId ? this.app.users.get(userId) : null;
    if (!user || user.disabled) throw new AppError(403, 'forbidden', 'Cloud-Sync-Benutzer ist nicht aktiv');
    if (source.owner.kind === 'station' && !user.stationIds.includes(source.owner.id)) {
      throw new AppError(403, 'forbidden', 'Cloud-Sync-Benutzer ist dem Eigentümersender nicht mehr zugeordnet');
    }
    return {
      id: user.id,
      tokenId: `musikhub-sync:${source.id}`,
      roles: user.roles,
      stationIds: user.stationIds,
      scopes: UserStore.scopesFor(user.roles),
      user: { id: user.id, username: user.username, name: user.name },
    };
  }

  private contextStation(source: HubNextcloudSource): string {
    const stationId = source.owner.kind === 'station' ? source.owner.id : source.stationContextId;
    const user = this.app.users.get(source.owner.kind === 'user' ? source.owner.id : source.createdByUserId);
    if (!stationId || !this.app.stations.has(stationId) || !user || !user.stationIds.includes(stationId)) {
      throw new AppError(409, 'no_station_context', 'Cloud-Synchronisierung hat keinen gültigen Senderkontext');
    }
    return stationId;
  }

  async resumeHubNextcloudSync(): Promise<void> {
    const state = this.hubState();
    let changed = false;
    const now = Date.now();
    for (const job of state.jobs) {
      if (job.status !== 'running' && job.status !== 'queued') continue;
      job.status = 'failed';
      job.error = 'Durch Neustart unterbrochen; Quelle wurde zur erneuten Synchronisierung vorgemerkt';
      job.updatedAt = now;
      const source = state.sources.find((x) => x.id === job.sourceId);
      if (source?.syncEnabled) source.nextSyncAt = now;
      changed = true;
    }
    if (changed) {
      this.saveHubState(state);
      await this.app.docs.flush();
    }
  }

  private explicitStationMember(p: Principal, stationId: string): boolean {
    if (!p.user) return false;
    const user = this.app.users.get(p.user.id);
    return !!user && !user.disabled && user.stationIds.includes(stationId);
  }

  private ownerAccess(p: Principal, owner: CloudOwner): boolean {
    return owner.kind === 'user' ? p.user?.id === owner.id : this.explicitStationMember(p, owner.id);
  }

  private stationContext(p: Principal, stationId: string): void {
    if (!this.app.stations.has(stationId) || !canSee(p, stationId)) throw new AppError(404, 'not_found', 'Sender nicht gefunden');
  }

  private publicHubSource(source: HubNextcloudSource) {
    return {
      id: source.id,
      owner: source.owner,
      name: source.name,
      url: source.url,
      user: source.user,
      root: source.root,
      allowPrivateNetwork: source.allowPrivateNetwork,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      revision: source.revision,
      lastScanAt: source.lastScanAt,
      lastError: source.lastError,
      syncEnabled: source.syncEnabled,
      syncIntervalMinutes: source.syncIntervalMinutes,
      syncQuotaBytes: source.syncQuotaBytes,
      syncUsedBytes: [...this.app.svc.musikhub.nextcloudSyncState(source.id).values()].reduce((sum, x) => sum + x.size, 0),
      syncMaxFileBytes: source.syncMaxFileBytes,
      nextSyncAt: source.nextSyncAt,
      lastSyncAt: source.lastSyncAt,
      syncFailures: source.syncFailures,
      offlineUntil: source.offlineUntil,
      hasPassword: this.app.secrets.has(source.secretRef),
    };
  }

  private hubSource(p: Principal, stationId: string, id: string, write = false): HubNextcloudSource {
    this.stationContext(p, stationId);
    if (!hasScope(p, write ? 'media:write' : 'media:read')) throw new AppError(403, 'forbidden', 'Medienrecht fehlt');
    const source = this.hubState().sources.find((x) => x.id === id);
    if (!source || !this.ownerAccess(p, source.owner)) throw new AppError(404, 'not_found', 'Cloud-Quelle nicht gefunden');
    return source;
  }

  hubNextcloudSources(p: Principal, stationId: string) {
    this.stationContext(p, stationId);
    if (!hasScope(p, 'media:read')) throw new AppError(403, 'forbidden', 'Medien-Leserecht fehlt');
    return this.hubState().sources.filter((source) => this.ownerAccess(p, source.owner)).map((source) => this.publicHubSource(source));
  }

  async saveHubNextcloudSource(p: Principal, stationId: string, id: string | null, input: Record<string, unknown>) {
    this.stationContext(p, stationId);
    if (!p.user || !hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Cloud-Quellen benötigen ein Benutzerkonto mit Medien-Schreibrecht');
    const state = this.hubState();
    let source = id ? state.sources.find((x) => x.id === id) : undefined;
    if (id && (!source || !this.ownerAccess(p, source.owner))) throw new AppError(404, 'not_found', 'Cloud-Quelle nicht gefunden');

    const ownerKind = input.ownerKind === 'station' ? 'station' : 'user';
    const owner: CloudOwner = ownerKind === 'station' ? { kind: 'station', id: stationId } : { kind: 'user', id: p.user.id };
    if (!this.ownerAccess(p, owner)) throw new AppError(403, 'forbidden', 'Eigentümer nicht erlaubt');

    const rawUrl = String(input.url ?? source?.url ?? '').trim().replace(/\/+$/, '');
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { throw new AppError(400, 'invalid_url', 'Ungültige Nextcloud-Adresse'); }
    const allowPrivateNetwork = input.allowPrivateNetwork === true;
    if (parsed.protocol !== 'https:' && !(allowPrivateNetwork && p.roles.includes('admin'))) {
      throw new AppError(400, 'https_required', 'MusicHub-Cloudquellen benötigen HTTPS; private HTTP-Netze nur mit Admin-Freigabe');
    }
    if (!parsed.hostname || parsed.username || parsed.password) throw new AppError(400, 'invalid_url', 'Ungültige Nextcloud-Adresse');

    const user = String(input.user ?? source?.user ?? '').trim().slice(0, 200);
    if (!user) throw new AppError(400, 'invalid_user', 'Nextcloud-Benutzername fehlt');
    let root: string;
    try { root = cleanPath(String(input.root ?? source?.root ?? '/')); } catch { throw new AppError(400, 'invalid_path', 'Ungültiger Startordner'); }

    if (!source) {
      const sourceId = newId('ncsrc');
      source = {
        id: sourceId,
        owner,
        name: String(input.name ?? 'Nextcloud').trim().slice(0, 80) || 'Nextcloud',
        url: rawUrl,
        user,
        root,
        secretRef: `musikhub:nextcloud:${sourceId}:password`,
        allowPrivateNetwork,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        revision: 1,
        lastScanAt: null,
        lastError: null,
        createdByUserId: p.user.id,
        stationContextId: stationId,
        syncEnabled: input.syncEnabled === true,
        syncIntervalMinutes: Math.min(HUB_NC_MAX_SYNC_MINUTES, Math.max(HUB_NC_MIN_SYNC_MINUTES, Number(input.syncIntervalMinutes) || 60)),
        syncQuotaBytes: Math.max(1, Math.floor(Number(input.syncQuotaBytes) || HUB_NC_DEFAULT_QUOTA)),
        syncMaxFileBytes: Math.max(1, Math.min(HUB_NC_DEFAULT_MAX_FILE, Math.floor(Number(input.syncMaxFileBytes) || HUB_NC_DEFAULT_MAX_FILE))),
        nextSyncAt: input.syncEnabled === true ? Date.now() : null,
        lastSyncAt: null,
        syncFailures: 0,
        offlineUntil: null,
      };
      state.sources.push(source);
    } else {
      const revision = Number(input.revision);
      if (!Number.isInteger(revision) || revision !== source.revision) throw new AppError(409, 'revision_conflict', 'Cloud-Quelle wurde inzwischen geändert');
      source.owner = owner;
      source.stationContextId = stationId;
      source.name = String(input.name ?? source.name).trim().slice(0, 80) || source.name;
      source.url = rawUrl;
      source.user = user;
      source.root = root;
      source.allowPrivateNetwork = allowPrivateNetwork;
      source.syncEnabled = input.syncEnabled === undefined ? source.syncEnabled : input.syncEnabled === true;
      source.syncIntervalMinutes = Math.min(HUB_NC_MAX_SYNC_MINUTES, Math.max(HUB_NC_MIN_SYNC_MINUTES, Number(input.syncIntervalMinutes ?? source.syncIntervalMinutes) || 60));
      source.syncQuotaBytes = Math.max(1, Math.floor(Number(input.syncQuotaBytes ?? source.syncQuotaBytes) || HUB_NC_DEFAULT_QUOTA));
      source.syncMaxFileBytes = Math.max(1, Math.min(HUB_NC_DEFAULT_MAX_FILE, Math.floor(Number(input.syncMaxFileBytes ?? source.syncMaxFileBytes) || HUB_NC_DEFAULT_MAX_FILE)));
      source.syncFailures = 0;
      source.offlineUntil = null;
      source.nextSyncAt = source.syncEnabled ? Date.now() : null;
      source.updatedAt = Date.now();
      source.revision++;
      source.lastError = null;
    }
    if (typeof input.password === 'string' && input.password.trim()) this.app.secrets.set(source.secretRef, input.password.trim());
    if (!this.app.secrets.has(source.secretRef)) throw new AppError(400, 'no_password', 'Nextcloud-App-Passwort fehlt');
    this.saveHubState(state);
    await this.app.docs.flush();
    this.app.audit.write({ kind: 'musikhub', event: 'cloud_source_saved', actor: p.user.id, sourceId: source.id, owner: source.owner });
    return this.publicHubSource(source);
  }

  async deleteHubNextcloudSource(p: Principal, stationId: string, sourceId: string): Promise<void> {
    const source = this.hubSource(p, stationId, sourceId, true);
    const state = this.hubState();
    state.sources = state.sources.filter((x) => x.id !== sourceId);
    state.entries = state.entries.filter((x) => x.sourceId !== sourceId);
    state.jobs = state.jobs.filter((x) => x.sourceId !== sourceId);
    this.app.secrets.delete(source.secretRef);
    this.saveHubState(state);
    await this.app.docs.flush();
    this.app.audit.write({ kind: 'musikhub', event: 'cloud_source_deleted', actor: p.user?.id ?? p.id, sourceId });
  }

  hubNextcloudIndex(p: Principal, stationId: string, sourceId: string) {
    this.hubSource(p, stationId, sourceId, false);
    return this.hubState().entries.filter((x) => x.sourceId === sourceId).map((x) => ({ ...x }));
  }

  hubNextcloudRemoteState(sourceId: string, remotePath: string, modified: string | null, size: number) {
    const state = this.hubState();
    const source = state.sources.find((x) => x.id === sourceId);
    if (!source || source.lastScanAt === null) return { state: 'unknown' as const, checkedAt: source?.lastScanAt ?? null };
    const entry = state.entries.find((x) => x.sourceId === sourceId && x.path === remotePath);
    if (!entry) return { state: 'remote_missing' as const, checkedAt: source.lastScanAt };
    if (entry.size !== size || entry.modified !== modified) {
      return {
        state: 'remote_changed' as const,
        checkedAt: source.lastScanAt,
        remote: { size: entry.size, modified: entry.modified, name: entry.name },
      };
    }
    return { state: 'current' as const, checkedAt: source.lastScanAt };
  }

  hubNextcloudJobs(p: Principal, stationId: string) {
    this.stationContext(p, stationId);
    if (!hasScope(p, 'media:read')) throw new AppError(403, 'forbidden', 'Medien-Leserecht fehlt');
    const state = this.hubState();
    const allowed = new Set(state.sources.filter((source) => this.ownerAccess(p, source.owner)).map((source) => source.id));
    return state.jobs.filter((job) => allowed.has(job.sourceId)).map((job) => ({ ...job }));
  }

  async scanHubNextcloudSource(p: Principal, stationId: string, sourceId: string) {
    this.assertNoRunningJob(sourceId, 'scan');
    const source = this.hubSource(p, stationId, sourceId, true);
    const password = this.app.secrets.get(source.secretRef);
    if (!password) throw new AppError(409, 'no_password', 'Nextcloud-App-Passwort fehlt');
    const state = this.hubState();
    const job: HubNextcloudJob = { id: newId('ncjob'), sourceId, kind: 'scan', status: 'running', createdAt: Date.now(), updatedAt: Date.now(), files: 0, error: null };
    this.pushHubJob(state, job);
    this.saveHubState(state);
    await this.app.docs.flush();

    const client = new Nextcloud({ url: source.url, user: source.user, root: source.root }, password, this.hubFetch(source));
    const found: HubNextcloudEntry[] = [];
    const walk = async (path: string, depth: number): Promise<void> => {
      if (depth > HUB_NC_MAX_DEPTH || found.length >= HUB_NC_MAX_FILES) return;
      const entries = await this.ncCall(() => client.list(path));
      for (const entry of entries) {
        if (found.length >= HUB_NC_MAX_FILES) break;
        if (entry.dir) {
          if (depth < HUB_NC_MAX_DEPTH) await walk(entry.path, depth + 1);
          continue;
        }
        if (!AUDIO_FILE_RE.test(entry.name)) continue;
        found.push({
          sourceId,
          path: cleanPath(entry.path),
          name: entry.name,
          size: entry.size,
          type: entry.type,
          modified: entry.modified,
          indexedAt: Date.now(),
        });
      }
    };

    try {
      await walk(source.root, 0);
      state.entries = [...state.entries.filter((x) => x.sourceId !== sourceId), ...found];
      source.lastScanAt = Date.now();
      source.lastError = null;
      source.updatedAt = Date.now();
      job.status = 'done';
      job.files = found.length;
      job.updatedAt = Date.now();
      this.saveHubState(state);
      await this.app.docs.flush();
      this.app.audit.write({ kind: 'musikhub', event: 'cloud_scan_done', actor: p.user?.id ?? p.id, sourceId, files: found.length });
      return { ...job };
    } catch (err) {
      source.lastError = (err as Error).message.slice(0, 300);
      source.updatedAt = Date.now();
      job.status = 'failed';
      job.error = source.lastError;
      job.updatedAt = Date.now();
      this.saveHubState(state);
      await this.app.docs.flush();
      this.app.audit.write({ kind: 'musikhub', event: 'cloud_scan_failed', actor: p.user?.id ?? p.id, sourceId });
      throw err;
    }
  }

  async retrieveHubNextcloudEntry(p: Principal, stationId: string, sourceId: string, remotePathInput: string) {
    const remotePath = cleanPath(remotePathInput);
    this.assertNoRunningJob(sourceId, 'retrieve', remotePath);
    const source = this.hubSource(p, stationId, sourceId, true);
    const password = this.app.secrets.get(source.secretRef);
    if (!password) throw new AppError(409, 'no_password', 'Nextcloud-App-Passwort fehlt');
    const state = this.hubState();
    const entry = state.entries.find((x) => x.sourceId === sourceId && x.path === remotePath);
    if (!entry) throw new AppError(404, 'not_indexed', 'Datei ist nicht im aktuellen Cloud-Index');
    if (!AUDIO_FILE_RE.test(entry.name)) throw new AppError(415, 'unsupported_media', 'Indexeintrag ist keine unterstützte Audiodatei');
    if (entry.size > source.syncMaxFileBytes) throw new AppError(413, 'file_too_large', 'Datei überschreitet das Limit dieser Cloudquelle');
    const synced = this.app.svc.musikhub.nextcloudSyncState(sourceId);
    const previous = synced.get(remotePath);
    const usedBefore = [...synced.values()].reduce((sum, x) => sum + x.size, 0);
    if (usedBefore - (previous?.size ?? 0) + entry.size > source.syncQuotaBytes) {
      throw new AppError(413, 'quota_exceeded', 'Gesamtquote dieser Cloudquelle wäre überschritten');
    }

    const job: HubNextcloudJob = {
      id: newId('ncjob'), sourceId, kind: 'retrieve', status: 'running',
      createdAt: Date.now(), updatedAt: Date.now(), files: 0, path: remotePath, error: null,
    };
    this.pushHubJob(state, job);
    this.saveHubState(state);
    await this.app.docs.flush();

    const ext = extname(entry.name).toLowerCase();
    const file = `${newId('cloud')}${ext}`;
    const dir = join(this.app.dataDir, 'musikhub', 'cloud', sourceId);
    const target = join(dir, file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const client = new Nextcloud({ url: source.url, user: source.user, root: source.root }, password, this.hubFetch(source));

    try {
      const size = await this.ncCall(() => client.download(remotePath, target, source.syncMaxFileBytes));
      if (usedBefore - (previous?.size ?? 0) + size > source.syncQuotaBytes) {
        rmSync(target, { force: true });
        throw new AppError(413, 'quota_exceeded', 'Tatsächliche Dateigröße überschreitet die Gesamtquote dieser Cloudquelle');
      }
      const item = await this.app.svc.musikhub.registerNextcloudFile(p, stationId, {
        owner: source.owner,
        sourceId,
        remotePath,
        file,
        originalName: entry.name,
        contentType: entry.type || 'application/octet-stream',
        size,
        modified: entry.modified,
      });
      job.status = 'done';
      job.files = 1;
      job.itemId = item.id;
      job.updatedAt = Date.now();
      this.saveHubState(state);
      await this.app.docs.flush();
      this.app.audit.write({ kind: 'musikhub', event: 'cloud_retrieve_done', actor: p.user?.id ?? p.id, sourceId, itemId: item.id });
      return { job: { ...job }, item: { id: item.id, title: item.title, artist: item.artist, version: item.version, owner: item.owner } };
    } catch (err) {
      rmSync(target, { force: true });
      job.status = 'failed';
      job.error = (err as Error).message.slice(0, 300);
      job.updatedAt = Date.now();
      this.saveHubState(state);
      await this.app.docs.flush();
      this.app.audit.write({ kind: 'musikhub', event: 'cloud_retrieve_failed', actor: p.user?.id ?? p.id, sourceId });
      throw err;
    }
  }

  async syncHubNextcloudSource(p: Principal, stationId: string, sourceId: string, automatic = false) {
    this.assertNoRunningJob(sourceId, 'sync');
    const source = this.hubSource(p, stationId, sourceId, true);
    const start = Date.now();
    let state = this.hubState();
    const job: HubNextcloudJob = {
      id: newId('ncjob'), sourceId, kind: 'sync', status: 'running',
      createdAt: start, updatedAt: start, files: 0, error: null,
    };
    this.pushHubJob(state, job);
    this.saveHubState(state);
    await this.app.docs.flush();

    let imported = 0;
    let skippedUnchanged = 0;
    let skippedQuota = 0;
    let skippedTooLarge = 0;
    try {
      await this.scanHubNextcloudSource(p, stationId, sourceId);
      const entries = this.hubNextcloudIndex(p, stationId, sourceId) as HubNextcloudEntry[];
      const synced = this.app.svc.musikhub.nextcloudSyncState(sourceId);
      let usedBytes = [...synced.values()].reduce((sum, x) => sum + x.size, 0);

      for (const entry of entries) {
        const current = synced.get(entry.path);
        if (current && current.size === entry.size && current.modified === entry.modified) {
          skippedUnchanged++;
          continue;
        }
        if (entry.size > source.syncMaxFileBytes) {
          skippedTooLarge++;
          continue;
        }
        const projected = usedBytes - (current?.size ?? 0) + entry.size;
        if (projected > source.syncQuotaBytes) {
          skippedQuota++;
          continue;
        }
        await this.retrieveHubNextcloudEntry(p, stationId, sourceId, entry.path);
        usedBytes = projected;
        synced.set(entry.path, { modified: entry.modified, size: entry.size });
        imported++;
      }

      state = this.hubState();
      const liveSource = state.sources.find((x) => x.id === sourceId);
      const liveJob = state.jobs.find((x) => x.id === job.id);
      const now = Date.now();
      if (liveSource) {
        liveSource.lastSyncAt = now;
        liveSource.syncFailures = 0;
        liveSource.offlineUntil = null;
        liveSource.lastError = null;
        liveSource.nextSyncAt = liveSource.syncEnabled ? now + liveSource.syncIntervalMinutes * 60_000 : null;
        liveSource.updatedAt = now;
      }
      if (liveJob) {
        liveJob.status = 'done';
        liveJob.files = imported;
        liveJob.updatedAt = now;
        liveJob.error = skippedQuota || skippedTooLarge
          ? `${skippedQuota} wegen Quote, ${skippedTooLarge} wegen Dateigröße übersprungen`
          : null;
      }
      state.jobs = state.jobs.slice(-HUB_NC_MAX_JOBS);
      this.saveHubState(state);
      await this.app.docs.flush();
      this.app.audit.write({
        kind: 'musikhub', event: 'cloud_sync_done', actor: p.user?.id ?? p.id, sourceId,
        imported, skippedUnchanged, skippedQuota, skippedTooLarge, automatic,
      });
      return { imported, skippedUnchanged, skippedQuota, skippedTooLarge, usedBytes, quotaBytes: source.syncQuotaBytes };
    } catch (err) {
      state = this.hubState();
      const liveSource = state.sources.find((x) => x.id === sourceId);
      const liveJob = state.jobs.find((x) => x.id === job.id);
      const now = Date.now();
      const message = (err as Error).message.slice(0, 300);
      if (liveSource) {
        liveSource.syncFailures = Math.min(10, (liveSource.syncFailures ?? 0) + 1);
        const backoffMs = Math.min(60 * 60_000, Math.pow(2, liveSource.syncFailures - 1) * 60_000);
        liveSource.offlineUntil = now + backoffMs;
        liveSource.nextSyncAt = now + backoffMs;
        liveSource.lastError = message;
        liveSource.updatedAt = now;
      }
      if (liveJob) {
        liveJob.status = 'failed';
        liveJob.error = message;
        liveJob.updatedAt = now;
      }
      state.jobs = state.jobs.slice(-HUB_NC_MAX_JOBS);
      this.saveHubState(state);
      await this.app.docs.flush();
      this.app.audit.write({ kind: 'musikhub', event: 'cloud_sync_failed', actor: p.user?.id ?? p.id, sourceId, automatic });
      throw err;
    }
  }

  async tickHubNextcloudSync(now = Date.now()): Promise<void> {
    if (this.syncRunning) return;
    this.syncRunning = true;
    try {
      const due = this.hubState().sources
        .filter((source) => source.syncEnabled && (source.offlineUntil === null || source.offlineUntil <= now) && (source.nextSyncAt === null || source.nextSyncAt <= now))
        .sort((a, b) => (a.nextSyncAt ?? 0) - (b.nextSyncAt ?? 0))
        .slice(0, 2);
      for (const source of due) {
        try {
          const p = this.backgroundPrincipal(source);
          const stationId = this.contextStation(source);
          await this.syncHubNextcloudSource(p, stationId, source.id, true);
        } catch (err) {
          const state = this.hubState();
          const live = state.sources.find((x) => x.id === source.id);
          if (live && !live.lastError) {
            live.syncFailures = Math.min(10, (live.syncFailures ?? 0) + 1);
            const backoffMs = Math.min(60 * 60_000, Math.pow(2, live.syncFailures - 1) * 60_000);
            live.offlineUntil = now + backoffMs;
            live.nextSyncAt = now + backoffMs;
            live.lastError = (err as Error).message.slice(0, 300);
            live.updatedAt = now;
            this.saveHubState(state);
            await this.app.docs.flush();
          }
        }
      }
    } finally {
      this.syncRunning = false;
    }
  }

  nextcloudConfig(): (NextcloudConfig & { hasPassword: boolean }) | { configured: false } {
    const c = this.app.docs.get<NextcloudConfig | null>('nextcloud', null);
    return c ? { ...c, hasPassword: this.app.secrets.has('nextcloud:password') } : { configured: false };
  }

  setNextcloud(input: Record<string, unknown>): unknown {
    if (input.remove === true) {
      // Einstellung liegt in der Datenbank (vorher nextcloud.json – das Löschen der Datei wirkte nicht mehr)
      this.app.docs.set('nextcloud', null);
      this.app.secrets.delete('nextcloud:password');
      return { configured: false };
    }
    const url = String(input.url ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+/.test(url)) throw new AppError(400, 'invalid_url', 'Nextcloud-Adresse mit https:// angeben');
    const user = String(input.user ?? '').trim();
    if (!user) throw new AppError(400, 'invalid_user', 'Benutzername fehlt');
    let root: string;
    try {
      root = cleanPath(String(input.root ?? '/'));
    } catch {
      throw new AppError(400, 'invalid_path', 'Ungültiger Startordner');
    }
    if (typeof input.password === 'string' && input.password) this.app.secrets.set('nextcloud:password', input.password.trim());
    if (!this.app.secrets.has('nextcloud:password')) throw new AppError(400, 'no_password', 'App-Passwort fehlt (Nextcloud → Einstellungen → Sicherheit → App-Passwort)');
    this.app.docs.set('nextcloud', { url, user, root });
    this.app.audit.write({ kind: 'nextcloud', event: 'config', url, user });
    return this.nextcloudConfig();
  }

  nc(): { client: Nextcloud; root: string } {
    const c = this.app.docs.get<NextcloudConfig | null>('nextcloud', null);
    const pw = this.app.secrets.get('nextcloud:password');
    if (!c || !pw) throw new AppError(409, 'not_configured', 'Nextcloud ist noch nicht eingerichtet');
    return { client: new Nextcloud(c, pw), root: c.root };
  }

  ncCall<T>(fn: () => Promise<T>): Promise<T> {
    return fn().catch((err) => {
      if (err instanceof NextcloudError) throw new AppError(err.status === 401 ? 502 : err.status, 'nextcloud', err.message);
      throw err;
    });
  }

  /** Ordner in der Nextcloud (relativ zum Startordner). */
  async nextcloudList(path: string): Promise<unknown> {
    const { client, root } = this.nc();
    const rel = cleanPath(path);
    const entries = await this.ncCall(() => client.list(cleanPath(`${root}/${rel}`)));
    return {
      path: rel,
      entries: entries.map((e) => ({ ...e, path: cleanPath(e.path.slice(root === '/' ? 0 : root.length)), audio: !e.dir && AUDIO_FILE_RE.test(e.name) })),
    };
  }

  /** Dateien/Ordner (rekursiv, max. 500 Dateien) in die Bibliothek übernehmen. */
  async nextcloudImport(stationId: string, paths: string[], opts: { category?: string; folder?: string }): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const { client, root } = this.nc();
    const rt = this.app.rt(stationId);
    const category = (MEDIA_CATEGORIES as readonly string[]).includes(String(opts.category)) ? (opts.category as MediaItem['category']) : 'music';
    const files: { path: string; name: string; folder: string }[] = [];
    const walk = async (rel: string, folder: string, depth: number): Promise<void> => {
      const list = await this.ncCall(() => client.list(cleanPath(`${root}/${rel}`)));
      for (const e of list) {
        if (files.length >= 500) return;
        const r = cleanPath(`${rel}/${e.name}`);
        if (e.dir && depth < 4) await walk(r, folder ? `${folder} / ${e.name}` : e.name, depth + 1);
        else if (!e.dir && AUDIO_FILE_RE.test(e.name)) files.push({ path: r, name: e.name, folder });
      }
    };
    for (const p of paths.slice(0, 200)) {
      const rel = cleanPath(p);
      const name = rel.split('/').pop() ?? '';
      if (AUDIO_FILE_RE.test(name)) files.push({ path: rel, name, folder: opts.folder ?? '' });
      else await walk(rel, opts.folder || name, 0);
    }
    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;
    for (const f of files) {
      // bereits übernommene Datei (gleicher Nextcloud-Pfad) nicht doppelt laden
      if (rt.data.library.some((m) => m.source === `nextcloud:${f.path}`)) {
        skipped++;
        continue;
      }
      const id = newId('m');
      const ext = extname(f.name).toLowerCase();
      const file = `${id}${ext}`;
      try {
        await this.ncCall(() => client.download(cleanPath(`${root}/${f.path}`), join(this.app.mediaDir, stationId, file), 500 * 1024 * 1024));
        const meta = parseFileName(f.name);
        this.app.svc.media.addMedia(stationId, { id, title: meta.title || f.name, artist: meta.artist, category, file, durationMs: null, addedAt: Date.now(), folder: f.folder.slice(0, 80) || undefined, originalName: f.name, source: `nextcloud:${f.path}` });
        imported++;
      } catch (err) {
        errors.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    this.app.audit.write({ kind: 'nextcloud', event: 'import', stationId, imported, skipped, errors: errors.length });
    return { imported, skipped, errors: errors.slice(0, 20) };
  }

  /** Mitschnitt in die Nextcloud hochladen. */
  async nextcloudUploadRecording(stationId: string, recId: string, targetDir: string): Promise<unknown> {
    const { client, root } = this.nc();
    const { path, rec } = this.app.svc.recorder.recordingFile(stationId, recId);
    const ext = rec.contentType.includes('ogg') ? 'ogg' : rec.contentType.includes('aac') ? 'aac' : rec.contentType.includes('webm') ? 'webm' : 'mp3';
    const name = `${new Date(rec.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')} ${rec.label}`.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    const target = cleanPath(`${root}/${targetDir || 'AirDeck-Mitschnitte'}/${name}.${ext}`);
    await this.ncCall(() => client.upload(path, target, rec.contentType));
    this.app.audit.write({ kind: 'nextcloud', event: 'upload', stationId, recId });
    return { uploaded: target };
  }
}
