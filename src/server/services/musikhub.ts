// Geschlossener MusikHub-Katalog. Ein Eintrag ist zunächst nur eine Referenz auf
// ein vorhandenes Sendermedium; Dateiabruf und Sendebereitstellung folgen in
// eigenen, erneut autorisierten Phasen.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join } from 'node:path';
import { parseFileName } from '../../core/automation.ts';
import type { AirDeckApp } from '../app.ts';
import { AppError, canSee, newId, type Principal } from '../model.ts';
import { UserStore } from '../users.ts';
import type { MediaItem } from '../../core/automation.ts';

export const HUB_ACTIONS = [
  'catalog.read', 'preview.play', 'broadcast.use', 'file.download', 'media.upload',
  'metadata.edit', 'source.write', 'transfer.export', 'shares.manage', 'media.delete',
] as const;
export type HubAction = typeof HUB_ACTIONS[number];
export type HubSubject = { kind: 'user' | 'station'; id: string };
export type HubResource = { kind: 'item' | 'collection'; id: string };
export type HubItemSource =
  | { kind?: 'station'; stationId: string; mediaId: string }
  | { kind: 'personal'; file: string; originalName: string; contentType: string; size: number };

export interface HubItem {
  id: string;
  owner: HubSubject;
  source: HubItemSource;
  title: string;
  artist: string;
  version: string | null;
  createdAt: number;
  revision: number;
}
export interface HubCollection {
  id: string;
  owner: HubSubject;
  name: string;
  itemIds: string[];
  createdAt: number;
  revision: number;
}
export interface HubGrant {
  id: string;
  resource: HubResource;
  recipient: HubSubject;
  actions: HubAction[];
  targetStationIds: string[];
  startsAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdBy: string;
  createdAt: number;
  revision: number;
}
interface HubState { version: 1; items: HubItem[]; collections: HubCollection[]; grants: HubGrant[] }

const READ_ACTIONS = new Set<HubAction>(['catalog.read', 'preview.play', 'file.download']);
const BROADCAST_ACTIONS = new Set<HubAction>(['broadcast.use']);
const MAX_COLLECTION_ITEMS = 5000;
const MAX_PERSONAL_UPLOAD = 300 * 1024 * 1024;
const hasScope = (p: Principal, scope: string) => p.scopes.includes('*') || p.scopes.includes(scope);
const validAction = (value: unknown): value is HubAction => typeof value === 'string' && (HUB_ACTIONS as readonly string[]).includes(value);
const same = (a: HubSubject, b: HubSubject) => a.kind === b.kind && a.id === b.id;

export class MusicHubService {
  private readonly app: AirDeckApp;
  private loaded: HubState | null = null;

  constructor(app: AirDeckApp) { this.app = app; }

  private personalDir(userId: string): string {
    return join(this.app.dataDir, 'musikhub', 'personal', userId);
  }

  private get state(): HubState {
    return (this.loaded ??= this.app.docs.get<HubState>('musikhub', { version: 1, items: [], collections: [], grants: [] }));
  }

  private async save(): Promise<void> {
    this.app.docs.set('musikhub', this.state);
    await this.app.docs.flush();
  }

  private actor(p: Principal): string {
    if (p.user) {
      const user = this.app.users.get(p.user.id);
      if (!user || user.disabled) throw new AppError(403, 'forbidden', 'Benutzerkonto nicht aktiv');
    }
    return p.user?.id ?? p.id;
  }

  private station(p: Principal, id: string): void {
    if (!this.app.stations.has(id) || !canSee(p, id)) throw new AppError(404, 'not_found', 'Sender nicht gefunden');
  }

  private subject(input: unknown): HubSubject {
    if (!input || typeof input !== 'object') throw new AppError(400, 'invalid_subject', 'Empfänger fehlt');
    const v = input as Record<string, unknown>;
    if ((v.kind !== 'user' && v.kind !== 'station') || typeof v.id !== 'string' || !v.id) throw new AppError(400, 'invalid_subject', 'Ungültiger Empfänger');
    if (v.kind === 'station' && !this.app.stations.has(v.id)) throw new AppError(400, 'invalid_subject', 'Empfängersender existiert nicht');
    if (v.kind === 'user' && !this.app.users.get(v.id)) throw new AppError(400, 'invalid_subject', 'Empfängerbenutzer existiert nicht');
    return { kind: v.kind, id: v.id };
  }

