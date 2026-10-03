// Community: Umfragen (eine Stimme je Teilnehmer), Formulare mit Einträgen/CSV, Auslosung mit Protokoll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { parseNames, pickWinners } from '../src/server/services/community.ts';

test('Auslosung: faire Auswahl ohne Zurücklegen, Namensliste ohne Dubletten', () => {
  const pool = ['Anna', 'Ben', 'Cem', 'Dana'];
  const w = pickWinners(pool, 3);
  assert.equal(w.length, 3);
  assert.equal(new Set(w).size, 3, 'keine Doppelten');
  assert.ok(w.every((x) => pool.includes(x)));
  assert.equal(pickWinners(pool, 10).length, 4, 'nie mehr als vorhanden');
  assert.deepEqual(parseNames('Anna\nben, Anna; Cem\n\n  Ben ', true), ['Anna', 'ben', 'Cem']);
  assert.deepEqual(parseNames('Anna\nanna', false), ['Anna', 'anna']);
});

test('Umfragen, Formulare, Auslosung: Studio-API und öffentliche Hörer-Endpunkte', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-community-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = app.svc.auth.createToken({ name: 't', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const admin = app.svc.auth.authenticate(token)!;
  const api = async (m: string, p: string, body?: unknown) => { const r = await fetch(`${root}/api/v1/stations/main${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: (await r.json().catch(() => null)) as any, text: '' }; };
  const pub = async (m: string, p: string, body?: unknown) => { const r = await fetch(`${root}/api/v1/public/stations/main/listener${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: (await r.json().catch(() => null)) as any }; };
  try {
    // Umfrage anlegen: Validierung, nur eine aktiv
    assert.equal((await api('POST', '/polls', { question: 'Lieblingsjahrzehnt?', options: ['80er'] })).status, 400, 'zwei Antworten nötig');
    const p1 = (await api('POST', '/polls', { question: 'Lieblingsjahrzehnt?', options: ['80er', '90er', '2000er'] })).body;
    const p2 = (await api('POST', '/polls', { question: 'Zweite', options: ['A', 'B'] })).body;
    let list = (await api('GET', '/polls')).body as { id: string; active: boolean }[];
    assert.deepEqual(list.map((p) => [p.id === p2.id, p.active]), [[true, true], [false, false]], 'neue aktive Umfrage löst die alte ab');
    await api('PATCH', `/polls/${p1.id}`, { active: true });

    // Öffentlich erst nach Freischaltung
    assert.equal((await pub('GET', '/poll')).status, 404);
    app.svc.listeners.setConfig(admin, 'main', { polls: true, forms: true });
    const active = (await pub('GET', '/poll')).body.poll;
    assert.equal(active.id, p1.id);
    assert.deepEqual(active.results, [0, 0, 0]);
    // Abstimmen: eine Stimme je Teilnehmer-Schlüssel, ungültige Antwort abgewiesen
    assert.equal((await pub('POST', '/poll/vote', { pollId: p1.id, option: 1, voter: 'k1' })).body.results[1], 1);
    assert.equal((await pub('POST', '/poll/vote', { pollId: p1.id, option: 2, voter: 'k1' })).status, 409);
    assert.equal((await pub('POST', '/poll/vote', { pollId: p1.id, option: 9, voter: 'k2' })).status, 400);
    assert.equal((await pub('POST', '/poll/vote', { pollId: p1.id, option: 1, voter: 'k2' })).body.total, 2);
    assert.equal((await pub('POST', '/poll/vote', { pollId: p2.id, option: 0, voter: 'k3' })).status, 404, 'inaktive Umfrage');
    assert.equal((await api('PATCH', `/polls/${p1.id}`, { options: ['x', 'y'] })).status, 409, 'Antwortzahl nach Stimmen fest');
    const csv = await (await fetch(`${root}/api/v1/stations/main/polls/${p1.id}/csv`, { headers: { Authorization: `Bearer ${token}` } })).text();
    assert.match(csv, /"90er";"2";"100 %"/);
    list = (await api('GET', '/polls')).body;
    assert.equal((list.find((p) => p.id === p1.id) as any).votes, 2);
    assert.equal((await api('DELETE', `/polls/${p2.id}`)).status, 200);

    // Formular: Felder, Pflicht, E-Mail, Auswahl, Einträge, CSV
    const f = (await api('POST', '/forms', { title: 'Gewinnspiel', description: 'Karten fürs Stadtfest', fields: [
      { label: 'Name', type: 'text', required: true }, { label: 'E-Mail', type: 'email', required: true }, { label: 'Genre', type: 'select', options: ['Pop', 'Rock'] }, { label: 'Nachricht', type: 'textarea' },
    ] })).body;
    assert.deepEqual(f.fields.map((x: { key: string }) => x.key), ['name', 'e_mail', 'genre', 'nachricht']);
    assert.equal((await api('POST', '/forms', { title: 'x', fields: [{ label: 'Wahl', type: 'select' }] })).status, 400, 'Auswahl ohne Optionen');
    const shown = (await pub('GET', '/form')).body.forms;
    assert.equal(shown.length, 1);
    assert.equal(shown[0].title, 'Gewinnspiel');
    assert.equal((await pub('POST', '/form/submit', { formId: f.id, values: { name: 'Anna' } })).status, 400, 'E-Mail fehlt');
    assert.equal((await pub('POST', '/form/submit', { formId: f.id, values: { name: 'Anna', e_mail: 'kaputt' } })).status, 400, 'E-Mail ungültig');
    assert.equal((await pub('POST', '/form/submit', { formId: f.id, values: { name: 'Anna', e_mail: 'a@b.de', genre: 'Jazz' } })).status, 400, 'Auswahl unbekannt');
    const ok = await pub('POST', '/form/submit', { formId: f.id, values: { name: 'Anna', e_mail: 'a@b.de', genre: 'Pop', nachricht: 'Hi' } });
    assert.equal(ok.status, 200);
    assert.match(ok.body.thanks, /Danke/);
    await pub('POST', '/form/submit', { formId: f.id, values: { name: 'Ben', e_mail: 'b@b.de' } });
    const entries = (await api('GET', `/forms/${f.id}/entries`)).body as { id: string; values: Record<string, string> }[];
    assert.deepEqual(entries.map((e) => e.values.name), ['Ben', 'Anna'], 'neueste zuerst');
    const fcsv = await (await fetch(`${root}/api/v1/stations/main/forms/${f.id}/entries/csv`, { headers: { Authorization: `Bearer ${token}` } })).text();
    assert.match(fcsv, /"Name";"E-Mail";"Genre";"Nachricht"/);
    assert.match(fcsv, /"Anna";"a@b.de";"Pop";"Hi"/);
    assert.equal((await api('DELETE', `/form-entries/${entries[0]!.id}`)).status, 200);
    await api('PATCH', `/forms/${f.id}`, { active: false });
    assert.equal((await pub('POST', '/form/submit', { formId: f.id, values: { name: 'Cem', e_mail: 'c@b.de' } })).status, 404, 'geschlossen');
    assert.equal((await pub('GET', '/form')).body.forms.length, 0);

    // Auslosung: Modi, Protokoll, CSV, Leeren
    assert.equal((await api('POST', '/draw', { names: ['Solo'] })).status, 400);
    const d1 = (await api('POST', '/draw', { text: 'Anna\nBen\nCem\nDana', mode: 'normal', label: 'Karten' })).body;
    assert.equal(d1.winners.length, 1);
    assert.equal(d1.remaining.length, 3);
    const d2 = (await api('POST', '/draw', { names: ['Anna', 'Ben', 'Cem', 'Dana'], mode: 'multi', count: 2 })).body;
    assert.equal(d2.winners.length, 2);
    const d3 = (await api('POST', '/draw', { names: ['Anna', 'Ben', 'Cem'], mode: 'elim' })).body;
    assert.equal(d3.winners.length, 1);
    assert.equal(d3.remaining.length, 2, 'Ausgeschiedene in Reihenfolge');
    const draws = (await api('GET', '/draws')).body as { mode: string; label?: string }[];
    assert.deepEqual(draws.map((d) => d.mode), ['elim', 'multi', 'normal']);
    assert.equal(draws[2]!.label, 'Karten');
    const dcsv = await (await fetch(`${root}/api/v1/stations/main/draws/csv`, { headers: { Authorization: `Bearer ${token}` } })).text();
    assert.match(dcsv, /"normal";"[^"]+";"4";"Karten"/);
    assert.equal((await api('DELETE', '/draws')).status, 200);
    assert.deepEqual((await api('GET', '/draws')).body, []);
  } finally {
    app.shutdown();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
