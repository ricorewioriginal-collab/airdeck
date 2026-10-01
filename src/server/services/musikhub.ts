// Geschlossener MusikHub-Katalog. Ein Eintrag ist zunächst nur eine Referenz auf
// ein vorhandenes Sendermedium; Dateiabruf und Sendebereitstellung folgen in
// eigenen, erneut autorisierten Phasen.

import type { AirDeckApp } from '../app.ts';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parseFileName } from '../../core/automation.ts';
import { AUDIO_FILE_RE, AppError, canSee, newId, type Principal } from '../model.ts';
import { Nextcloud, NextcloudError, cleanPath, type NextcloudConfig } from '../nextcloud.ts';
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
  // contentHash (sha256, hex) ist optional: bereits vor der Dublettenerkennung angelegte Uploads
  // kennen ihn noch nicht und werden beim erneuten Ersetzen nachgezogen, aber nicht rückwirkend gehasht.
  | { kind: 'upload'; file: string; mimeType: string; sizeBytes: number; contentHash?: string };
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
/**
 * Zwei-Treffer-Modell (Phase 5): eine bereits erfolgreich zugeordnete laut.fm-Track-ID für denselben
 * Hub-Titel und Zielsender wird wiederverwendet statt erneut hochgeladen. `lautfmTrackId` ist negativ,
 * solange laut.fm den Upload noch verarbeitet (siehe lautcastTransfer()).
 */
export interface LautcastMapping { id: string; itemId: string; stationId: string; lautfmTrackId: number; createdAt: number; updatedAt: number }
/**
 * Persistenter Ordner-Importjob (Paket 09, erster Schritt): löst den rein synchronen Aufruf von
 * nextcloudImportFolder() ab, wenn der Aufrufer Status abfragen statt auf die volle Antwort warten
 * möchte. Läuft im selben Prozess asynchron (kein separater Worker-Prozess). Deckt vorerst nur
 * queued/running/succeeded/failed plus Neustart eines fehlgeschlagenen Jobs ab - der volle, in
 * docs/MUSIKHUB_PROGRESS.md skizzierte Zustandsautomat (inkl. verifying/blocked/conflict/cancelling)
 * folgt erst mit echtem Bedarf.
 */
export interface ImportJob {
  id: string; userId: string; path: string; status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number; createdAt: number; updatedAt: number;
  result?: { imported: number; skipped: number; errors: string[] }; error?: string;
}
interface HubState { version: 1; items: HubItem[]; collections: HubCollection[]; grants: HubGrant[]; lautcastMappings: LautcastMapping[]; importJobs: ImportJob[] }

const READ_ACTIONS = new Set<HubAction>(['catalog.read', 'preview.play', 'file.download']);
const BROADCAST_ACTIONS = new Set<HubAction>(['broadcast.use']);
const MAX_COLLECTION_ITEMS = 5000;
/** Gesamtkontingent privater Uploads je Nutzerkonto (nicht je Datei) - schützt Plattenspeicher vor unbegrenztem persönlichem Archiv. */
export const MAX_USER_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/** Obergrenzen für den rekursiven Nextcloud-Ordner-Import - verhindert einen unbegrenzten Vollscan im Anfragethread. */
export const MAX_FOLDER_IMPORT_FILES = 50;
const MAX_FOLDER_IMPORT_DEPTH = 4;
/** lautCast-Upload: wie oft/wie lange auf eine noch negative (in Bearbeitung befindliche) Track-ID gewartet wird, bevor ehrlich "processing" statt eines erfundenen Erfolgs gemeldet wird. */
const LAUTCAST_POLL_ATTEMPTS = 5;
const LAUTCAST_POLL_DELAY_MS = 1000;
/** Je Nutzerkonto nur die letzten MAX_IMPORT_JOBS_PER_USER Importjobs behalten (wie die Audit-Log-Begrenzung) - kein unbegrenzt wachsender Verlauf. */
const MAX_IMPORT_JOBS_PER_USER = 20;
const hasScope = (p: Principal, scope: string) => p.scopes.includes('*') || p.scopes.includes(scope);
const validAction = (value: unknown): value is HubAction => typeof value === 'string' && (HUB_ACTIONS as readonly string[]).includes(value);
const same = (a: HubSubject, b: HubSubject) => a.kind === b.kind && a.id === b.id;

export class MusicHubService {
  private readonly app: AirDeckApp;
  private loaded: HubState | null = null;

  constructor(app: AirDeckApp) { this.app = app; }

