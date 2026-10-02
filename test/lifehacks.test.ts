// Playlist-Lifehacks: Abgleich mit dem Lifehacks-Tab aus anmacha_control_center/automation.html
// (laut.fm-Verwaltungszentrum). Prüft echtes Verhalten jedes Werkzeugs auf der AnMaCha-Cast-eigenen
// Playlist/MediaItem-Struktur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-lifehacks-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
  const add = (id: string, p: Partial<Parameters<typeof app.svc.media.addMedia>[1]> = {}) =>
    app.svc.media.addMedia('main', { id, title: `Titel ${id}`, artist: 'Band', category: 'music', file: `${id}.mp3`, durationMs: 90_000, addedAt: 0, ...p });
  return { dir, app, add, done: () => { app.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test('Gesundheitscheck: Duplikate, fehlende Metadaten, zu kurze Clips, nicht zugewiesene Titel', () => {
  const { app, add, done } = setup();
  try {
    add('a1', { title: 'Believer', artist: 'Imagine Dragons' });
    add('a2', { title: 'Believer', artist: 'Imagine Dragons' }); // Duplikat von a1
    add('b1', { title: '', artist: '' }); // fehlende Metadaten
    add('c1', { durationMs: 10_000 }); // zu kurz
    app.svc.planning.savePlaylist('main', null, { name: 'Mix', items: ['a1', 'a2'] });
    // b1, c1 bleiben unzugewiesen

    const report = app.svc.lifehacks.healthCheck('main');
    assert.equal(report.duplicates.length, 1);
    assert.deepEqual(new Set(report.duplicates[0]!.ids), new Set(['a1', 'a2']));
    assert.ok(report.noMetadata.some((x) => x.id === 'b1'));
    assert.ok(report.tooShort.some((x) => x.id === 'c1'));
    assert.deepEqual(new Set(report.unassigned.map((x) => x.id)), new Set(['b1', 'c1']));
  } finally {
    done();
  }
});

test('Laufzeit-Kalkulator: Gesamtlänge und Werbepuffer', () => {
  const { app, add, done } = setup();
  try {
    add('a1', { durationMs: 60_000 });
    add('a2', { durationMs: 120_000 });
    const pl = app.svc.planning.savePlaylist('main', null, { name: 'Mix', items: ['a1', 'a2'] });
    const r = app.svc.lifehacks.runtime('main', pl.id, 10);
    assert.equal(r.totalMs, 180_000);
    assert.equal(r.withBufferMs, 198_000);
  } finally {
    done();
  }
});

test('Playlisten zusammenführen: Duplikate werden übersprungen', () => {
  const { app, add, done } = setup();
  try {
    add('a1'); add('a2'); add('b1');
    const target = app.svc.planning.savePlaylist('main', null, { name: 'A', items: ['a1', 'a2'] });
    const source = app.svc.planning.savePlaylist('main', null, { name: 'B', items: ['a1', 'b1'] });
    const r = app.svc.lifehacks.merge('main', target.id, source.id);
    assert.equal(r.added, 1);
    assert.equal(r.skipped, 1);
    assert.deepEqual(app.svc.planning.playlists('main').find((p) => p.id === target.id)!.items, ['a1', 'a2', 'b1']);
  } finally {
    done();
  }
});

test('Top-Tracks der letzten 24h → neue Playlist', () => {
  const { app, add, done } = setup();
  try {
    add('a1'); add('a2'); add('a3');
    const rt = app.rt('main');
    const now = Date.now();
    rt.data.playLog = [
      { at: now - 1000, mediaId: 'a1', title: '', artist: '', category: 'music' },
      { at: now - 2000, mediaId: 'a1', title: '', artist: '', category: 'music' },
      { at: now - 3000, mediaId: 'a2', title: '', artist: '', category: 'music' },
      { at: now - 50 * 3_600_000, mediaId: 'a3', title: '', artist: '', category: 'music' }, // älter als 24h
    ];
    const pl = app.svc.lifehacks.topTracksPlaylist('main', { n: 2, name: 'Top 2' });
    assert.deepEqual(pl.items, ['a1', 'a2']);
  } finally {
    done();
  }
});

test('Massen-Tagger: Tags hinzufügen und entfernen für eine ganze Playlist', () => {
  const { app, add, done } = setup();
  try {
    add('a1'); add('a2');
    const pl = app.svc.planning.savePlaylist('main', null, { name: 'Mix', items: ['a1', 'a2'] });
    const addRes = app.svc.lifehacks.massTag('main', pl.id, ['morgen', 'slow'], 'add');
    assert.equal(addRes.changed, 2);
    assert.deepEqual(app.svc.media.media('main', 'a1').tags, ['morgen', 'slow']);
    const removeRes = app.svc.lifehacks.massTag('main', pl.id, ['slow'], 'remove');
    assert.equal(removeRes.changed, 2);
    assert.deepEqual(app.svc.media.media('main', 'a1').tags, ['morgen']);
    // Erneutes Hinzufügen derselben Tags ändert nichts mehr
    const noop = app.svc.lifehacks.massTag('main', pl.id, ['morgen'], 'add');
    assert.equal(noop.changed, 0);
  } finally {
    done();
  }
});

test('Playlist-Analyse: Genre-Mix, Jahrzehnte, Ø-Länge, Top-Artists', () => {
  const { app, add, done } = setup();
  try {
    add('a1', { artist: 'A', genre: 'Pop', year: 2015, durationMs: 100_000 });
    add('a2', { artist: 'A', genre: 'Pop', year: 2017, durationMs: 200_000 });
    add('a3', { artist: 'B', genre: 'Rock', year: 1994, durationMs: 300_000 });
    const pl = app.svc.planning.savePlaylist('main', null, { name: 'Mix', items: ['a1', 'a2', 'a3'] });
    const a = app.svc.lifehacks.analyze('main', pl.id);
    assert.equal(a.trackCount, 3);
    assert.equal(a.avgDurationMs, 200_000);
    assert.deepEqual(a.genreMix[0], { genre: 'Pop', count: 2 });
    assert.ok(a.decades.some((d) => d.decade === '2010er' && d.count === 2));
    assert.equal(a.topArtists[0]!.artist, 'A');
  } finally {
    done();
  }
});

test('Globale Track-Suche: findet Titel über alle Playlisten hinweg', () => {
  const { app, add, done } = setup();
  try {
    add('a1', { title: 'Believer', artist: 'Imagine Dragons' });
    add('a2', { title: 'Radioactive', artist: 'Imagine Dragons' });
    app.svc.planning.savePlaylist('main', null, { name: 'Rock', items: ['a1'] });
    app.svc.planning.savePlaylist('main', null, { name: 'Favoriten', items: ['a1', 'a2'] });
    const hits = app.svc.lifehacks.trackFinder('main', 'believer');
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.playlists.length, 2);
  } finally {
    done();
  }
});

test('Erscheinungsjahr Batch-Füllen: nur Titel ohne Jahr werden gesetzt', () => {
  const { app, add, done } = setup();
  try {
    add('a1', { year: 1999 });
    add('a2');
    const pl = app.svc.planning.savePlaylist('main', null, { name: 'Mix', items: ['a1', 'a2'] });
    const r = app.svc.lifehacks.fillYear('main', pl.id, 2024);
    assert.equal(r.filled, 1);
    assert.equal(r.skipped, 1);
    assert.equal(app.svc.media.media('main', 'a1').year, 1999);
    assert.equal(app.svc.media.media('main', 'a2').year, 2024);
  } finally {
    done();
  }
});

test('Playlist-Vergleich: Titel nur in A bzw. nur in B', () => {
  const { app, add, done } = setup();
  try {
    add('a1'); add('a2'); add('a3');
    const a = app.svc.planning.savePlaylist('main', null, { name: 'A', items: ['a1', 'a2'] });
    const b = app.svc.planning.savePlaylist('main', null, { name: 'B', items: ['a2', 'a3'] });
    const r = app.svc.lifehacks.compare('main', a.id, b.id);
    assert.deepEqual(r.onlyA.map((m) => m.id), ['a1']);
    assert.deepEqual(r.onlyB.map((m) => m.id), ['a3']);
  } finally {
    done();
  }
});

test('Playlisten-Massenlöschung: Titel bleiben in der Bibliothek erhalten', () => {
  const { app, add, done } = setup();
  try {
    add('a1');
    const p1 = app.svc.planning.savePlaylist('main', null, { name: 'P1', items: ['a1'] });
    const p2 = app.svc.planning.savePlaylist('main', null, { name: 'P2', items: ['a1'] });
    const r = app.svc.lifehacks.deleteMany('main', [p1.id, p2.id]);
    assert.deepEqual(new Set(r.deleted), new Set([p1.id, p2.id]));
    assert.equal(app.svc.planning.playlists('main').length, 0);
    assert.ok(app.svc.media.library('main').some((m) => m.id === 'a1'));
  } finally {
    done();
  }
});
