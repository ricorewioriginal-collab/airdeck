// Community: Hörer-Umfragen (eine Stimme je Teilnehmer), Formulare (Gewinnspiel, Anmeldung, Feedback) mit
// Einträgen und CSV, Auslosung (Normal / Multi / Elimination) mit Gewinner-Protokoll - nach poll.html,
// form.html und auslosung.html im AnMaCha Control Center.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { AnMaChaCastApp } from '../app.ts';
import { AppError, newId, type Principal } from '../model.ts';

export interface Poll {
  id: string;
  question: string;
  options: string[];
  active: boolean;
  createdAt: number;
  closedAt?: number;
  results: number[];
  /** Hashes der Teilnehmer (zufälliger Client-Schlüssel oder Adresse, mit Salz je Umfrage) */
  voters: string[];
  salt: string;
}

export type FieldType = 'text' | 'textarea' | 'select' | 'email';
export interface FormField { key: string; label: string; type: FieldType; required: boolean; options?: string[] }
export interface FormDef { id: string; title: string; description: string; fields: FormField[]; active: boolean; createdAt: number; thanks: string }
export interface FormEntry { id: string; formId: string; at: number; values: Record<string, string> }

export type DrawMode = 'normal' | 'multi' | 'elim';
export interface DrawEntry { id: string; at: number; mode: DrawMode; winners: string[]; pool: number; label?: string }

const MAX_POLLS = 50;
const MAX_FORMS = 30;
const MAX_ENTRIES = 3000;
const MAX_DRAWS = 500;
const MAX_VOTERS = 50_000;
/** Grenzen je Absender: [Anzahl, Zeitraum ms] */
const LIMITS: Record<string, [number, number]> = { vote: [20, 10 * 60_000], submit: [5, 10 * 60_000] };

function clean(v: unknown, max: number): string {
  return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
/** CSV-Zelle: Anführungszeichen verdoppeln; Zellen, die Excel/LibreOffice als Formel lesen würden, mit Apostroph entschärfen. */
export const csvCell = (v: unknown): string => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** Zufällige Auswahl ohne Zurücklegen (kryptografisch, fair). */
export function pickWinners(pool: string[], count: number): string[] {
  const rest = [...pool];
  const out: string[] = [];
  while (rest.length && out.length < count) out.push(rest.splice(randomInt(rest.length), 1)[0]!);
  return out;
}

/** Teilnehmerliste: eine je Zeile, optional ohne Dubletten (Groß/Klein egal). */
export function parseNames(text: string, unique: boolean): string[] {
  const names = text.split(/\r?\n/).map((n) => clean(n, 80)).filter(Boolean);
  if (!unique) return names.slice(0, 5000);
  const seen = new Set<string>();
  return names.filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5000);
}

