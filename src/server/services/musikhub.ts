// Geschlossener MusikHub-Katalog. Ein Eintrag ist zunächst nur eine Referenz auf
// ein vorhandenes Sendermedium; Dateiabruf und Sendebereitstellung folgen in
// eigenen, erneut autorisierten Phasen.

import type { AirDeckApp } from '../app.ts';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, canSee, newId, type Principal } from '../model.ts';
import { writeFileAtomic } from '../store.ts';

export const HUB_ACTIONS = [
  'catalog.read', 'preview.play', 'broadcast.use', 'file.download', 'media.upload',
  'metadata.edit', 'source.write', 'transfer.export', 'shares.manage', 'media.delete',
] as const;
export type HubAction = typeof HUB_ACTIONS[number];
export type HubSubject = { kind: 'user' | 'station'; id: string };
export type HubResource = { kind: 'item' | 'collection'; id: string };
/**
 * Zwei Herkunftsarten: eine bereits vorhandene, sendergebundene Mediendatei (registriert, nicht
 * verschoben) oder eine eigenständig hochgeladene private Datei (liegt unter dataDir/musikhub/
 * uploads/<Eigentümer-Nutzer-ID>/, außerhalb jedes Senderarchivs).
 */
export type HubSource =
  | { kind: 'station'; stationId: string; mediaId: string }
  | { kind: 'upload'; file: string; mimeType: string; sizeBytes: number };
export interface HubItem {
  id: string;
  owner: HubSubject;
  source: HubSource;
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
/** Gesamtkontingent privater Uploads je Nutzerkonto (nicht je Datei) - schützt Plattenspeicher vor unbegrenztem persönlichem Archiv. */
export const MAX_USER_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const hasScope = (p: Principal, scope: string) => p.scopes.includes('*') || p.scopes.includes(scope);
const validAction = (value: unknown): value is HubAction => typeof value === 'string' && (HUB_ACTIONS as readonly string[]).includes(value);
const same = (a: HubSubject, b: HubSubject) => a.kind === b.kind && a.id === b.id;

export class MusicHubService {
  private readonly app: AirDeckApp;
  private loaded: HubState | null = null;

  constructor(app: AirDeckApp) { this.app = app; }