  private resource(input: HubResource): HubItem | HubCollection {
    const rec = input.kind === 'item' ? this.state.items.find((x) => x.id === input.id) : this.state.collections.find((x) => x.id === input.id);
    if (!rec) throw new AppError(404, 'not_found', 'MusikHub-Eintrag nicht gefunden');
    return rec;
  }

  private roleAllows(p: Principal, action: HubAction): boolean {
    if (READ_ACTIONS.has(action)) return hasScope(p, 'media:read');
    if (BROADCAST_ACTIONS.has(action)) return hasScope(p, 'media:read') && (hasScope(p, 'queue:write') || hasScope(p, 'automation:write'));
    return hasScope(p, 'media:write');
  }

  private ownerAccess(p: Principal, owner: HubSubject): boolean {
    return owner.kind === 'user' ? p.user?.id === owner.id : this.explicitMember(p, owner.id);
  }

  // Das Legacy-"*" bedeutet Plattformverwaltung, nicht Einsicht in jedes
  // private Senderarchiv. MusikHub-Inhalte verlangen eine konkrete Mitgliedschaft.
  private explicitMember(p: Principal, stationId: string): boolean {
    if (!p.user) return false;
    const user = this.app.users.get(p.user.id);
    return !!user && !user.disabled && user.stationIds.includes(stationId);
  }

  private grantApplies(p: Principal, grant: HubGrant, stationId: string, now: number): boolean {
    if (grant.revokedAt !== null || grant.startsAt !== null && now < grant.startsAt || grant.expiresAt !== null && now >= grant.expiresAt) return false;
    if (!grant.targetStationIds.includes(stationId)) return false;
    if (grant.recipient.kind === 'user') return p.user?.id === grant.recipient.id;
    return grant.recipient.id === stationId && this.explicitMember(p, stationId);
  }

  /** Alle Pfade werden bei jedem Aufruf neu bewertet; es gibt keinen Rechte-Cache. */
  actions(p: Principal, resource: HubResource, stationId: string): HubAction[] {
    this.actor(p);
    this.station(p, stationId);
    const rec = this.resource(resource);
    const allowed = new Set<HubAction>();
    if (this.ownerAccess(p, rec.owner) && (rec.owner.kind === 'user' || rec.owner.id === stationId)) {
      for (const action of HUB_ACTIONS) allowed.add(action);
    }
    const related: HubResource[] = [resource];
    if (resource.kind === 'item') for (const c of this.state.collections) if (c.itemIds.includes(resource.id)) related.push({ kind: 'collection', id: c.id });
    const now = Date.now();
    for (const grant of this.state.grants) {
      if (related.some((x) => x.kind === grant.resource.kind && x.id === grant.resource.id) && this.grantApplies(p, grant, stationId, now)) {
        for (const action of grant.actions) allowed.add(action);
      }
    }
    return HUB_ACTIONS.filter((action) => allowed.has(action) && this.roleAllows(p, action));
  }

  private require(p: Principal, resource: HubResource, stationId: string, action: HubAction): void {
    if (!this.actions(p, resource, stationId).includes(action)) throw new AppError(404, 'not_found', 'MusikHub-Eintrag nicht gefunden');
  }

  private queuedRef(itemId: string, userId: string): string {
    return `__hub__:${itemId}:${userId}`;
  }

  private queuedParts(mediaId: string): { itemId: string; userId: string } | null {
    if (!mediaId.startsWith('__hub__:')) return null;
    const rest = mediaId.slice('__hub__:'.length);
    const split = rest.lastIndexOf(':');
    if (split <= 0 || split === rest.length - 1) return null;
    return { itemId: rest.slice(0, split), userId: rest.slice(split + 1) };
  }

  isQueuedBroadcastRef(mediaId: string): boolean {
    return this.queuedParts(mediaId) !== null;
  }

  queueBroadcast(p: Principal, itemId: string, stationId: string): string {
    this.require(p, { kind: 'item', id: itemId }, stationId, 'broadcast.use');
    if (!p.user) throw new AppError(403, 'forbidden', 'MusicHub-Sendeberechtigung benötigt ein Benutzerkonto');
    return this.queuedRef(itemId, p.user.id);
  }