export class CommunityService {
  private readonly app: AnMaChaCastApp;
  private readonly hits = new Map<string, number[]>();

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private limit(sid: string, kind: string, ip: string): void {
    const [n, win] = LIMITS[kind]!;
    const key = `${sid}:${kind}:${createHash('sha256').update(ip).digest('base64url').slice(0, 16)}`;
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < win);
    if (list.length >= n) throw new AppError(429, 'rate_limited', 'Zu viele Anfragen - bitte später noch einmal');
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 20_000) this.hits.clear();
  }

  // ---------- Umfragen ----------

  polls(sid: string): Omit<Poll, 'voters' | 'salt'>[] {
    return (this.app.rt(sid).data.polls ?? []).map(({ voters, salt: _s, ...p }) => ({ ...p, votes: voters.length })).reverse().sort((a, b) => b.createdAt - a.createdAt);
  }

  savePoll(p: Principal, sid: string, id: string | null, input: Record<string, unknown>): Omit<Poll, 'voters' | 'salt'> {
    const rt = this.app.rt(sid);
    const list = (rt.data.polls ??= []);
    const cur = id ? list.find((x) => x.id === id) : undefined;
    if (id && !cur) throw new AppError(404, 'not_found', 'Umfrage nicht gefunden');
    const question = input.question !== undefined ? clean(input.question, 200) : cur?.question ?? '';
    if (!question) throw new AppError(400, 'empty_question', 'Frage fehlt');
    let options = cur?.options ?? [];
    if (Array.isArray(input.options) || !cur) {
      options = (Array.isArray(input.options) ? input.options : []).map((o) => clean(o, 80)).filter(Boolean).slice(0, 10);
      if (options.length < 2) throw new AppError(400, 'few_options', 'Mindestens zwei Antworten');
      // Ergebnisse hängen an der Position: nach der ersten Stimme bleiben die Antworten exakt so, wie sie sind
      if (cur && cur.voters.length && (options.length !== cur.options.length || options.some((o, i) => o !== cur.options[i]))) throw new AppError(409, 'has_votes', 'Antworten lassen sich nach den ersten Stimmen nicht mehr ändern - neue Umfrage anlegen');
    }
    const active = typeof input.active === 'boolean' ? input.active : cur?.active ?? true;
    const poll: Poll = cur ?? { id: newId('poll'), question, options, active, createdAt: Date.now(), results: options.map(() => 0), voters: [], salt: randomBytes(8).toString('base64url') };
    if (!cur) {
      if (list.length >= MAX_POLLS) throw new AppError(409, 'limit', `Höchstens ${MAX_POLLS} Umfragen - alte löschen`);
      list.push(poll);
    } else {
      poll.question = question;
      if (options !== cur.options) { poll.options = options; poll.results = options.map((_, i) => cur.results[i] ?? 0); }
    }
    // nur eine Umfrage gleichzeitig aktiv: die neue/aktivierte löst die anderen ab
    if (active) for (const x of list) if (x !== poll && x.active) { x.active = false; x.closedAt = Date.now(); }
    if (!active && poll.active) poll.closedAt = Date.now();
    poll.active = active;
    this.app.audit.write({ kind: 'community', event: cur ? 'poll_updated' : 'poll_created', actor: p.id, stationId: sid, poll: poll.id, active });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
    const { voters, salt: _s, ...view } = poll;
    return { ...view, votes: voters.length } as Omit<Poll, 'voters' | 'salt'>;
  }

  deletePoll(p: Principal, sid: string, id: string): void {
    const rt = this.app.rt(sid);
    const before = rt.data.polls?.length ?? 0;
    rt.data.polls = (rt.data.polls ?? []).filter((x) => x.id !== id);
    if ((rt.data.polls.length) === before) throw new AppError(404, 'not_found', 'Umfrage nicht gefunden');
    this.app.audit.write({ kind: 'community', event: 'poll_deleted', actor: p.id, stationId: sid, poll: id });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
  }

  pollCsv(sid: string, id: string): string {
    const poll = (this.app.rt(sid).data.polls ?? []).find((x) => x.id === id);
    if (!poll) throw new AppError(404, 'not_found', 'Umfrage nicht gefunden');
    const total = poll.results.reduce((a, b) => a + b, 0);
    return ['Antwort;Stimmen;Anteil', ...poll.options.map((o, i) => [o, poll.results[i] ?? 0, total ? `${Math.round(((poll.results[i] ?? 0) / total) * 100)} %` : '0 %'].map(csvCell).join(';'))].join('\r\n');
  }

  /** Öffentlich: die aktive Umfrage mit Ergebnissen (ohne Teilnehmer). */
  publicPoll(sid: string): { poll: { id: string; question: string; options: string[]; results: number[]; total: number } | null } {
    this.app.svc.listeners.requireFeature(sid, 'polls');
    const p = (this.app.rt(sid).data.polls ?? []).find((x) => x.active);
    return { poll: p ? { id: p.id, question: p.question, options: p.options, results: p.results, total: p.results.reduce((a, b) => a + b, 0) } : null };
  }

  votePoll(sid: string, ip: string, input: Record<string, unknown>): { ok: true; results: number[]; total: number } {
    this.app.svc.listeners.requireFeature(sid, 'polls');
    this.limit(sid, 'vote', ip);
    const p = (this.app.rt(sid).data.polls ?? []).find((x) => x.id === String(input.pollId ?? ''));
    if (!p || !p.active) throw new AppError(404, 'not_found', 'Diese Umfrage läuft nicht mehr');
    const idx = Number(input.option);
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.options.length) throw new AppError(400, 'invalid_option', 'Antwort unbekannt');
    const who = createHash('sha256').update(p.salt).update(clean(input.voter, 64) || ip).digest('base64url').slice(0, 20);
    if (p.voters.includes(who)) throw new AppError(409, 'already_voted', 'Du hast bei dieser Umfrage schon abgestimmt');
    if (p.voters.length >= MAX_VOTERS) throw new AppError(409, 'full', 'Umfrage ist voll');
    p.voters.push(who);
    p.results[idx] = (p.results[idx] ?? 0) + 1;
    this.app.publish('community.changed', sid, { kind: 'poll', id: p.id });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
    return { ok: true, results: p.results, total: p.results.reduce((a, b) => a + b, 0) };
  }

  // ---------- Formulare ----------

  forms(sid: string): (FormDef & { entries: number })[] {
    const entries = this.app.rt(sid).data.formEntries ?? [];
    return (this.app.rt(sid).data.forms ?? []).map((f) => ({ ...f, entries: entries.filter((e) => e.formId === f.id).length })).reverse().sort((a, b) => b.createdAt - a.createdAt);
  }

  saveForm(p: Principal, sid: string, id: string | null, input: Record<string, unknown>): FormDef {
    const rt = this.app.rt(sid);
    const list = (rt.data.forms ??= []);
    const cur = id ? list.find((x) => x.id === id) : undefined;
    if (id && !cur) throw new AppError(404, 'not_found', 'Formular nicht gefunden');
    const title = input.title !== undefined ? clean(input.title, 120) : cur?.title ?? '';
    if (!title) throw new AppError(400, 'empty_title', 'Titel fehlt');
    let fields = cur?.fields ?? [];
    if (Array.isArray(input.fields) || !cur) {
      const keys = new Set<string>();
      const old = cur?.fields ?? [];
      fields = (Array.isArray(input.fields) ? input.fields : []).map((f: Record<string, unknown>, i: number) => {
        const label = clean(f.label, 80) || `Feld ${i + 1}`;
        // Schlüssel bleiben stabil, damit vorhandene Einträge beim Umbenennen nicht ihre Werte verlieren:
        // explizit mitgegeben → gleicher Text → gleiche Position, sonst neu aus dem Label
        const prev = old.find((x) => x.key === clean(f.key, 40)) ?? old.find((x) => x.label.toLowerCase() === label.toLowerCase());
        let key = prev?.key ?? (clean(f.key, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || label.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_').slice(0, 40));
        while (keys.has(key)) key += '_';
        keys.add(key);
        const type: FieldType = (['text', 'textarea', 'select', 'email'] as const).includes(f.type as FieldType) ? (f.type as FieldType) : 'text';
        const options = type === 'select' ? (Array.isArray(f.options) ? f.options.map((o) => clean(o, 80)).filter(Boolean).slice(0, 30) : []) : undefined;
        if (type === 'select' && !options?.length) throw new AppError(400, 'no_options', `Auswahlfeld „${label}“ braucht Optionen`);
        return { key, label, type, required: f.required === true, ...(options ? { options } : {}) };
      }).slice(0, 20);
      // Umbenannte Felder ohne Treffer: der Reihe nach die noch freien alten Schlüssel gleichen Typs übernehmen,
      // damit vorhandene Einträge auch bei „umbenennen + Feld hinzufügen“ ihre Werte behalten
      const usedKeys = new Set(fields.map((f) => f.key));
      const free = old.filter((x) => !usedKeys.has(x.key));
      for (const f of fields) {
        if (old.some((x) => x.key === f.key)) continue;
        const idx = free.findIndex((x) => x.type === f.type);
        if (idx < 0) continue;
        f.key = free.splice(idx, 1)[0]!.key;
      }
      if (!fields.length) throw new AppError(400, 'no_fields', 'Mindestens ein Feld');
    }
    const form: FormDef = cur ?? { id: newId('form'), title, description: '', fields, active: true, createdAt: Date.now(), thanks: 'Danke, dein Eintrag ist angekommen!' };
    if (!cur) {
      if (list.length >= MAX_FORMS) throw new AppError(409, 'limit', `Höchstens ${MAX_FORMS} Formulare`);
      list.push(form);
    }
    form.title = title;
    form.fields = fields;
    if (typeof input.description === 'string') form.description = clean(input.description, 500);
    if (typeof input.thanks === 'string') form.thanks = clean(input.thanks, 200) || form.thanks;
    if (typeof input.active === 'boolean') form.active = input.active;
    this.app.audit.write({ kind: 'community', event: cur ? 'form_updated' : 'form_created', actor: p.id, stationId: sid, form: form.id });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
    return form;
  }

  deleteForm(p: Principal, sid: string, id: string): void {
    const rt = this.app.rt(sid);
    const before = rt.data.forms?.length ?? 0;
    rt.data.forms = (rt.data.forms ?? []).filter((x) => x.id !== id);
    if (rt.data.forms.length === before) throw new AppError(404, 'not_found', 'Formular nicht gefunden');
    rt.data.formEntries = (rt.data.formEntries ?? []).filter((e) => e.formId !== id);
    this.app.audit.write({ kind: 'community', event: 'form_deleted', actor: p.id, stationId: sid, form: id });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
  }

  entries(sid: string, formId: string): FormEntry[] {
    return (this.app.rt(sid).data.formEntries ?? []).filter((e) => e.formId === formId).reverse().sort((a, b) => b.at - a.at);
  }

  deleteEntry(p: Principal, sid: string, id: string): void {
    const rt = this.app.rt(sid);
    const before = rt.data.formEntries?.length ?? 0;
    rt.data.formEntries = (rt.data.formEntries ?? []).filter((e) => e.id !== id);
    if (rt.data.formEntries.length === before) throw new AppError(404, 'not_found', 'Eintrag nicht gefunden');
    this.app.audit.write({ kind: 'community', event: 'entry_deleted', actor: p.id, stationId: sid, entry: id });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
  }

  entriesCsv(sid: string, formId: string): string {
    const form = (this.app.rt(sid).data.forms ?? []).find((f) => f.id === formId);
    if (!form) throw new AppError(404, 'not_found', 'Formular nicht gefunden');
    const rows = this.entries(sid, formId);
    return ['Zeit', ...form.fields.map((f) => f.label)].map(csvCell).join(';') + '\r\n'
      + rows.map((e) => [new Date(e.at).toISOString(), ...form.fields.map((f) => e.values[f.key] ?? '')].map(csvCell).join(';')).join('\r\n');
  }

  /** Öffentlich: ein Formular (id) oder alle aktiven - ohne interne Felder. */
  publicForm(sid: string, id: string | null): { forms: { id: string; title: string; description: string; fields: FormField[] }[] } {
    this.app.svc.listeners.requireFeature(sid, 'forms');
    const all = (this.app.rt(sid).data.forms ?? []).filter((f) => f.active && (!id || f.id === id));
    return { forms: all.map((f) => ({ id: f.id, title: f.title, description: f.description, fields: f.fields })) };
  }

  submitForm(sid: string, ip: string, input: Record<string, unknown>): { ok: true; thanks: string } {
    this.app.svc.listeners.requireFeature(sid, 'forms');
    const rt = this.app.rt(sid);
    const form = (rt.data.forms ?? []).find((f) => f.id === String(input.formId ?? '') && f.active);
    if (!form) throw new AppError(404, 'not_found', 'Dieses Formular ist nicht mehr offen');
    const raw = (input.values && typeof input.values === 'object' ? input.values : {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const f of form.fields) {
      const v = clean(raw[f.key], f.type === 'textarea' ? 2000 : 200);
      if (f.required && !v) throw new AppError(400, 'missing', `„${f.label}“ fehlt`);
      if (v && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new AppError(400, 'invalid_email', `„${f.label}“: keine gültige E-Mail-Adresse`);
      if (v && f.type === 'select' && !f.options?.includes(v)) throw new AppError(400, 'invalid_option', `„${f.label}“: Auswahl unbekannt`);
      values[f.key] = v;
    }
    this.limit(sid, 'submit', ip); // zählt nur angenommene Einträge - Tippfehler kosten keine Versuche
    const list = (rt.data.formEntries ??= []);
    list.push({ id: newId('entry'), formId: form.id, at: Date.now(), values });
    if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
    this.app.publish('community.changed', sid, { kind: 'form', id: form.id });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
    return { ok: true, thanks: form.thanks };
  }

  // ---------- Auslosung ----------

  /**
   * Ziehen: normal = ein Gewinner, multi = n Gewinner ohne Zurücklegen, elim = alle bis auf einen fallen raus (der letzte gewinnt).
   * Die Teilnehmer bleiben beim Sender privat; ins Protokoll wandern nur Gewinner, Modus und Anzahl.
   */
  draw(p: Principal, sid: string, input: Record<string, unknown>): { winners: string[]; mode: DrawMode; pool: number; remaining: string[]; entry: DrawEntry } {
    const names = Array.isArray(input.names) ? input.names.map((n) => clean(n, 80)).filter(Boolean) : parseNames(String(input.text ?? ''), input.unique !== false);
    if (names.length < 2) throw new AppError(400, 'few_names', 'Mindestens zwei Teilnehmer');
    const mode: DrawMode = input.mode === 'multi' ? 'multi' : input.mode === 'elim' ? 'elim' : 'normal';
    const count = mode === 'multi' ? Math.max(1, Math.min(names.length, Math.floor(Number(input.count)) || 3)) : 1;
    let winners: string[];
    let remaining: string[];
    if (mode === 'elim') {
      // Elimination: zufällig einen nach dem anderen streichen, der Letzte bleibt - Reihenfolge der Ausgeschiedenen kommt mit
      const order = pickWinners(names, names.length);
      winners = [order[order.length - 1]!];
      remaining = order.slice(0, -1);
    } else {
      winners = pickWinners(names, count);
      remaining = names.filter((n) => !winners.includes(n));
    }
    const entry: DrawEntry = { id: newId('draw'), at: Date.now(), mode, winners, pool: names.length, ...(clean(input.label, 80) ? { label: clean(input.label, 80) } : {}) };
    const rt = this.app.rt(sid);
    (rt.data.draws ??= []).push(entry);
    if (rt.data.draws.length > MAX_DRAWS) rt.data.draws.splice(0, rt.data.draws.length - MAX_DRAWS);
    this.app.audit.write({ kind: 'community', event: 'draw', actor: p.id, stationId: sid, mode, pool: names.length, winners: winners.length });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
    return { winners, mode, pool: names.length, remaining, entry };
  }

  draws(sid: string): DrawEntry[] {
    return [...(this.app.rt(sid).data.draws ?? [])].reverse();
  }

  clearDraws(p: Principal, sid: string): void {
    this.app.rt(sid).data.draws = [];
    this.app.audit.write({ kind: 'community', event: 'draws_cleared', actor: p.id, stationId: sid });
    this.app.changed();
    this.app.publish('community.changed', sid, { kind: 'operator' });
  }

  drawsCsv(sid: string): string {
    return ['Zeit;Modus;Gewinner;Teilnehmer;Bezeichnung', ...this.draws(sid).map((d) => [new Date(d.at).toISOString(), d.mode, d.winners.join(', '), d.pool, d.label ?? ''].map(csvCell).join(';'))].join('\r\n');
  }
}
