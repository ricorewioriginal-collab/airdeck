// "Jingles & IDs": Uhr-Events der Art "category" (zufälliges Element einer Kategorie zu festen Minuten),
// Grundlage der Seite "Jingles, Sender-IDs, Sweeper & Werbung" (nach dem AnMaCha Control Center).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-jingles-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
  app.svc.media.addMedia('main', { id: 'j1', title: 'Jingle 1', artist: '', category: 'jingle', file: 'j1.mp3', durationMs: 4000, addedAt: 0 });
  app.svc.media.addMedia('main', { id: 'j2', title: 'Jingle 2', artist: '', category: 'jingle', file: 'j2.mp3', durationMs: 5000, addedAt: 0 });
  return { app, done: () => { app.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test('Uhr-Event "category": wird gespeichert und löst ein Element der Kategorie aus', () => {
  const { app, done } = setup();
  try {
    const ev = app.svc.planning.saveClockEvent('main', null, { kind: 'category', category: 'jingle', mode: 'fx', minutes: [0, 30], hours: [], days: [], label: 'Jingles · Minute 0,30' });
    assert.equal(ev.kind, 'category');
    assert.equal(ev.category, 'jingle');
    assert.deepEqual(ev.minutes, [0, 30]);
    assert.equal(ev.mode, 'fx');
    const fired: unknown[] = [];
    app.subscribe((e) => { if (e.type === 'schedule.fired') fired.push(e.payload); });
    app.svc.planning.fireClockEvent('main', ev.id);
    assert.equal(fired.length, 1, 'Auslösen muss ein schedule.fired-Ereignis erzeugen');
  } finally {
    done();
  }
});

test('Uhr-Event "category": leere oder unbekannte Kategorie wird abgewiesen', () => {
  const { app, done } = setup();
  try {
    assert.throws(() => app.svc.planning.saveClockEvent('main', null, { kind: 'category', category: 'sweeper', mode: 'fx', minutes: [15] }), /noch nichts hochgeladen/);
    assert.throws(() => app.svc.planning.saveClockEvent('main', null, { kind: 'category', category: 'kuchen', mode: 'fx', minutes: [15] }), /Unbekannte Kategorie/);
  } finally {
    done();
  }
});