  private principalForQueuedUser(userId: string): Principal {
    const user = this.app.users.get(userId);
    if (!user || user.disabled) throw new AppError(404, 'not_found', 'MusicHub-Sendeberechtigung nicht mehr gültig');
    return {
      id: user.id,
      tokenId: `musikhub-queue:${user.id}`,
      roles: user.roles,
      stationIds: user.stationIds,
      scopes: UserStore.scopesFor(user.roles),
      user: { id: user.id, username: user.username, name: user.name },
    };
  }

  resolveQueuedBroadcast(mediaId: string, stationId: string): MediaItem {
    const parts = this.queuedParts(mediaId);
    if (!parts) throw new AppError(404, 'not_found', 'Kein MusicHub-Queueeintrag');
    const p = this.principalForQueuedUser(parts.userId);
    this.require(p, { kind: 'item', id: parts.itemId }, stationId, 'broadcast.use');
    const item = this.resource({ kind: 'item', id: parts.itemId }) as HubItem;
    if (item.source.kind === 'personal') {
      return {
        id: `musikhub:${item.id}`,
        title: item.title,
        artist: item.artist,
        category: 'music',
        file: item.source.originalName,
        originalName: item.source.originalName,
        durationMs: null,
        addedAt: item.createdAt,
        linkedPath: join(this.personalDir(item.owner.id), item.source.file),
        source: `musikhub:${item.id}`,
      };
    }
    const source = this.app.svc.media.media(item.source.stationId, item.source.mediaId);
    if (source.url) throw new AppError(409, 'invalid_source', 'Stream-URLs können nicht über MusicHub-Broadcast verwendet werden');
    return {
      ...source,
      id: `musikhub:${item.id}`,
      title: item.title,
      artist: item.artist,
      file: source.originalName || source.file,
      linkedPath: this.app.svc.media.mediaPath(item.source.stationId, source),
      source: `musikhub:${item.id}`,
      addedAt: item.createdAt,
    };
  }

  queuedBroadcastView(p: Principal, mediaId: string, stationId: string): MediaItem | null {
    const parts = this.queuedParts(mediaId);
    if (!parts) return null;
    try {
      this.require(p, { kind: 'item', id: parts.itemId }, stationId, 'catalog.read');
      const item = this.resource({ kind: 'item', id: parts.itemId }) as HubItem;
      return {
        id: mediaId,
        title: item.title,
        artist: item.artist,
        category: 'music',
        file: '',
        durationMs: null,
        addedAt: item.createdAt,
        source: `musikhub:${item.id}`,
      };
    } catch {
      return null;
    }
  }

  resolveAudioFile(p: Principal, itemId: string, stationId: string, action: 'preview.play' | 'file.download') {
    this.require(p, { kind: 'item', id: itemId }, stationId, action);
    const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
    if (item.source.kind === 'personal') {
      return {
        path: join(this.personalDir(item.owner.id), item.source.file),
        name: item.source.originalName,
        contentType: item.source.contentType,
      };
    }
    const media = this.app.svc.media.media(item.source.stationId, item.source.mediaId);
    if (media.url) throw new AppError(409, 'invalid_source', 'Stream-URLs können nicht über den MusikHub abgerufen werden');
    return {
      path: this.app.svc.media.mediaPath(item.source.stationId, media),
      name: media.originalName || media.file,
      contentType: null,
    };
  }

  preparePersonalUpload(p: Principal, stationId: string, originalNameInput: string, contentType: string) {
    this.actor(p);
    this.station(p, stationId);
    if (!p.user || !hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Persönlicher Upload benötigt ein Benutzerkonto mit Medien-Schreibrecht');
    const originalName = originalNameInput.replace(/^.*[\\/]/, '').trim().slice(0, 200);
    const ext = extname(originalName).toLowerCase();
    if (!originalName || !ext) throw new AppError(400, 'invalid_name', 'Dateiname fehlt');
    const id = newId('hub');
    const file = `${id}${ext}`;
    const dir = this.personalDir(p.user.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { id, userId: p.user.id, originalName, contentType, file, path: join(dir, file), maxBytes: MAX_PERSONAL_UPLOAD };
  }

  discardPersonalUpload(draft: { path: string }): void {
    rmSync(draft.path, { force: true });
  }

  async commitPersonalUpload(
    p: Principal,
    stationId: string,
    draft: { id: string; userId: string; originalName: string; contentType: string; file: string },
    size: number,
  ): Promise<unknown> {
    this.actor(p);
    this.station(p, stationId);
    if (!p.user || p.user.id !== draft.userId || !hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Upload-Eigentümer stimmt nicht');
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PERSONAL_UPLOAD) throw new AppError(400, 'invalid_size', 'Ungültige Dateigröße');
    const meta = parseFileName(draft.originalName);
    const item: HubItem = {
      id: draft.id,
      owner: { kind: 'user', id: p.user.id },
      source: { kind: 'personal', file: draft.file, originalName: draft.originalName, contentType: draft.contentType, size },
      title: meta.title || draft.originalName,
      artist: meta.artist,
      version: null,
      createdAt: Date.now(),
      revision: 1,
    };
    this.state.items.push(item);
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'personal_uploaded', actor: this.actor(p), itemId: item.id, size });
    return {
      id: item.id,
      owner: item.owner,
      source: { kind: 'personal', originalName: draft.originalName, contentType: draft.contentType, size },
      title: item.title,
      artist: item.artist,
      version: item.version,
      createdAt: item.createdAt,
      revision: item.revision,
    };
  }

