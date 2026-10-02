/**
 * Smart Blocks: Regel-Abgleich, Reihenfolge, Begrenzung (Titel/Minuten); dynamische Playlist und
 * Momentaufnahme; Allgemeine Rotation nach Gewicht beim Auffüllen der Queue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { blockMatch, normalizeBlock, ruleMatches } from '../src/core/smartblocks.ts';
import type { MediaItem } from '../src/core/automation.ts';

const m = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({ id, title: id, artist: 'A', category: 'music', file: `${id}.mp3`, durationMs: 180_000, addedAt: 0, ...extra });

test('Regeln: Text- und Zahlvergleiche, alle/mindestens eine, Elemente ausgeschlossen', () => {
  const lib = [
    m('pop1', { genre: 'Pop', year: 2015, artist: 'Anna' }), m('pop2', { genre: 'Pop', year: 2022, artist: 'Ben', durationMs: 240_000 }),
    m('rock', { genre: 'Rock', year: 1999, tags: ['party'] }), m('jingle', { category: 'jingle', genre: 'Pop' }),
  ];
  assert.ok(ruleMatches(lib[0]!, { field: 'genre', op: 'contains', value: 'po' }));
  assert.ok(ruleMatches(lib[2]!, { field: 'tags', op: 'is', value: 'Party' }));
  assert.ok(ruleMatches(lib[1]!, { field: 'durationSec', op: 'gt', value: '200' }));
  assert.ok(!ruleMatches(lib[0]!, { field: 'year', op: 'between', value: '2020', value2: '2025' }));
  const all = normalizeBlock({ name: 'Pop neu', match: 'all', rules: [{ field: 'genre', op: 'is', value: 'Pop' }, { field: 'year', op: 'gt', value: '2010' }], order: 'alpha', limit: { by: 'items', n: 0 } }, 'b1');
  assert.deepEqual(blockMatch(lib, all).map((x) => x.id), ['pop1', 'pop2'], 'Jingle trotz Genre Pop ausgeschlossen');
  const any = normalizeBlock({ name: 'x', match: 'any', rules: [{ field: 'genre', op: 'is', value: 'Rock' }, { field: 'year', op: 'gt', value: '2020' }], order: 'newest', limit: { n: 1 } }, 'b2');
  assert.deepEqual(blockMatch(lib, any).map((x) => x.id), ['pop2'], 'newest zuerst (addedAt gleich → stabile Sortierung), Limit 1');
  const withEl = normalizeBlock({ name: 'x', rules: [{ field: 'genre', op: 'is', value: 'Pop' }], includeElements: true, order: 'alpha' }, 'b3');
  assert.equal(blockMatch(lib, withEl).length, 3);
  const minutes = normalizeBlock({ name: 'x', rules: [], order: 'longest', limit: { by: 'minutes', n: 7 } }, 'b4');
  assert.deepEqual(blockMatch(lib, minutes).map((x) => x.id), ['pop2', 'pop1'], '4 + 3 Minuten passen in 7, der dritte nicht mehr');
  assert.throws(() => normalizeBlock({ name: '', rules: [] }, 'x'), /Name/);
  assert.throws(() => normalizeBlock({ name: 'x', rules: [{ field: 'nope', op: 'is', value: '' }] }, 'x'), /Unbekanntes Feld/);
});

test('Dienst: Smart Block speichern, Vorschau, dynamische Playlist, Momentaufnahme, Allgemeine Rotation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-blk-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const rt = app.rt('main');
    rt.data.library.push(m('p1', { genre: 'Pop', artist: 'Anna' }), m('p2', { genre: 'Pop', artist: 'Ben' }), m('r1', { genre: 'Rock', artist: 'Cid' }), m('r2', { genre: 'Rock', artist: 'Dee' }));
    const pl = app.svc.planning;
    const blk = pl.saveSmartBlock('main', null, { name: 'Pop', rules: [{ field: 'genre', op: 'is', value: 'Pop' }], order: 'alpha', limit: { by: 'items', n: 10 } });
    assert.equal(pl.smartBlocks('main')[0]?.count, 2);
    const prev = pl.previewSmartBlock('main', { block: { name: 'Rock', rules: [{ field: 'genre', op: 'is', value: 'Rock' }], order: 'alpha' } });
    assert.equal(prev.count, 2);
    assert.equal(prev.minutes, 6);
    const dyn = pl.smartBlockToPlaylist('main', blk.id, false);
    assert.equal(dyn.block, blk.id);
    assert.deepEqual(pl.playlistItems('main', dyn), ['p1', 'p2']);
    rt.data.library.push(m('p3', { genre: 'Pop', artist: 'Eve' }));
    assert.deepEqual(pl.playlistItems('main', dyn), ['p1', 'p2', 'p3'], 'dynamisch: neue Titel kommen dazu');
    const snap = pl.smartBlockToPlaylist('main', blk.id, true, 'Fest');
    assert.equal(snap.name, 'Fest');
    assert.deepEqual(snap.items, ['p1', 'p2', 'p3']);
    pl.playPlaylist('main', dyn.id);
    assert.equal(rt.queue.length, 3);

    // Allgemeine Rotation: Rock-Playlist Gewicht 3, Pop (dynamisch) Gewicht 1
    const rock = pl.savePlaylist('main', null, { name: 'Rock', items: ['r1', 'r2'] });
    assert.throws(() => pl.setRotationPool('main', { on: true, entries: [] }), /Mindestens eine/);
    pl.setRotationPool('main', { on: true, entries: [{ playlistId: rock.id, weight: 3 }, { playlistId: dyn.id, weight: 1 }, { playlistId: 'nope', weight: 5 }] });
    assert.equal(pl.rotationPool('main').entries.length, 2);
    rt.queue.clear();
    rt.data.minQueue = 8;
    let i = 0;
    const seq = [0.1, 0.9, 0.2, 0.3, 0.95, 0.4, 0.5, 0.6];
    assert.equal(pl.fillFromPool('main', () => seq[i++ % seq.length]!), true);
    const q = rt.queue.list().map((x) => x.mediaId);
    assert.equal(q.length, 8);
    assert.ok(q.filter((id) => id.startsWith('r')).length >= 5, `Rock überwiegt (${q.join(',')})`);
    assert.ok(q.some((id) => id.startsWith('p')), 'Pop kommt auch vor');
    pl.deletePlaylist('main', rock.id);
    assert.equal(pl.rotationPool('main').entries.length, 1, 'gelöschte Playlist verlässt den Pool');
    pl.deleteSmartBlock('main', blk.id);
    assert.equal(rt.data.playlists?.find((p) => p.id === dyn.id)?.block, undefined);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
