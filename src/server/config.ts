// Konfigurations- und Pfadmodell (docs/architecture/STORAGE.md, ARCHITECTURE.md §2).
// Eine Datei anmachacast.conf (bisher airdeck.conf, wird weiter gelesen) (Schlüssel = Wert, Abschnitte in [eckigen Klammern]) beschreibt Betriebsart,
// Netzwerk und Pfade. Umgebungsvariablen haben Vorrang, fehlende Werte fallen auf die bisherigen
// Standardorte zurück – bestehende Installationen laufen unverändert weiter.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { databaseConfig, type DatabaseConfig } from './db/index.ts';
import { envVar } from './legacy-branding.ts';

export type Mode = 'local' | 'server' | 'hybrid';
export const MODES: readonly Mode[] = ['local', 'server', 'hybrid'];
/** API-Hauptversion: Client und Server vergleichen sie (NETWORK.md „Kompatibilität“) */
export const API_VERSION = '1.0';

export interface AnMaChaCastConfig {
  mode: Mode;
  port: number;
  host: string;
  /** Datei, aus der gelesen wurde (bzw. die beim ersten Start angelegt wird) */
  configFile: string;
  /** true = systemweite Installation (Dienst/Paket), false = Benutzer-/Portable-Installation */
  system: boolean;
  paths: { config: string; data: string; media: string; logs: string; backups: string };
  database: DatabaseConfig;
}

export interface ResolveInput {
  env: NodeJS.ProcessEnv;
  root: string;
  packaged: boolean;
  desktop: boolean;
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (p: string) => boolean;
  read?: (p: string) => string;
}

/** INI-artig: `# Kommentar`, `[abschnitt]`, `schluessel = wert` → { 'abschnitt.schluessel': 'wert' } */
export function parseConf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = '';
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[([\w.-]+)\]$/.exec(line);
    if (sec) {
      section = sec[1]!.toLowerCase();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out[section ? `${section}.${key}` : key] = value;
  }
  return out;
}

/** Konfigurationsdatei: neuer Name zuerst, der bisherige Name bleibt als Fallback lesbar. */
export const CONF_NAME = 'anmachacast.conf';
export const LEGACY_CONF_NAME = 'airdeck.conf';

/** Vorhandene Konfigurationsdatei in einem Ordner (neuer Name vor altem), sonst null. */
function confIn(dir: string, exists: (p: string) => boolean): string | null {
  for (const n of [CONF_NAME, LEGACY_CONF_NAME]) if (exists(join(dir, n))) return join(dir, n);
  return null;
}

/**
 * Datenordner der Benutzerinstallation. Neue Installationen nutzen "AnMaChaCast" (Windows) bzw. ".anmachacast";
 * liegt dort noch nichts, aber unter dem bisherigen Namen ("AirDeck"/".airdeck") schon ein Datenordner, wird dieser
 * weiterverwendet - bestehende Senderdaten (Musik, Datenbank, verschlüsselte Passwörter) bleiben so ohne
 * Verschieben erhalten (siehe docs/REBRANDING_ANMACHA_CAST.md).
 */
export function legacyDataDir(root: string, packaged: boolean, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string, exists: (p: string) => boolean = existsSync): string {
  if (!packaged) return join(root, 'data');
  const pick = (fresh: string, old: string) => (!exists(fresh) && exists(old) ? old : fresh);
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return pick(join(local, 'AnMaChaCast', 'data'), join(local, 'AirDeck', 'data'));
  }
  return pick(join(home, '.anmachacast', 'data'), join(home, '.airdeck', 'data'));
}

/** Systemweite Orte (Dienst/Paket): neues Layout "anmachacast", das bisherige "airdeck" für noch nicht migrierte Installationen. */
function systemLayouts(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): AnMaChaCastConfig['paths'][] {
  if (platform === 'win32') {
    const pd = env.ProgramData ?? env.PROGRAMDATA ?? 'C:\\ProgramData';
    return ['AnMaChaCast', 'AirDeck'].map((n) => {
      const base = join(pd, n);
      return { config: join(base, 'config'), data: join(base, 'data'), media: join(base, 'media'), logs: join(base, 'logs'), backups: join(base, 'backups') };
    });
  }
  return ['anmachacast', 'airdeck'].map((n) => ({ config: `/etc/${n}`, data: `/var/lib/${n}`, media: `/var/lib/${n}/media`, logs: `/var/log/${n}`, backups: `/var/lib/${n}/backups` }));
}

