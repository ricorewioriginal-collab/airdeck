// Datenbank nach airdeck.conf öffnen: [database] provider = sqlite | postgres | mysql, url = …
// Passwort wahlweise in der URL oder getrennt über ANMACHA_CAST_DB_PASSWORD (nicht in der Datei;
// bisheriges AIRDECK_DB_PASSWORD funktioniert als Legacy-Fallback weiter).

import { join } from 'node:path';
import { envVar } from '../legacy-branding.ts';
import { migrate, migrateSync } from './schema.ts';
import { SqliteProvider } from './sqlite.ts';
import type { DatabaseProvider } from './types.ts';

export type Provider = 'sqlite' | 'postgres' | 'mysql';
export const PROVIDERS: readonly Provider[] = ['sqlite', 'postgres', 'mysql'];

export interface DatabaseConfig {
  provider: Provider;
  /** sqlite: Dateipfad; postgres/mysql: Verbindungs-URL */
  url: string;
  password?: string;
}

export function databaseConfig(conf: Record<string, string>, env: NodeJS.ProcessEnv, dataDir: string): DatabaseConfig {
  const raw = String(envVar(env, 'DB') ?? conf['database.provider'] ?? 'sqlite').toLowerCase();
  const provider: Provider = raw === 'postgresql' ? 'postgres' : raw === 'mariadb' ? 'mysql' : (PROVIDERS as readonly string[]).includes(raw) ? (raw as Provider) : 'sqlite';
  const url = envVar(env, 'DB_URL') ?? conf['database.url'] ?? (provider === 'sqlite' ? join(dataDir, 'airdeck.db') : '');
  return { provider, url, password: envVar(env, 'DB_PASSWORD') };
}

/** URL ohne Passwort (für Anzeige und Protokoll) */
export function safeUrl(cfg: DatabaseConfig): string {
  if (cfg.provider === 'sqlite') return cfg.url;
  try {
    const u = new URL(cfg.url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(ungültige Adresse)';
  }
}

export async function openDatabase(cfg: DatabaseConfig): Promise<DatabaseProvider> {
  let db: DatabaseProvider;
  if (cfg.provider === 'sqlite') db = new SqliteProvider(cfg.url);
  else {
    if (!cfg.url) throw new Error(`Für ${cfg.provider} fehlt die Verbindungsadresse ([database] url in airdeck.conf oder ANMACHA_CAST_DB_URL)`);
    // Treiber erst bei Bedarf laden – Desktop-Installationen brauchen sie nicht
    db = cfg.provider === 'postgres'
      ? new (await import('./postgres.ts')).PostgresProvider(cfg.url, { password: cfg.password })
      : new (await import('./mysql.ts')).MysqlProvider(cfg.url, { password: cfg.password });
  }
  try {
    await migrate(db);
  } catch (err) {
    await db.close().catch(() => {});
    throw err;
  }
  return db;
}

/** SQLite ohne Warten öffnen (Programmstart, Tests). */
export function openSqliteSync(file: string): SqliteProvider {
  const db = new SqliteProvider(file);
  migrateSync(db);
  return db;
}
