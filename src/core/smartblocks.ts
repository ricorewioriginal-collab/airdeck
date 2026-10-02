// Smart Blocks (wie LibreTime/AzuraCast, nach relay-pro3.js im Control Center): Playlisten aus Regeln
// (Interpret, Titel, Album, Genre, Ordner, Tag, Jahr, Dauer, Kategorie, BPM) - begrenzt nach Anzahl oder
// Minuten, sortiert zufällig/neueste/älteste/alphabetisch/beliebteste. Reine Logik ohne Server-Abhängigkeiten.

import type { MediaItem } from './automation.ts';

export type BlockField = 'artist' | 'title' | 'album' | 'genre' | 'folder' | 'tags' | 'year' | 'durationSec' | 'category' | 'bpm';
export type BlockOp = 'contains' | 'notcontains' | 'is' | 'not' | 'gt' | 'lt' | 'between';
export type BlockOrder = 'random' | 'newest' | 'oldest' | 'alpha' | 'popular' | 'longest' | 'shortest';

export interface BlockRule { field: BlockField; op: BlockOp; value: string; value2?: string }

export interface SmartBlock {
  id: string;
  name: string;
  match: 'all' | 'any';
  rules: BlockRule[];
  order: BlockOrder;
  limit: { by: 'items' | 'minutes'; n: number };
  /** auch Jingles/Sweeper/IDs einbeziehen (sonst nur Musik, Streams und Voicetracks) */
  includeElements: boolean;
}

export const BLOCK_FIELDS: Record<BlockField, string> = {
  artist: 'Interpret', title: 'Titel', album: 'Album', genre: 'Genre', folder: 'Ordner', tags: 'Tag', year: 'Jahr', durationSec: 'Dauer (Sek.)', category: 'Kategorie', bpm: 'BPM',
};
export const BLOCK_OPS: Record<BlockOp, string> = {
  contains: 'enthält', notcontains: 'enthält nicht', is: 'ist', not: 'ist nicht', gt: 'größer als', lt: 'kleiner als', between: 'zwischen',
};
export const BLOCK_ORDERS: Record<BlockOrder, string> = {
  random: 'zufällig', newest: 'neueste zuerst', oldest: 'älteste zuerst', alpha: 'alphabetisch', popular: 'beliebteste zuerst', longest: 'längste zuerst', shortest: 'kürzeste zuerst',
};
const NUMERIC: BlockField[] = ['year', 'durationSec', 'bpm'];
const ELEMENT_CATS = new Set(['jingle', 'sweeper', 'station_id', 'drop', 'ad', 'news', 'tts', 'bed']);

function fieldValue(m: MediaItem, f: BlockField): string | number | string[] | undefined {
  switch (f) {
    case 'artist': return m.artist;
    case 'title': return m.title;
    case 'album': return m.album;
    case 'genre': return m.genre;
    case 'folder': return m.folder ?? '';
    case 'tags': return m.tags ?? [];
    case 'year': return m.year;
    case 'durationSec': return m.durationMs != null ? m.durationMs / 1000 : undefined;
    case 'category': return m.category;
    case 'bpm': return m.bpm;
  }
}

export function ruleMatches(m: MediaItem, r: BlockRule): boolean {
  const v = fieldValue(m, r.field);
  if (NUMERIC.includes(r.field)) {
    const x = typeof v === 'number' ? v : NaN;
    const a = Number(r.value), b = Number(r.value2);
    if (Number.isNaN(x)) return r.op === 'not' || r.op === 'notcontains';
    switch (r.op) {
      case 'gt': return x > a;
      case 'lt': return x < a;
      case 'between': return x >= Math.min(a, b) && x <= Math.max(a, b);
      case 'is': case 'contains': return x === a;
      case 'not': case 'notcontains': return x !== a;
    }
  }
  const needle = r.value.trim().toLowerCase();
  const hay = (Array.isArray(v) ? v : [v ?? '']).map((s) => String(s).toLowerCase());
  switch (r.op) {
    case 'contains': return hay.some((s) => s.includes(needle));
    case 'notcontains': return !hay.some((s) => s.includes(needle));
    case 'is': return hay.some((s) => s === needle);
    case 'not': return !hay.some((s) => s === needle);
    case 'gt': return hay.some((s) => s > needle);
    case 'lt': return hay.some((s) => s < needle);
    case 'between': return hay.some((s) => s >= needle && s <= (r.value2 ?? '').toLowerCase());
  }
}