  private get state(): HubState {
    if (!this.loaded) {
      this.loaded = this.app.docs.get<HubState>('musikhub', { version: 1, items: [], collections: [], grants: [] });
      // Ältere Bestandsdaten (Phase 1, vor der Upload-Erweiterung) kannten nur sendergebundene Quellen
      // ohne "kind"-Unterscheidung - beim Laden einmalig auf die aktuelle Form heben.
      for (const item of this.loaded.items) {
        const s = item.source as unknown as Record<string, unknown>;
        if (!s.kind) item.source = { kind: 'station', stationId: String(s.stationId ?? ''), mediaId: String(s.mediaId ?? '') };
      }
    }
    return this.loaded;
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
      items: filtered.slice(start, start + count).map((item) => ({ id: item.id, title: item.title, artist: item.artist, version: item.version, owner: item.owner, ...(this.ownerAccess(p, item.owner) && (item.owner.kind === 'user' || item.owner.id === stationId) ? { source: item.source } : {}), actions: this.actions(p, { kind: 'item', id: item.id }, stationId) })),
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
    const existing = this.state.items.find((x) => x.source.kind === 'station' && x.source.stationId === stationId && x.source.mediaId === mediaId);
    if (existing) return existing;
    const item: HubItem = { id: newId('hub'), owner: { kind: 'station', id: stationId }, source: { kind: 'station', stationId, mediaId }, title: media.title, artist: media.artist, version: null, createdAt: Date.now(), revision: 1 };
    this.state.items.push(item);
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'item_registered', actor: this.actor(p), stationId, itemId: item.id });
    return item;
  }

  /** Privater persönlicher Upload: Eigentümer ist immer der hochladende Nutzer, nie ein Sender. */
  private uploadDir(ownerUserId: string): string {
    return join(this.app.dataDir, 'musikhub', 'uploads', ownerUserId);
  }

  /**
   * "Mein Archiv" braucht ein echtes Benutzerkonto: this.actor(p) fällt bei reinen API-/Desktop-Tokens
   * ohne Login auf die Token-ID zurück (nur für Audit-Zwecke gedacht), aber ownerAccess() prüft
   * anschließend gezielt p.user.id. Ohne diese Prüfung entstünde ein Eintrag, den nicht einmal der
   * Hochladende selbst je wiederfinden könnte.
   */
  private requireUserId(p: Principal): string {
    this.actor(p);
    if (!p.user) throw new AppError(403, 'forbidden', 'Persönlicher Upload braucht ein angemeldetes Benutzerkonto');
    return p.user.id;
  }

  /** Bereits verbrauchtes und zulässiges Gesamtvolumen privater Uploads - Kontingent gilt je Konto, nicht je Datei. */
  uploadQuota(p: Principal): { usedBytes: number; quotaBytes: number } {
    const userId = this.requireUserId(p);
    const usedBytes = this.state.items.reduce((sum, item) => sum + (item.owner.kind === 'user' && item.owner.id === userId && item.source.kind === 'upload' ? item.source.sizeBytes : 0), 0);
    return { usedBytes, quotaBytes: MAX_USER_UPLOAD_BYTES };
  }

  /** Zielpfad für einen neuen privaten Upload festlegen, bevor die HTTP-Schicht die Bytes dorthin streamt. */
  preparePrivateUpload(p: Principal, ext: string): { id: string; file: string; absolutePath: string } {
    const userId = this.requireUserId(p);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    const dir = this.uploadDir(userId);
    mkdirSync(dir, { recursive: true });
    const id = newId('hub');
    const file = `${id}${ext}`;
    return { id, file, absolutePath: join(dir, file) };
  }

  /** Absoluter Pfad zur tatsächlich gespeicherten Datei (Sendermedium oder privater Upload). */
  private filePath(item: HubItem): string {
    if (item.source.kind === 'station') return this.app.svc.media.mediaPath(item.source.stationId, this.app.svc.media.media(item.source.stationId, item.source.mediaId));
    return join(this.uploadDir(item.owner.id), item.source.file);
  }

  /**
   * Registriert eine bereits auf die vorgesehene Zielposition geschriebene Upload-Datei (HTTP-Schicht
   * streamt direkt dorthin, damit keine unautorisierte Kopie im Speicher entsteht). Eigentum liegt
   * geschlossen beim hochladenden Nutzer, bis dieser selbst freigibt.
   */
  async registerUpload(p: Principal, id: string, file: string, mimeType: string, sizeBytes: number, titleInput: unknown, artistInput: unknown): Promise<HubItem> {
    const userId = this.requireUserId(p);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    // Maßgebliche Prüfung anhand der tatsächlich geschriebenen Bytes - der Content-Length-Vorabcheck
    // der HTTP-Schicht spart nur Bandbreite, ersetzt diese Kontrolle aber nicht.
    const { usedBytes, quotaBytes } = this.uploadQuota(p);
    if (usedBytes + sizeBytes > quotaBytes) {
      rmSync(join(this.uploadDir(userId), file), { force: true });
      throw new AppError(413, 'quota_exceeded', `Speicherkontingent überschritten (${Math.round(quotaBytes / 1024 / 1024)} MB)`);
    }
    const title = String(titleInput ?? '').trim().slice(0, 200) || file;
    const artist = String(artistInput ?? '').trim().slice(0, 200);
    const item: HubItem = { id, owner: { kind: 'user', id: userId }, source: { kind: 'upload', file, mimeType, sizeBytes }, title, artist, version: null, createdAt: Date.now(), revision: 1 };
    this.state.items.push(item);
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'item_uploaded', actor: userId, itemId: item.id, sizeBytes });
    return item;
  }

  /** Eigene Uploads bei Fehlschlag/Abbruch der HTTP-Schicht wieder entfernen (kein verwaistes Item). */
  discardUpload(ownerUserId: string, file: string): void {
    rmSync(join(this.uploadDir(ownerUserId), file), { force: true });
  }

  async deleteItem(p: Principal, id: string, stationId: string): Promise<void> {
    this.require(p, { kind: 'item', id }, stationId, 'media.delete');
    const item = this.resource({ kind: 'item', id }) as HubItem;
    if (!this.ownerAccess(p, item.owner)) throw new AppError(403, 'forbidden', 'Nur der Eigentümer kann löschen');
    for (const c of this.state.collections) if (c.itemIds.includes(id)) { c.itemIds = c.itemIds.filter((x) => x !== id); c.revision++; }
    this.state.items = this.state.items.filter((x) => x.id !== id);
    this.state.grants = this.state.grants.filter((g) => !(g.resource.kind === 'item' && g.resource.id === id));
    if (item.source.kind === 'upload') rmSync(join(this.uploadDir(item.owner.id), item.source.file), { force: true });
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'item_deleted', actor: this.actor(p), itemId: id });
  }

  /** Datei für Vorhören/Download: Aufrufer muss die jeweilige Aktion bereits besitzen. */
  resolveFile(p: Principal, id: string, stationId: string, action: 'preview.play' | 'file.download'): { path: string; mimeType: string; title: string } {
    this.require(p, { kind: 'item', id }, stationId, action);
    const item = this.resource({ kind: 'item', id }) as HubItem;
    const path = this.filePath(item);
    if (!existsSync(path)) throw new AppError(404, 'not_found', 'Datei nicht mehr vorhanden');
    const mimeType = item.source.kind === 'upload' ? item.source.mimeType : '';
    return { path, mimeType, title: item.title };
  }

  /** Cover wird wie Katalogdaten gefiltert: ohne catalog.read kein Zugriff, unabhängig von der Herkunft. */
  async cover(p: Principal, id: string, stationId: string): Promise<string | null> {
    this.require(p, { kind: 'item', id }, stationId, 'catalog.read');
    const item = this.resource({ kind: 'item', id }) as HubItem;
    if (item.source.kind === 'station') return this.app.svc.media.cover(item.source.stationId, item.source.mediaId);
    if (!this.app.ffmpeg) return null;
    const dir = join(this.app.dataDir, 'covers', 'musikhub');
    const file = join(dir, `${item.id}.jpg`);
    const none = `${file}.none`;
    if (existsSync(file)) return file;
    if (existsSync(none)) return null;
    mkdirSync(dir, { recursive: true });
    const src = this.filePath(item);
    const ok = await new Promise<boolean>((resolveP) => {
      const proc = spawn(this.app.ffmpeg!.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-an', '-frames:v', '1', '-vf', 'scale=300:300:force_original_aspect_ratio=increase,crop=300:300', file], { windowsHide: true });
      proc.on('error', () => resolveP(false));
      proc.on('close', (code) => resolveP(code === 0 && existsSync(file)));
      setTimeout(() => proc.kill(), 15_000).unref();
    });
    if (!ok) {
      rmSync(file, { force: true });
      writeFileAtomic(none, '');
      return null;
    }
    return file;
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