export function resolveConfig(input: ResolveInput): AnMaChaCastConfig {
  const { env, root, packaged, desktop } = input;
  const platform = input.platform ?? process.platform;
  const home = input.home ?? homedir();
  const exists = input.exists ?? existsSync;
  const read = input.read ?? ((p: string) => readFileSync(p, 'utf8'));

  // Systemweite Installation: das Layout, in dem eine Konfigurationsdatei liegt (neues zuerst)
  let sys = systemLayouts(platform, env)[0]!;
  let sysFile: string | null = null;
  for (const layout of systemLayouts(platform, env)) {
    const f = confIn(layout.config, exists);
    if (f) {
      sys = layout;
      sysFile = f;
      break;
    }
  }
  // Reihenfolge: ausdrücklich angegeben → systemweite Installation → Datenordner der Benutzerinstallation
  const legacyData = resolve(envVar(env, 'DATA') ?? legacyDataDir(root, packaged, platform, env, home, exists));
  let configFile: string;
  let system = false;
  if (envVar(env, 'CONFIG')) configFile = resolve(envVar(env, 'CONFIG')!);
  else if (!envVar(env, 'DATA') && sysFile) {
    configFile = sysFile;
    system = true;
  } else configFile = confIn(join(legacyData, 'config'), exists) ?? join(legacyData, 'config', CONF_NAME);

  let conf: Record<string, string> = {};
  try {
    if (exists(configFile)) conf = parseConf(read(configFile));
  } catch {
    // unlesbar → Standardwerte; der Health-Check meldet den Speicherzustand
  }
  const confDir = dirname(configFile);
  const pathOf = (v: string | undefined) => (v ? (isAbsolute(v) ? v : resolve(confDir, v)) : undefined);

  const data = resolve(envVar(env, 'DATA') ?? pathOf(conf['paths.data']) ?? (system ? sys.data : legacyData));
  const paths = {
    config: confDir,
    data,
    // Medien lagen bisher unter <daten>/media – das bleibt der Standard außerhalb systemweiter Installationen
    media: resolve(envVar(env, 'MEDIA') ?? pathOf(conf['paths.media']) ?? (system ? sys.media : join(data, 'media'))),
    logs: resolve(envVar(env, 'LOGS') ?? pathOf(conf['paths.logs']) ?? (system ? sys.logs : join(data, 'logs'))),
    backups: resolve(pathOf(conf['paths.backups']) ?? (system ? sys.backups : join(data, 'backups'))),
  };

  const modeRaw = String(envVar(env, 'MODE') ?? conf.mode ?? conf['anmachacast.mode'] ?? conf['airdeck.mode'] ?? '').toLowerCase();
  // Ohne Angabe wie bisher: Desktop-Programm = Local, ohne Fenster (Dienst/Docker) = Server
  const mode: Mode = (MODES as readonly string[]).includes(modeRaw) ? (modeRaw as Mode) : desktop ? 'local' : 'server';

  const portRaw = Number(envVar(env, 'PORT') ?? conf['network.port'] ?? 8750);
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536 ? portRaw : 8750;

  // bind = local | lan | <Adresse>; ohne Angabe gilt die LAN-Einstellung aus dem Studio (network.json)
  const bind = String(conf['network.bind'] ?? '').toLowerCase();
  let host = envVar(env, 'HOST');
  if (!host) {
    if (bind === 'lan' || bind === 'all') host = '0.0.0.0';
    else if (bind === 'local' || bind === '') host = bind === '' && readLan(join(data, 'network.json'), exists, read) ? '0.0.0.0' : '127.0.0.1';
    else host = bind;
  }
  // Relative SQLite-Pfade gelten ab dem Konfigurationsordner
  const database = databaseConfig({ ...conf, ...(conf['database.url'] && !conf['database.url'].includes('://') ? { 'database.url': pathOf(conf['database.url'])! } : {}) }, env, data);
  return { mode, port, host, configFile, system, paths, database };
}

function readLan(file: string, exists: (p: string) => boolean, read: (p: string) => string): boolean {
  try {
    return exists(file) && (JSON.parse(read(file).replace(/^\uFEFF/, '')) as { lan?: boolean }).lan === true;
  } catch {
    return false;
  }
}