/**
 * Passende Titel eines Blocks: Regeln (alle/mindestens eine), Reihenfolge, Begrenzung. `plays` = Abspielzahlen
 * je Medien-ID für „beliebteste zuerst“ (z. B. aus dem Play-Log).
 */
export function blockMatch(library: readonly MediaItem[], block: SmartBlock, opts: { plays?: Map<string, number>; random?: () => number; ignoreLimit?: boolean } = {}): MediaItem[] {
  const rules = block.rules.filter((r) => r.value.trim() !== '' || NUMERIC.includes(r.field) && r.value !== '');
  let out = library.filter((m) => {
    if (!block.includeElements && ELEMENT_CATS.has(m.category)) return false;
    if (!rules.length) return true;
    return block.match === 'any' ? rules.some((r) => ruleMatches(m, r)) : rules.every((r) => ruleMatches(m, r));
  });
  const rnd = opts.random ?? Math.random;
  switch (block.order) {
    case 'random': for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; } break;
    case 'newest': out = out.sort((a, b) => b.addedAt - a.addedAt); break;
    case 'oldest': out = out.sort((a, b) => a.addedAt - b.addedAt); break;
    case 'alpha': out = out.sort((a, b) => `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`, 'de')); break;
    case 'popular': out = out.sort((a, b) => (opts.plays?.get(b.id) ?? 0) - (opts.plays?.get(a.id) ?? 0)); break;
    case 'longest': out = out.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)); break;
    case 'shortest': out = out.sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0)); break;
  }
  if (opts.ignoreLimit || !block.limit.n) return out;
  if (block.limit.by === 'minutes') {
    const budget = block.limit.n * 60_000;
    let used = 0;
    const picked: MediaItem[] = [];
    for (const m of out) { const d = m.durationMs ?? 180_000; if (used + d > budget && picked.length) break; picked.push(m); used += d; if (used >= budget) break; }
    return picked;
  }
  return out.slice(0, block.limit.n);
}

/** Eingabe (z. B. aus der API) in einen gültigen Block bringen; wirft bei Unsinn. */
export function normalizeBlock(input: Record<string, unknown>, id: string): SmartBlock {
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('Name fehlt');
  const rules = (Array.isArray(input.rules) ? input.rules : []).slice(0, 12).map((r: Record<string, unknown>) => {
    const field = String(r.field ?? '') as BlockField;
    const op = String(r.op ?? '') as BlockOp;
    if (!(field in BLOCK_FIELDS)) throw new Error(`Unbekanntes Feld „${field}“`);
    if (!(op in BLOCK_OPS)) throw new Error(`Unbekannter Vergleich „${op}“`);
    return { field, op, value: String(r.value ?? '').slice(0, 120), ...(r.value2 != null && r.value2 !== '' ? { value2: String(r.value2).slice(0, 120) } : {}) };
  });
  const order = String(input.order ?? 'random') as BlockOrder;
  const lim = (input.limit && typeof input.limit === 'object' ? input.limit : {}) as { by?: unknown; n?: unknown };
  return {
    id, name, match: input.match === 'any' ? 'any' : 'all', rules,
    order: order in BLOCK_ORDERS ? order : 'random',
    limit: { by: lim.by === 'minutes' ? 'minutes' : 'items', n: Math.max(0, Math.min(10_000, Math.floor(Number(lim.n)) || 0)) },
    includeElements: input.includeElements === true,
  };
}