  private get state(): HubState {
    if (!this.loaded) {
      this.loaded = this.app.docs.get<HubState>('musikhub', { version: 1, items: [], collections: [], grants: [], lautcastMappings: [], importJobs: [] });
      // Ältere Bestandsdaten (Phase 1, vor der Upload-Erweiterung) kannten nur sendergebundene Quellen
      // ohne "kind"-Unterscheidung - beim Laden einmalig auf die aktuelle Form heben.
      for (const item of this.loaded.items) {
        const s = item.source as unknown as Record<string, unknown>;
        if (!s.kind) item.source = { kind: 'station', stationId: String(s.stationId ?? ''), mediaId: String(s.mediaId ?? '') };
      }
      // Ältere Bestandsdaten (vor Phase 5 lautCast-Trackmapping) kannten dieses Feld noch nicht.
      this.loaded.lautcastMappings ??= [];
      // Ältere Bestandsdaten (vor den persistenten Importjobs) kannten dieses Feld noch nicht.
      this.loaded.importJobs ??= [];
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

  /** Bereits vorhandener eigener Upload mit identischem Inhalt (Byte-für-Byte, per sha256) - erspart doppelten Speicherverbrauch. */
  private findDuplicate(userId: string, contentHash: string, excludeItemId?: string): HubItem | null {
    return this.state.items.find((x) => x.id !== excludeItemId && x.owner.kind === 'user' && x.owner.id === userId && x.source.kind === 'upload' && x.source.contentHash === contentHash) ?? null;
  }

  /**
   * Registriert eine bereits auf die vorgesehene Zielposition geschriebene Upload-Datei (HTTP-Schicht
   * streamt direkt dorthin, damit keine unautorisierte Kopie im Speicher entsteht). Eigentum liegt
   * geschlossen beim hochladenden Nutzer, bis dieser selbst freigibt.
   */
  async registerUpload(p: Principal, id: string, file: string, mimeType: string, sizeBytes: number, contentHash: string, titleInput: unknown, artistInput: unknown): Promise<HubItem> {
    const userId = this.requireUserId(p);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    // Maßgebliche Prüfung anhand der tatsächlich geschriebenen Bytes - der Content-Length-Vorabcheck
    // der HTTP-Schicht spart nur Bandbreite, ersetzt diese Kontrolle aber nicht.
    const { usedBytes, quotaBytes } = this.uploadQuota(p);
    if (usedBytes + sizeBytes > quotaBytes) {
      rmSync(join(this.uploadDir(userId), file), { force: true });
      throw new AppError(413, 'quota_exceeded', `Speicherkontingent überschritten (${Math.round(quotaBytes / 1024 / 1024)} MB)`);
    }
    const duplicate = this.findDuplicate(userId, contentHash);
    if (duplicate) {
      rmSync(join(this.uploadDir(userId), file), { force: true });
      throw new AppError(409, 'duplicate_content', `Identischer Inhalt bereits im eigenen Archiv vorhanden: „${duplicate.title}“`);
    }
    const title = String(titleInput ?? '').trim().slice(0, 200) || file;
    const artist = String(artistInput ?? '').trim().slice(0, 200);
    const item: HubItem = { id, owner: { kind: 'user', id: userId }, source: { kind: 'upload', file, mimeType, sizeBytes, contentHash }, title, artist, version: null, createdAt: Date.now(), revision: 1 };
    this.state.items.push(item);
    await this.save();
    this.app.audit.write({ kind: 'musikhub', event: 'item_uploaded', actor: userId, itemId: item.id, sizeBytes });
    return item;
  }

  /** Eigene Uploads bei Fehlschlag/Abbruch der HTTP-Schicht wieder entfernen (kein verwaistes Item). */
  discardUpload(ownerUserId: string, file: string): void {
    rmSync(join(this.uploadDir(ownerUserId), file), { force: true });
  }

  /**
   * Zielpfad für eine neue Version einer bestehenden privaten Upload-Datei festlegen. Die Item-ID,
   * ihr Eigentümer, ihre Sammlungsmitgliedschaften und alle bestehenden Freigaben bleiben unverändert -
   * nur die zugrundeliegende Datei wird ausgetauscht. Nur der Eigentümer selbst darf ersetzen (dieselbe
   * Regel wie beim Löschen), nicht nur jeder mit delegiertem `source.write`.
   */
  prepareReplaceUpload(p: Principal, id: string, stationId: string, ext: string): { file: string; absolutePath: string; oldSizeBytes: number } {
    this.require(p, { kind: 'item', id }, stationId, 'source.write');
    const item = this.resource({ kind: 'item', id }) as HubItem;
    if (!this.ownerAccess(p, item.owner)) throw new AppError(403, 'forbidden', 'Nur der Eigentümer kann die Quelldatei ersetzen');
    if (item.source.kind !== 'upload') throw new AppError(400, 'invalid_source', 'Nur eigene Uploads lassen sich ersetzen, keine Senderreferenzen');
    const userId = this.requireUserId(p);
    const dir = this.uploadDir(userId);
    mkdirSync(dir, { recursive: true });
    const file = `${newId('hub')}${ext}`;
    return { file, absolutePath: join(dir, file), oldSizeBytes: item.source.sizeBytes };
  }

  /**
   * Registriert eine bereits an den in prepareReplaceUpload() vergebenen Zielpfad geschriebene neue
   * Version. Item-ID, Eigentümer, Sammlungsmitgliedschaften und Freigaben bleiben unangetastet - nur
   * Quelle, Version und Revision wechseln. Die alte Datei wird erst nach erfolgreicher Umstellung
   * entfernt, damit ein Fehlschlag zwischen Schreiben und Registrieren nicht zu Datenverlust führt.
   */
  async replaceUpload(p: Principal, id: string, stationId: string, file: string, mimeType: string, sizeBytes: number, contentHash: string): Promise<HubItem> {
    this.require(p, { kind: 'item', id }, stationId, 'source.write');
    const item = this.resource({ kind: 'item', id }) as HubItem;
    if (!this.ownerAccess(p, item.owner)) throw new AppError(403, 'forbidden', 'Nur der Eigentümer kann die Quelldatei ersetzen');
    if (item.source.kind !== 'upload') throw new AppError(400, 'invalid_source', 'Nur eigene Uploads lassen sich ersetzen, keine Senderreferenzen');
    const userId = this.requireUserId(p);
    // Maßgebliche Kontingentprüfung: die alte Dateigröße dieses Items zählt nicht doppelt mit.
    const { usedBytes, quotaBytes } = this.uploadQuota(p);
    if (usedBytes - item.source.sizeBytes + sizeBytes > quotaBytes) {
      rmSync(join(this.uploadDir(userId), file), { force: true });
      throw new AppError(413, 'quota_exceeded', `Speicherkontingent überschritten (${Math.round(quotaBytes / 1024 / 1024)} MB)`);
    }
    // Sich selbst von der Dublettenprüfung ausnehmen: dieses Item trägt den alten Hash noch, bis
    // gleich unten überschrieben wird - sonst würde jedes Ersetzen fälschlich als Duplikat seiner
    // eigenen vorherigen Version erscheinen.
    const duplicate = this.findDuplicate(userId, contentHash, id);
    if (duplicate) {
      rmSync(join(this.uploadDir(userId), file), { force: true });
      throw new AppError(409, 'duplicate_content', `Identischer Inhalt bereits im eigenen Archiv vorhanden: „${duplicate.title}“`);
    }
    const oldFile = item.source.file;
    item.source = { kind: 'upload', file, mimeType, sizeBytes, contentHash };
    item.version = String(Number(item.version ?? '1') + 1);
    item.revision++;
    await this.save();
    rmSync(join(this.uploadDir(userId), oldFile), { force: true });
    this.app.audit.write({ kind: 'musikhub', event: 'item_source_replaced', actor: userId, itemId: id, sizeBytes, version: item.version });
    return item;
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

  // --- Phase 3 (Beginn): eigene Nextcloud-Quelle je Nutzerkonto -----------------------------------
  // Getrennt vom bestehenden, senderweiten globalen Nextcloud-Import (src/server/services/nextcloud.ts,
  // eine gemeinsame Konfiguration für den ganzen Server). Jeder Nutzer verwaltet Adresse, Zugang und
  // Startordner für "Mein Archiv" unabhängig - kein geteiltes Konto, kein Zugriff auf fremde Bestände
  // über diesen Weg. Der bestehende WebDAV-Adapter (Nextcloud-Klasse) wird unverändert wiederverwendet.
  // Nur ein einzelner, nicht rekursiver Ordnerabruf und Einzeldatei-Import sind hier umgesetzt - ein
  // persistentes Job-/Retry-/Hash-/Quoten-/Konfliktsystem für rekursive Ordnerübernahmen folgt in
  // einem eigenen, separat zu prüfenden Block (siehe docs/MUSIKHUB_PROGRESS.md).

  private ncKey(userId: string): string {
    return `musikhub:nextcloud:${userId}`;
  }

  nextcloudSource(p: Principal): (NextcloudConfig & { hasPassword: boolean }) | { configured: false } {
    const userId = this.requireUserId(p);
    const key = this.ncKey(userId);
    const c = this.app.docs.get<NextcloudConfig | null>(key, null);
    return c ? { ...c, hasPassword: this.app.secrets.has(`${key}:password`) } : { configured: false };
  }

  setNextcloudSource(p: Principal, input: Record<string, unknown>): unknown {
    const userId = this.requireUserId(p);
    const key = this.ncKey(userId);
    if (input.remove === true) {
      this.app.docs.set(key, null);
      this.app.secrets.delete(`${key}:password`);
      return { configured: false };
    }
    const url = String(input.url ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+/.test(url)) throw new AppError(400, 'invalid_url', 'Nextcloud-Adresse mit https:// angeben');
    const user = String(input.user ?? '').trim();
    if (!user) throw new AppError(400, 'invalid_user', 'Benutzername fehlt');
    let root: string;
    try { root = cleanPath(String(input.root ?? '/')); } catch { throw new AppError(400, 'invalid_path', 'Ungültiger Startordner'); }
    if (typeof input.password === 'string' && input.password) this.app.secrets.set(`${key}:password`, input.password.trim());
    if (!this.app.secrets.has(`${key}:password`)) throw new AppError(400, 'no_password', 'App-Passwort fehlt (Nextcloud → Einstellungen → Sicherheit → App-Passwort)');
    this.app.docs.set(key, { url, user, root });
    this.app.audit.write({ kind: 'musikhub', event: 'nextcloud_source_configured', actor: userId });
    return this.nextcloudSource(p);
  }

  private ncClient(p: Principal): { client: Nextcloud; root: string } {
    const userId = this.requireUserId(p);
    const key = this.ncKey(userId);
    const c = this.app.docs.get<NextcloudConfig | null>(key, null);
    const pw = this.app.secrets.get(`${key}:password`);
    if (!c || !pw) throw new AppError(409, 'not_configured', 'Eigene Nextcloud-Quelle ist noch nicht eingerichtet');
    return { client: new Nextcloud(c, pw), root: c.root };
  }

  private ncCall<T>(fn: () => Promise<T>): Promise<T> {
    return fn().catch((err) => {
      if (err instanceof NextcloudError) throw new AppError(err.status === 401 ? 502 : err.status, 'nextcloud', err.message);
      throw err;
    });
  }

  /** Ordnerinhalt der eigenen Nextcloud-Quelle (Depth 1, ein PROPFIND) - kein rekursiver Vollscan. */
  async nextcloudList(p: Principal, path: string): Promise<unknown> {
    const { client, root } = this.ncClient(p);
    let rel: string;
    try { rel = cleanPath(path); } catch (err) { throw new AppError(400, 'invalid_path', err instanceof NextcloudError ? err.message : 'Ungültiger Pfad'); }
    const entries = await this.ncCall(() => client.list(cleanPath(`${root}/${rel}`)));
    return { path: rel, entries: entries.map((e) => ({ ...e, path: cleanPath(e.path.slice(root === '/' ? 0 : root.length)), audio: !e.dir && AUDIO_FILE_RE.test(e.name) })) };
  }

  /**
   * Bis zu 10 einzelne Dateien direkt aus der eigenen Nextcloud in "Mein Archiv" übernehmen - bewusst
   * kein rekursiver Ordner-Import (das wäre ein blockierender Vollscan im Anfragethread). Dieselbe
   * Kontingentprüfung wie bei jedem anderen privaten Upload gilt unverändert und maßgeblich in
   * registerUpload() - der Vorabcheck hier spart nur unnötige Downloads.
   */
  async nextcloudImportFiles(p: Principal, pathsInput: unknown): Promise<{ imported: HubItem[]; errors: string[] }> {
    const userId = this.requireUserId(p);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    if (!Array.isArray(pathsInput) || !pathsInput.length || pathsInput.length > 10 || pathsInput.some((x) => typeof x !== 'string')) {
      throw new AppError(400, 'invalid_paths', 'Höchstens 10 Dateipfade je Aufruf');
    }
    const { client, root } = this.ncClient(p);
    const imported: HubItem[] = [];
    const errors: string[] = [];
    for (const raw of pathsInput as string[]) {
      let rel: string;
      try { rel = cleanPath(raw); } catch { errors.push(`${raw}: ungültiger Pfad`); continue; }
      const name = rel.split('/').pop() ?? '';
      if (!AUDIO_FILE_RE.test(name)) { errors.push(`${name}: kein unterstützter Audiotyp`); continue; }
      const { usedBytes, quotaBytes } = this.uploadQuota(p);
      if (usedBytes >= quotaBytes) { errors.push(`${name}: Speicherkontingent bereits ausgeschöpft`); continue; }
      const dir = this.uploadDir(userId);
      mkdirSync(dir, { recursive: true });
      const id = newId('hub');
      const file = `${id}${extname(name).toLowerCase()}`;
      const target = join(dir, file);
      try {
        const size = await this.ncCall(() => client.download(cleanPath(`${root}/${rel}`), target, Math.max(0, quotaBytes - usedBytes)));
        const contentHash = await this.hashFile(target);
        const meta = parseFileName(name);
        imported.push(await this.registerUpload(p, id, file, '', size, contentHash, meta.title || name, meta.artist));
      } catch (err) {
        rmSync(target, { force: true });
        errors.push(`${name}: ${(err as Error).message}`);
      }
    }
    return { imported, errors };
  }

  /** sha256 einer bereits geschriebenen Datei - für den Nextcloud-Import, der (anders als der Direkt-Upload/Ersetzen-Stream) nicht während des Schreibens mithashen kann. */
  private hashFile(path: string): Promise<string> {
    return new Promise((resolveHash, rejectHash) => {
      const hash = createHash('sha256');
      createReadStream(path).on('data', (d) => hash.update(d)).on('error', rejectHash).on('end', () => resolveHash(hash.digest('hex')));
    });
  }

  /**
   * Rekursiver Ordner-Import aus der eigenen Nextcloud-Quelle in "Mein Archiv" - begrenzt auf
   * MAX_FOLDER_IMPORT_FILES Dateien und MAX_FOLDER_IMPORT_DEPTH Verzeichnisebenen, damit kein
   * unbegrenzter Vollscan im Anfragethread entstehen kann. Folgt demselben begrenzten Rekursionsmuster
   * wie der bestehende globale, sendergebundene Import (`NextcloudService.nextcloudImport()`), nur mit
   * kleineren, für ein persönliches Archiv passenden Grenzen. Ein bereits im Archiv vorhandener Inhalt
   * (Dublettenerkennung) zählt als übersprungen, nicht als Fehler - bei einem erneuten Lauf über
   * denselben Ordner ist das der Normalfall, kein Ausnahmezustand.
   */
  async nextcloudImportFolder(p: Principal, pathInput: unknown): Promise<{ imported: HubItem[]; skipped: number; errors: string[] }> {
    const userId = this.requireUserId(p);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    const { client, root } = this.ncClient(p);
    let startRel: string;
    try { startRel = cleanPath(typeof pathInput === 'string' ? pathInput : '/'); } catch { throw new AppError(400, 'invalid_path', 'Ungültiger Pfad'); }
    const files: { path: string; name: string }[] = [];
    const walk = async (rel: string, depth: number): Promise<void> => {
      const list = await this.ncCall(() => client.list(cleanPath(`${root}/${rel}`)));
      for (const e of list) {
        if (files.length >= MAX_FOLDER_IMPORT_FILES) return;
        const r = cleanPath(`${rel}/${e.name}`);
        if (e.dir && depth < MAX_FOLDER_IMPORT_DEPTH) await walk(r, depth + 1);
        else if (!e.dir && AUDIO_FILE_RE.test(e.name)) files.push({ path: r, name: e.name });
      }
    };
    await walk(startRel, 0);
    const imported: HubItem[] = [];
    const errors: string[] = [];
    let skipped = 0;
    for (const f of files) {
      const { usedBytes, quotaBytes } = this.uploadQuota(p);
      if (usedBytes >= quotaBytes) { errors.push(`${f.name}: Speicherkontingent bereits ausgeschöpft`); continue; }
      const dir = this.uploadDir(userId);
      mkdirSync(dir, { recursive: true });
      const id = newId('hub');
      const file = `${id}${extname(f.name).toLowerCase()}`;
      const target = join(dir, file);
      try {
        const size = await this.ncCall(() => client.download(cleanPath(`${root}/${f.path}`), target, Math.max(0, quotaBytes - usedBytes)));
        const contentHash = await this.hashFile(target);
        const meta = parseFileName(f.name);
        imported.push(await this.registerUpload(p, id, file, '', size, contentHash, meta.title || f.name, meta.artist));
      } catch (err) {
        rmSync(target, { force: true });
        if (err instanceof AppError && err.code === 'duplicate_content') skipped++;
        else errors.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    return { imported, skipped, errors };
  }

  /** Minimaler, nicht persistierter Stellvertreter-Principal für den Hintergrundlauf eines Importjobs - nur für ncClient()/registerUpload() intern verwendet, nie nach außen gegeben. */
  private importJobPrincipal(userId: string): Principal {
    return { id: userId, roles: [], stationIds: [], scopes: ['media:write'], tokenId: 'musikhub-import-job', user: { id: userId, username: '', name: '' } };
  }

  /** Eigene Importjobs, neueste zuerst. */
  listImportJobs(p: Principal): ImportJob[] {
    const userId = this.requireUserId(p);
    return this.state.importJobs.filter((j) => j.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Ordner-Import als Hintergrundjob starten statt die Antwort auf den vollständigen (ggf. langsamen)
   * Ordnerdurchlauf warten zu lassen. Dieselben Vorabprüfungen wie beim synchronen
   * nextcloudImportFolder() (Konto, Schreibrecht, konfigurierte Quelle, gültiger Pfad) laufen sofort,
   * damit ein ungültiger Aufruf nicht erst als spät fehlschlagender Job sichtbar wird - nur der
   * eigentliche Download-/Importlauf selbst ist asynchron.
   */
  async startNextcloudImportJob(p: Principal, pathInput: unknown): Promise<ImportJob> {
    const userId = this.requireUserId(p);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    this.ncClient(p);
    let rel: string;
    try { rel = cleanPath(typeof pathInput === 'string' ? pathInput : '/'); } catch { throw new AppError(400, 'invalid_path', 'Ungültiger Pfad'); }
    const job: ImportJob = { id: newId('job'), userId, path: rel, status: 'queued', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() };
    this.state.importJobs.unshift(job);
    const own = this.state.importJobs.filter((j) => j.userId === userId);
    if (own.length > MAX_IMPORT_JOBS_PER_USER) {
      const drop = new Set(own.slice(MAX_IMPORT_JOBS_PER_USER).map((j) => j.id));
      this.state.importJobs = this.state.importJobs.filter((j) => !drop.has(j.id));
    }
    await this.save();
    this.runImportJob(job.id);
    return job;
  }

  /** Einen eigenen, nicht mehr laufenden Job erneut anstoßen - dieselbe Job-ID bleibt bestehen, kein Neuanlegen. */
  async restartImportJob(p: Principal, jobId: string): Promise<ImportJob> {
    const userId = this.requireUserId(p);
    const job = this.state.importJobs.find((j) => j.id === jobId && j.userId === userId);
    if (!job) throw new AppError(404, 'not_found', 'Importjob nicht gefunden');
    if (job.status === 'queued' || job.status === 'running') throw new AppError(409, 'already_running', 'Importjob läuft bereits');
    job.status = 'queued';
    job.error = undefined;
    job.updatedAt = Date.now();
    await this.save();
    this.runImportJob(job.id);
    return job;
  }

  /** Läuft außerhalb des Anfragethreads - ein Fehlschlag wird ehrlich als job.status='failed' festgehalten, nie stillschweigend verschluckt oder als Erfolg gemeldet. */
  private runImportJob(jobId: string): void {
    setImmediate(async () => {
      const job = this.state.importJobs.find((j) => j.id === jobId);
      if (!job) return;
      job.status = 'running';
      job.attempts++;
      job.updatedAt = Date.now();
      await this.save();
      try {
        const result = await this.nextcloudImportFolder(this.importJobPrincipal(job.userId), job.path);
        job.status = 'succeeded';
        job.result = { imported: result.imported.length, skipped: result.skipped, errors: result.errors };
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof AppError ? err.message : (err as Error).message;
      }
      job.updatedAt = Date.now();
      await this.save();
    });
  }

  /**
   * „Übertragungen": nachvollziehbare Historie der eigenen MusikHub-Aktivität (Upload, Ersetzen,
   * Löschen, Freigaben, Sammlungen, Nextcloud-Quelle) - liest aus dem bereits vorhandenen Audit-Log
   * (kein neuer Speicher), gefiltert auf `kind: 'musikhub'` und den eigenen Akteur. Wie der bestehende
   * globale `/api/v1/audit`-Endpunkt auf die zuletzt 500 protokollierten Einträge im Speicher begrenzt -
   * das ist eine „zuletzt gesehen"-Ansicht, keine vollständige, unbegrenzte Historie.
   */
  myTransfers(p: Principal): unknown[] {
    const userId = this.requireUserId(p);
    return this.app.audit.tail(500)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && (e as Record<string, unknown>).kind === 'musikhub' && (e as Record<string, unknown>).actor === userId)
      .reverse();
  }

  /**
   * Sendefähigkeits-Preflight (Phase 4, erster Schritt): prüft vor einer geplanten Aufnahme in
   * Queue/Planung/Cardwall, ob ein Hub-Titel für den angegebenen Sender tatsächlich sendefähig ist -
   * Berechtigung (`broadcast.use`), Senderzugehörigkeit der Quelldatei, tatsächliches Vorhandensein
   * und unterstütztes Format. `require()` liefert dieselbe existenzleck-freie 404-Antwort wie überall
   * sonst in MusikHub; das eigentliche Wiring in Queue/Planung/Cardwall sowie die Wiedergabeleasing-Regel
   * bei Widerruf (laufender Titel darf zu Ende spielen) folgen als eigener, separater Schritt.
   *
   * Private Uploads (`source.kind === 'upload'`) liegen bewusst außerhalb jedes Senderarchivs und sind
   * daher nie ohne eine noch fehlende, separate Bereitstellungsfunktion sendefähig - kein implizites
   * Kopieren in ein Senderarchiv aus dieser Prüfung heraus.
   */
  broadcastPreflight(p: Principal, itemId: string, stationId: string): { ok: boolean; reason?: string; itemId: string; stationId: string } {
    this.require(p, { kind: 'item', id: itemId }, stationId, 'broadcast.use');
    const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
    if (item.source.kind === 'upload') return { ok: false, reason: 'not_staged', itemId, stationId };
    if (item.source.stationId !== stationId) return { ok: false, reason: 'other_station', itemId, stationId };
    let media: ReturnType<AirDeckApp['svc']['media']['media']>;
    try {
      media = this.app.svc.media.media(item.source.stationId, item.source.mediaId);
    } catch {
      return { ok: false, reason: 'missing', itemId, stationId };
    }
    if (media.url) return { ok: false, reason: 'unsupported_source', itemId, stationId };
    const path = this.filePath(item);
    if (!existsSync(path)) return { ok: false, reason: 'missing', itemId, stationId };
    if (statSync(path).size === 0) return { ok: false, reason: 'empty', itemId, stationId };
    if (!AUDIO_FILE_RE.test(path)) return { ok: false, reason: 'unsupported_format', itemId, stationId };
    return { ok: true, itemId, stationId };
  }

  /**
   * lautCast-Capability-Prüfung (Phase 5, erster Schritt): stellt fest, ob eine Übertragung eines
   * Hub-Titels an laut.fm Radioadmin für den Zielsender überhaupt in Frage kommt - `transfer.export`-
   * Berechtigung (existenzleck-frei), ob der Zielsender tatsächlich mit laut.fm verbunden ist (Token
   * hinterlegt, laut.fm-Stations-ID gewählt) und ob die zugrundeliegende Datei tatsächlich vorhanden
   * und in einem unterstützten Format vorliegt. Reine Prüfung ohne Seiteneffekt - der tatsächliche
   * Upload passiert erst in lautcastTransfer() (Phase 5, zweiter Schritt), demselben Aufbau wie
   * broadcastPreflight()/stageToStation() bei AnMaCha Cast.
   */
  lautcastCapability(p: Principal, itemId: string, stationId: string): { ok: boolean; reason?: string; itemId: string; stationId: string } {
    this.require(p, { kind: 'item', id: itemId }, stationId, 'transfer.export');
    const cfg = this.app.svc.lautfm.lautfmConfig(stationId);
    if (!cfg.hasToken || cfg.stationId === undefined) return { ok: false, reason: 'lautcast_not_connected', itemId, stationId };
    const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
    const path = this.filePath(item);
    if (!existsSync(path)) return { ok: false, reason: 'missing', itemId, stationId };
    if (!AUDIO_FILE_RE.test(path)) return { ok: false, reason: 'unsupported_format', itemId, stationId };
    return { ok: true, itemId, stationId };
  }

  /** Bereits zugeordnete laut.fm-Track-ID für denselben Hub-Titel und Zielsender, falls vorhanden. */
  private lautcastMapping(itemId: string, stationId: string): LautcastMapping | undefined {
    return this.state.lautcastMappings.find((m) => m.itemId === itemId && m.stationId === stationId);
  }

  private async saveLautcastMapping(itemId: string, stationId: string, lautfmTrackId: number): Promise<LautcastMapping> {
    const now = Date.now();
    const existing = this.lautcastMapping(itemId, stationId);
    if (existing) {
      existing.lautfmTrackId = lautfmTrackId;
      existing.updatedAt = now;
      await this.save();
      return existing;
    }
    const mapping: LautcastMapping = { id: newId('lcm'), itemId, stationId, lautfmTrackId, createdAt: now, updatedAt: now };
    this.state.lautcastMappings.push(mapping);
    await this.save();
    return mapping;
  }

  /**
   * lautCast-Übertragung (Phase 5, zweiter Schritt): lädt die Datei eines Hub-Titels tatsächlich zu
   * laut.fm hoch, sobald lautcastCapability() grünes Licht gibt - über den verifiziert nicht
   * deprecateten `POST /stations/{station_id}/tracks`-Endpunkt (Upload MP3) der offiziellen laut.fm-
   * Radioadmin-Spezifikation (Paket 10, Version 1.0.1). Die parallel dokumentierte Track-Suche
   * (`GET /stations/{station_id}/tracks`) bleibt bewusst ungenutzt, da als deprecated markiert.
   *
   * Zwei-Treffer-Modell: eine bereits erfolgreich zugeordnete laut.fm-Track-ID für denselben Hub-Titel
   * und Zielsender wird wiederverwendet statt erneut hochgeladen (`saveLautcastMapping`/
   * `lautcastMapping`). laut.fm liefert beim Hochladen zunächst eine negative "in Bearbeitung"-ID
   * zurück; diese wird hier bis zu LAUTCAST_POLL_ATTEMPTS mal kurz abgefragt (Spezifikation:
   * "Verarbeitungsstatus pollbar/idempotent behandeln"). Bleibt sie danach negativ, wird ehrlich
   * `reason: 'processing'` gemeldet statt eine unfertige Zuordnung als Erfolg zu verkaufen - die
   * negative ID wird trotzdem gespeichert, damit ein erneuter Aufruf dieselbe laut.fm-Track-ID erneut
   * abfragt, statt eine zweite Datei hochzuladen (Idempotenz ohne eigenen Job-Scheduler).
   *
   * Optionales Wiring in eine laut.fm-Playlist (Phase 5, dritter Schritt): wird eine `playlistId`
   * angegeben, hängt der Endpunkt den aufgelösten Track zusätzlich über `POST
   * /stations/{station_id}/playlists/{playlist_id}` (nicht deprecated, Paket 10) an diese laut.fm-
   * Playlist an - laut Spezifikation lehnt laut.fm bereits enthaltene Tracks selbst ohne Fehler ab, das
   * ist daher ebenfalls idempotent. Der Playlist-Schritt ist bewusst vom Upload-Erfolg getrennt
   * (`playlistOk`/`playlistReason` statt eines gemeinsamen `ok`) - ein fehlgeschlagener Playlist-Eintrag
   * darf einen sonst erfolgreichen Upload nicht als Fehlschlag maskieren. Kein persistenter, im
   * Hintergrund laufender Übertragungs-Job mit dem vollen Zustandsautomaten (queued→running→verifying→
   * succeeded/blocked/…) aus Paket 10; diese Implementierung ist eine synchrone, aber idempotente
   * Einzelübertragung je Aufruf.
   */
  async lautcastTransfer(p: Principal, itemId: string, stationId: string, playlistId?: number): Promise<{ ok: boolean; reason?: string; itemId: string; stationId: string; trackId?: number; playlistId?: number; playlistOk?: boolean; playlistReason?: string }> {
    this.require(p, { kind: 'item', id: itemId }, stationId, 'transfer.export');
    const cfg = this.app.svc.lautfm.lautfmConfig(stationId);
    if (!cfg.hasToken || cfg.stationId === undefined) return { ok: false, reason: 'lautcast_not_connected', itemId, stationId };
    const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
    const path = this.filePath(item);
    if (!existsSync(path)) return { ok: false, reason: 'missing', itemId, stationId };
    if (!AUDIO_FILE_RE.test(path)) return { ok: false, reason: 'unsupported_format', itemId, stationId };

    let trackId = this.lautcastMapping(itemId, stationId)?.lautfmTrackId;
    if (trackId === undefined) {
      const buf = await readFile(path);
      const form = new FormData();
      form.set('track', new Blob([buf]), `${item.title.slice(0, 120) || 'track'}${extname(path)}`);
      const res = await this.app.svc.lautfm.radioadminMultipart(stationId, `/stations/${cfg.stationId}/tracks`, form);
      if (res.status !== 201) return { ok: false, reason: 'upload_failed', itemId, stationId };
      const data = res.data as { id?: unknown };
      if (typeof data.id !== 'number') return { ok: false, reason: 'upload_failed', itemId, stationId };
      trackId = data.id;
    }

    if (trackId < 0) {
      for (let i = 0; i < LAUTCAST_POLL_ATTEMPTS && trackId < 0; i++) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, LAUTCAST_POLL_DELAY_MS));
        const res = await this.app.svc.lautfm.radioadmin(stationId, 'GET', `/stations/${cfg.stationId}/tracks/${trackId}`);
        const data = res.data as { tracks?: { id?: unknown }[] };
        const found = data.tracks?.[0];
        if (found && typeof found.id === 'number' && found.id > 0) trackId = found.id;
      }
      await this.saveLautcastMapping(itemId, stationId, trackId);
      if (trackId < 0) return { ok: false, reason: 'processing', itemId, stationId, trackId };
      this.app.audit.write({ kind: 'musikhub', event: 'lautcast_transferred', actor: this.actor(p), itemId, stationId, trackId });
    }

    if (!playlistId) return { ok: true, itemId, stationId, trackId };
    const plRes = await this.app.svc.lautfm.radioadmin(stationId, 'POST', `/stations/${cfg.stationId}/playlists/${playlistId}`, { track_id: trackId });
    if (plRes.status !== 200) return { ok: true, itemId, stationId, trackId, playlistId, playlistOk: false, playlistReason: 'playlist_add_failed' };
    this.app.audit.write({ kind: 'musikhub', event: 'lautcast_playlist_added', actor: this.actor(p), itemId, stationId, trackId, playlistId });
    return { ok: true, itemId, stationId, trackId, playlistId, playlistOk: true };
  }

  /**
   * Bereitstellung eines privaten Uploads in ein Senderarchiv (Phase 4, zweiter Schritt): kontrolliertes
   * Kopieren statt impliziten Zugriffs - ein Kataloggrant oder eine gemeinsame Sammlung gibt niemals
   * automatisch Sendefähigkeit (siehe Kommentar an broadcastPreflight()). Nur der Eigentümer des privaten
   * Uploads darf ihn bereitstellen (dieselbe engere Regel wie Ersetzen/Löschen - ein delegiertes
   * `source.write` genügt dafür ausdrücklich nicht), und nur in einen Sender, dem er selbst ausdrücklich
   * zugeordnet ist und an dem er Medien-Schreibrecht besitzt. Erstellt eine physische Kopie der Datei im
   * Senderarchiv und registriert sie dort als gewöhnliches Sendermedium (derselbe Weg wie jeder normale
   * Medien-Upload), danach als neuen, sendergebundenen Hub-Eintrag per registerStationMedia() -
   * der ursprüngliche private Upload und sein Hub-Item bleiben davon unverändert und unabhängig bestehen.
   * Erst danach liefert broadcastPreflight() für diesen neuen Eintrag `ok: true` statt `not_staged`.
   */
  async stageToStation(p: Principal, itemId: string, stationId: string): Promise<HubItem> {
    this.requireUserId(p);
    const item = this.resource({ kind: 'item', id: itemId }) as HubItem;
    if (!this.ownerAccess(p, item.owner)) throw new AppError(403, 'forbidden', 'Nur der Eigentümer kann bereitstellen');
    if (item.source.kind !== 'upload') throw new AppError(400, 'invalid_source', 'Nur eigene Uploads lassen sich bereitstellen, keine Senderreferenzen');
    this.station(p, stationId);
    if (!hasScope(p, 'media:write')) throw new AppError(403, 'forbidden', 'Medien-Schreibrecht fehlt');
    if (!this.explicitMember(p, stationId)) throw new AppError(403, 'forbidden', 'Ausdrückliche Senderzuordnung erforderlich');
    const srcPath = this.filePath(item);
    if (!existsSync(srcPath)) throw new AppError(404, 'not_found', 'Datei nicht mehr vorhanden');
    const mediaId = newId('media');
    const fileName = `${mediaId}${extname(item.source.file)}`;
    const destDir = join(this.app.mediaDir, stationId);
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, fileName);
    await copyFile(srcPath, destPath);
    try {
      this.app.svc.media.addMedia(stationId, {
        id: mediaId, title: item.title, artist: item.artist, category: 'music', file: fileName,
        durationMs: null, addedAt: Date.now(), originalName: item.source.file,
      });
    } catch (err) {
      rmSync(destPath, { force: true });
      throw err;
    }
    const staged = await this.registerStationMedia(p, stationId, mediaId);
    this.app.audit.write({ kind: 'musikhub', event: 'item_staged', actor: this.actor(p), sourceItemId: itemId, stagedItemId: staged.id, stationId });
    return staged;
  }
}
