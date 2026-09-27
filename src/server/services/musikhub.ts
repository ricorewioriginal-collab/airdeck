// Geschlossener MusikHub-Katalog. Ein Eintrag ist zunächst nur eine Referenz auf
// ein vorhandenes Sendermedium; Dateiabruf und Sendebereitstellung folgen in
// eigenen, erneut autorisierten Phasen.

import type { AirDeckApp } from '../app.ts';
import { AppError, canSee, newId, type Principal } from '../model.ts';

export const HUB_ACTIONS = [
  'catalog.read', 'preview.play', 'broadcast.use', 'file.download', 'media.upload',
  'metadata.edit', 'source.write', 'transfer.export', 'shares.manage', 'media.delete',
] as const;
export type HubAction = typeof HUB_ACTIONS[number];
export type HubSubject = { kind: 'user' | 'station'; id: string };
export type HubResource = { kind: 'item' | 'collection'; id: string };
export interface HubItem {
  id: string;
  owner: HubSubject;
  source: { stationId: string; mediaId: string };
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
const hasScope = (p: Principal, scope: string) => p.scopes.includes('*') || p.scopes.includes(scope);
const validAction = (value: unknown): value is HubAction => typeof value === 'string' && (HUB_ACTIONS as readonly string[]).includes(value);
const same = (a: HubSubject, b: HubSubject) => a.kind === b.kind && a.id === b.id;

export class MusicHubService {
  private readonly app: AirDeckApp;
  private loaded: HubState | null = null;

  constructor(app: AirDeckApp) { this.app = app; }

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
      items: filtered.slice(start, start + count).map((item) => ({ id: item.id, title: item.title, artist: item.artist, version: item.version, owner: item.owner, ...(item.owner.kind === 'station' && item.owner.id === stationId && this.ownerAccess(p, item.owner) ? { source: item.source } : {}), actions: this.actions(p, { kind: 'item', id: item.id }, stationId) })),
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
    const existing = this.state.items.find((x) => x.source.stationId === stationId && x.source.mediaId === mediaId);
    if (existing) return existing;
    const item: HubItem = { id: newId('hub'), owner: { kind: 'station', id: stationId }, source: { stationId, mediaId }, title: media.title, artist: media.artist, version: null, createdAt: Date.now(), revision: 1 };
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