  async updateItemMetadata(
    p: Principal,
    itemId: string,
    stationId: string,
    input: Record<string, unknown>,
  ): Promise<HubItem> {
    this.require(p, { kind: 'item', id: itemId }, stationId, 'metadata.edit');
    const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
    if (!this.ownerAccess(p, item.owner)) throw new AppError(403, 'forbidden', 'Nur Eigentümer können Metadaten ändern');
    const revision = Number(input.revision);
    if (!Number.isInteger(revision) || revision !== item.revision) throw new AppError(409, 'revision_conflict', 'Titel wurde inzwischen geändert');
    const title = String(input.title ?? item.title).trim().slice(0, 200);
    const artist = String(input.artist ?? item.artist).trim().slice(0, 200);
    const versionText = String(input.version ?? '').trim().slice(0, 120);
    if (!title) throw new AppError(400, 'invalid_title', 'Titel darf nicht leer sein');
    item.title = title;
    item.artist = artist;
    item.version = versionText || null;
    item.revision++;
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'metadata_changed', actor: this.actor(p), itemId, revision: item.revision });
    return item;
  }

  async coverFile(p: Principal, itemId: string, stationId: string): Promise<string | null> {
    this.require(p, { kind: 'item', id: itemId }, stationId, 'catalog.read');
    const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
    if (item.source.kind !== 'personal') return this.app.svc.media.cover(item.source.stationId, item.source.mediaId);
    if (!this.app.ffmpeg) return null;
    const dir = join(this.app.dataDir, 'covers', 'musikhub', item.owner.id);
    const file = join(dir, `${item.id}.jpg`);
    const none = `${file}.none`;
    if (existsSync(file)) return file;
    if (existsSync(none)) return null;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const audio = join(this.personalDir(item.owner.id), item.source.file);
    const ok = await new Promise<boolean>((resolve) => {
      const proc = spawn(this.app.ffmpeg!.ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', audio, '-an', '-frames:v', '1',
        '-vf', 'scale=300:300:force_original_aspect_ratio=increase,crop=300:300', file,
      ], { windowsHide: true });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0 && existsSync(file)));
      setTimeout(() => proc.kill(), 15_000).unref();
    });
    if (!ok) {
      rmSync(file, { force: true });
      writeFileSync(none, '');
      return null;
    }
    return file;
  }

  async deleteItem(p: Principal, itemId: string, stationId: string): Promise<void> {
    this.require(p, { kind: 'item', id: itemId }, stationId, 'media.delete');
    const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
    if (!this.ownerAccess(p, item.owner)) throw new AppError(403, 'forbidden', 'Nur Eigentümer können MusikHub-Medien löschen');
    if (item.source.kind === 'personal') {
      rmSync(join(this.personalDir(item.owner.id), item.source.file), { force: true });
      rmSync(join(this.app.dataDir, 'covers', 'musikhub', item.owner.id, `${item.id}.jpg`), { force: true });
      rmSync(join(this.app.dataDir, 'covers', 'musikhub', item.owner.id, `${item.id}.jpg.none`), { force: true });
    }
    this.state.items = this.state.items.filter((x) => x.id !== itemId);
    for (const collection of this.state.collections) {
      if (collection.itemIds.includes(itemId)) {
        collection.itemIds = collection.itemIds.filter((id) => id !== itemId);
        collection.revision++;
      }
    }
    this.state.grants = this.state.grants.filter((g) => !(g.resource.kind === 'item' && g.resource.id === itemId));
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'item_deleted', actor: this.actor(p), itemId });
  }

  listItems(p: Principal, stationId: string, search = '', offset = 0, limit = 50) {
    this.station(p, stationId);
    const q = search.trim().toLocaleLowerCase().slice(0, 100);
    const filtered = this.state.items.filter((item) => {
      if (q && !`${item.artist} ${item.title} ${item.version ?? ''}`.toLocaleLowerCase().includes(q)) return false;
      return this.actions(p, { kind: 'item', id: item.id }, stationId).includes('catalog.read');
    });
    const start = Math.max(0, Math.floor(offset) || 0);
    const count = Math.min(100, Math.max(1, Math.floor(limit) || 50));
    return {
      total: filtered.length,
      items: filtered.slice(start, start + count).map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        version: item.version,
        revision: item.revision,
        owner: item.owner,
        ...(this.ownerAccess(p, item.owner)
          ? { source: item.source.kind === 'personal'
            ? { kind: 'personal', originalName: item.source.originalName, contentType: item.source.contentType, size: item.source.size }
            : item.source }
          : {}),
        actions: this.actions(p, { kind: 'item', id: item.id }, stationId),
      })),
      nextOffset: start + count < filtered.length ? start + count : null,
    };
  }

  async registerStationMedia(p: Principal, stationId: string, mediaId: string): Promise<HubItem> {
    this.actor(p);
    this.station(p, stationId);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    if (!this.explicitMember(p, stationId)) throw new AppError(403, 'forbidden', 'Ausdrückliche Senderzuordnung erforderlich');
    const media = this.app.svc.media.media(stationId, mediaId);
    if (media.url) throw new AppError(400, 'invalid_source', 'URL-Streams sind keine Archivdateien');
    const existing = this.state.items.find((x) => x.source.kind !== 'personal' && x.source.stationId === stationId && x.source.mediaId === mediaId);
    if (existing) return existing;
    const item: HubItem = { id: newId('hub'), owner: { kind: 'station', id: stationId }, source: { kind: 'station', stationId, mediaId }, title: media.title, artist: media.artist, version: null, createdAt: Date.now(), revision: 1 };
    this.state.items.push(item);
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'item_registered', actor: this.actor(p), stationId, itemId: item.id });
    return item;
  }

  listCollections(p: Principal, stationId: string) {
    this.station(p, stationId);
    return this.state.collections.filter((c) => this.actions(p, { kind: 'collection', id: c.id }, stationId).includes('catalog.read'))
      .map((c) => ({ ...c, itemIds: c.itemIds.filter((id) => this.actions(p, { kind: 'item', id }, stationId).includes('catalog.read')), actions: this.actions(p, { kind: 'collection', id: c.id }, stationId) }));
  }

  async createCollection(p: Principal, ownerInput: unknown, nameInput: unknown): Promise<HubCollection> {
    this.actor(p);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    const owner = this.subject(ownerInput);
    if (!this.ownerAccess(p, owner)) throw new AppError(403, 'forbidden', 'Fremdes Eigentum');
    if (owner.kind === 'station') this.station(p, owner.id);
    const name = String(nameInput ?? '').trim().slice(0, 100);
    if (!name) throw new AppError(400, 'invalid_name', 'Sammlungsname fehlt');
    const collection: HubCollection = { id: newId('col'), owner, name, itemIds: [], createdAt: Date.now(), revision: 1 };
    this.state.collections.push(collection);
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'collection_created', actor: this.actor(p), collectionId: collection.id });
    return collection;
  }

  async setCollectionItems(p: Principal, id: string, itemIdsInput: unknown, revision: unknown, stationId: string): Promise<HubCollection> {
    this.require(p, { kind: 'collection', id }, stationId, 'media.upload');
    const collection = this.resource({ kind: 'collection', id }) as HubCollection;
    if (!this.ownerAccess(p, collection.owner)) throw new AppError(403, 'forbidden', 'Nur Eigentümer können Mitglieder ändern');
    if (revision !== collection.revision) throw new AppError(409, 'revision_conflict', 'Sammlung wurde inzwischen geändert');
    if (!Array.isArray(itemIdsInput) || itemIdsInput.length > MAX_COLLECTION_ITEMS || itemIdsInput.some((x) => typeof x !== 'string')) throw new AppError(400, 'invalid_items', 'Ungültige Titelliste');
    const itemIds = [...new Set(itemIdsInput as string[])];
    for (const itemId of itemIds) {
      const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
      if (!same(item.owner, collection.owner)) throw new AppError(403, 'forbidden', 'Sammlung und Titel brauchen denselben Eigentümer');
    }
    collection.itemIds = itemIds;
    collection.revision++;
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'collection_items_changed', actor: this.actor(p), collectionId: id, count: itemIds.length });
    return collection;
  }

  listGrants(p: Principal, resource: HubResource, stationId: string): HubGrant[] {
    this.require(p, resource, stationId, 'shares.manage');
    return this.state.grants.filter((g) => g.resource.kind === resource.kind && g.resource.id === resource.id);
  }

  recipients(p: Principal, query: string) {
    this.actor(p);
    if (!p.user || !hasScope(p, 'media:write') || !this.app.users.get(p.user.id)?.stationIds.some((id) => id !== '*' && this.app.stations.has(id))) {
      throw new AppError(403, 'forbidden', 'Keine MusikHub-Freigaberechte');
    }
    const q = query.trim().toLocaleLowerCase().slice(0, 100);
    const users = q.length < 2 ? [] : this.app.users.list().filter((u) => !u.disabled && `${u.name} ${u.username}`.toLocaleLowerCase().includes(q)).slice(0, 20).map((u) => ({ id: u.id, name: u.name, username: u.username }));
    const stations = [...this.app.stations.values()].map((rt) => rt.station).filter((s) => !q || `${s.id} ${s.name}`.toLocaleLowerCase().includes(q)).slice(0, 100).map((s) => ({ id: s.id, name: s.name }));
    return { users, stations };
  }

  async createGrant(p: Principal, resource: HubResource, recipientInput: unknown, actionsInput: unknown, targetsInput: unknown, stationId: string, expiresAtInput?: unknown): Promise<HubGrant> {
    this.require(p, resource, stationId, 'shares.manage');
    const recipient = this.subject(recipientInput);
    if (!Array.isArray(actionsInput) || !actionsInput.length || actionsInput.some((x) => !validAction(x))) throw new AppError(400, 'invalid_actions', 'Ungültige Freigaberechte');
    const actions = [...new Set(actionsInput as HubAction[])];
    if (!Array.isArray(targetsInput) || !targetsInput.length || targetsInput.length > 100 || targetsInput.some((x) => typeof x !== 'string' || !this.app.stations.has(x))) throw new AppError(400, 'invalid_targets', 'Zielsender fehlen oder sind ungültig');
    const targetStationIds = [...new Set(targetsInput as string[])];
    if (recipient.kind === 'station' && (targetStationIds.length !== 1 || targetStationIds[0] !== recipient.id)) throw new AppError(400, 'invalid_targets', 'Senderfreigabe muss auf genau diesen Sender begrenzt sein');
    const rec = this.resource(resource);
    if (!this.ownerAccess(p, rec.owner)) {
      for (const target of targetStationIds) {
        const held = this.actions(p, resource, target);
        if (actions.some((a) => !held.includes(a))) throw new AppError(403, 'forbidden', 'Freigabe überschreitet delegierte Rechte');
      }
    }
    const expiresAt = expiresAtInput === undefined || expiresAtInput === null ? null : Number(expiresAtInput);
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) throw new AppError(400, 'invalid_expiry', 'Ablaufzeit muss in der Zukunft liegen');
    const grant: HubGrant = { id: newId('grant'), resource, recipient, actions, targetStationIds, startsAt: null, expiresAt, revokedAt: null, createdBy: this.actor(p), createdAt: Date.now(), revision: 1 };
    this.state.grants.push(grant);
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'grant_created', actor: this.actor(p), grantId: grant.id, resourceId: resource.id, recipientKind: recipient.kind, recipientId: recipient.id });
    return grant;
  }

  async revokeGrant(p: Principal, id: string, stationId: string): Promise<void> {
    const grant = this.state.grants.find((g) => g.id === id);
    if (!grant) throw new AppError(404, 'not_found', 'Freigabe nicht gefunden');
    this.require(p, grant.resource, stationId, 'shares.manage');
    if (grant.createdBy !== this.actor(p) && !this.ownerAccess(p, this.resource(grant.resource).owner)) throw new AppError(403, 'forbidden', 'Nur Ersteller oder Eigentümer können widerrufen');
    if (grant.revokedAt !== null) return;
    grant.revokedAt = Date.now();
    grant.revision++;
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'grant_revoked', actor: this.actor(p), grantId: id });
  }
}