/** Legt beim ersten Start eine kommentierte anmachacast.conf an (nur wenn keine Konfigurationsdatei existiert). */
export function writeDefaultConf(cfg: AnMaChaCastConfig): boolean {
  if (existsSync(cfg.configFile)) return false;
  try {
    mkdirSync(dirname(cfg.configFile), { recursive: true });
    writeFileSync(cfg.configFile, [
      '# AnMaCha Cast – Grundeinstellungen. Änderungen wirken nach einem Neustart.',
      '# Umgebungsvariablen (ANMACHA_CAST_MODE, ANMACHA_CAST_PORT, ANMACHA_CAST_HOST, ANMACHA_CAST_DATA,',
      '# ANMACHA_CAST_MEDIA; bisherige AIRDECK_*-Namen funktionieren als Legacy-Fallback weiter) haben Vorrang.',
      '',
      '# local = alles auf diesem PC · server = Self-Hosted · hybrid = lokal senden, mit Server abgleichen',
      '# Ohne Angabe: Programm mit Fenster = local, ohne Fenster (Dienst, Docker, --headless) = server',
      '# mode = local',
      '',
      '[network]',
      `port = ${cfg.port}`,
      '# local = nur dieser PC · lan = im Netzwerk erreichbar · oder eine feste Adresse',
      '# (leer lassen = Einstellung im Studio unter „Netzwerk“)',
      '# bind = local',
      '',
      '[paths]',
      '# Relative Pfade gelten ab diesem Ordner.',
      `# data = ${cfg.paths.data}`,
      `# media = ${cfg.paths.media}`,
      `# logs = ${cfg.paths.logs}`,
      `# backups = ${cfg.paths.backups}`,
      '',
      '[database]',
      '# sqlite (Standard, Datei im Datenordner) · postgres · mysql (auch MariaDB)',
      '# Passwort besser nicht hier, sondern in der Umgebungsvariablen ANMACHA_CAST_DB_PASSWORD.',
      `# provider = ${cfg.database.provider}`,
      '# url = postgres://airdeck@localhost:5432/airdeck',
      '',
    ].join('\n'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Programmversion: im Build eingebettet, in der Entwicklung aus package.json. */
export function appVersion(root: string): string {
  if (globalThis.__ANMACHACAST_VERSION) return globalThis.__ANMACHACAST_VERSION;
  try {
    return String((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

declare global {
  // wird im gebündelten Build per Banner gesetzt (scripts/build.mjs)
  var __ANMACHACAST_VERSION: string | undefined;
}

/**
 * Werte in der Konfigurationsdatei (anmachacast.conf) setzen, ohne Kommentare und übrige Einträge zu verlieren
 * (Setup-Assistent, Administration). Schlüssel wie beim Lesen: „mode“, „network.port“, „database.url“ …
 * null entfernt einen Eintrag.
 */
export function updateConf(file: string, patch: Record<string, string | number | null>): void {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/) : [];
  const todo = new Map(Object.entries(patch));
  const sectionOf = (k: string) => (k.includes('.') ? k.slice(0, k.indexOf('.')) : '');
  const keyOf = (k: string) => (k.includes('.') ? k.slice(k.indexOf('.') + 1) : k);
  let section = '';
  const out: string[] = [];
  const flush = (sec: string) => {
    // noch nicht gesetzte Schlüssel dieses Abschnitts am Abschnittsende einfügen
    for (const [k, v] of [...todo]) {
      if (sectionOf(k) !== sec || v === null) continue;
      out.push(`${keyOf(k)} = ${v}`);
      todo.delete(k);
    }
  };
  for (const line of lines) {
    const sec = /^\s*\[([\w.-]+)\]\s*$/.exec(line);
    if (sec) {
      // Leerzeilen am Abschnittsende behalten die Einfügung vor dem nächsten Abschnitt
      const trail: string[] = [];
      while (out.length && out[out.length - 1]!.trim() === '') trail.unshift(out.pop()!);
      flush(section);
      out.push(...trail);
      section = sec[1]!.toLowerCase();
      out.push(line);
      continue;
    }
    const kv = /^\s*([\w.-]+)\s*=/.exec(line);
    const full = kv ? (section ? `${section}.${kv[1]!.toLowerCase()}` : kv[1]!.toLowerCase()) : null;
    if (full && todo.has(full)) {
      const v = todo.get(full)!;
      todo.delete(full);
      if (v !== null) out.push(`${kv![1]} = ${v}`);
      continue;
    }
    out.push(line);
  }
  const trail: string[] = [];
  while (out.length && out[out.length - 1]!.trim() === '') trail.unshift(out.pop()!);
  flush(section);
  out.push(...trail);
  // Schlüssel für Abschnitte, die es noch nicht gibt
  const rest = new Map<string, string[]>();
  for (const [k, v] of todo) {
    if (v === null) continue;
    const sec = sectionOf(k);
    if (!rest.has(sec)) rest.set(sec, []);
    rest.get(sec)!.push(`${keyOf(k)} = ${v}`);
  }
  for (const [sec, kvs] of rest) {
    if (sec === '') out.unshift(...kvs);
    else out.push(...(out.length && out[out.length - 1]!.trim() !== '' ? [''] : []), `[${sec}]`, ...kvs);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out.join('\n').replace(/\n*$/, '\n'), 'utf8');
}

