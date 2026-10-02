/**
 * Hörerstatistik: Zeiträume, Kennzahlen aus Play-Log (mit Hörerzahl/Live-Kennung), Hörer-Verlauf aus
 * 30-s-Stichproben bzw. Stunden-Aggregat, Genre-Mix und Top-Songs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { periodRange } from '../src/server/services/stats.ts';

test('periodRange', () => {
  const now = new Date(2026, 9, 2, 14, 30).getTime();
  assert.equal(periodRange('24h', now).from, now - 24 * 3_600_000);
  assert.equal(periodRange('7d', now).from, now - 7 * 24 * 3_600_000);
  assert.equal(new Date(periodRange('today', now).from).getHours(), 0);
  assert.equal(periodRange('3m', now).from, now - 90 * 24 * 3_600_000);
});

test('Statistik: Kennzahlen, Top-Songs, Verlauf, Genre-Mix, Live-Plays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-stats-'));
  try {
    const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
    const rt = app.rt('main');
    const now = Date.now();
    const h = 3_600_000;
    rt.data.library.push(
      { id: 'a', title: 'Alpha', artist: 'Ann', category: 'music', file: 'a.mp3', durationMs: 180000, addedAt: 0, genre: 'Pop' },
      { id: 'b', title: 'Beta', artist: 'Bob', category: 'music', file: 'b.mp3', durationMs: 180000, addedAt: 0, genre: 'Rock' },
    );
    rt.data.playLog = [
      { at: now - 10 * 60_000, mediaId: 'a', title: 'Alpha', artist: 'Ann', category: 'music', listeners: 12, live: true },
      { at: now - 20 * 60_000, mediaId: 'id1', title: 'ID', artist: '', category: 'station_id', listeners: 10 },
      { at: now - 30 * 60_000, mediaId: 'a', title: 'Alpha', artist: 'Ann', category: 'music', listeners: 8 },
      { at: now - 40 * 60_000, mediaId: 'b', title: 'Beta', artist: 'Bob', category: 'music', listeners: 6 },
      { at: now - 3 * 24 * h, mediaId: 'b', title: 'Beta', artist: 'Bob', category: 'music', listeners: 20 }, // außerhalb 24 h
    ];
    rt.data.recapSamples = Array.from({ length: 60 }, (_, i) => ({ at: now - i * 30_000, listeners: 5 + (i % 3), bytesTotal: 0 }));
    rt.data.listenerHours = Array.from({ length: 5 * 24 }, (_, i) => ({ at: now - (now % h) - i * h, sum: 40, n: 4, peak: 15 }));

    const s24 = app.svc.stats.stats('main', '24h');
    assert.equal(s24.kpis.played, 4);
    assert.equal(s24.kpis.livePlays, 1);
    assert.equal(s24.kpis.uniqueSongs, 2);
    assert.equal(s24.kpis.avgPerSong, 9, '(12+10+8+6)/4');
    assert.equal(s24.kpis.peak, 12);
    assert.equal(s24.kpis.topSong?.title, 'Alpha');
    assert.equal(s24.topSongs[0]?.plays, 2);
    assert.equal(s24.topSongs[0]?.avgListeners, 10);
    assert.deepEqual(s24.genres.map((g) => g.genre), ['Pop', 'Rock']);
    assert.equal(s24.seriesStep, 'minutes');
    assert.ok(s24.series.length >= 3 && s24.series.length <= 4, '30 Minuten Stichproben → 3–4 Zehn-Minuten-Punkte');
    assert.equal(s24.livePlays.length, 1);
    assert.ok(s24.categories.some((c) => c.category === 'station_id' && c.plays === 1));

    const s7 = app.svc.stats.stats('main', '7d');
    assert.equal(s7.kpis.played, 5);
    assert.equal(s7.seriesStep, 'hours');
    assert.equal(s7.series.length, 5 * 24);
    assert.equal(s7.series[0]?.avg, 10);
    assert.equal(s7.kpis.peak, 20, 'Spitze aus Play-Log und Stunden-Aggregat');

    const s30 = app.svc.stats.stats('main', '30d');
    assert.equal(s30.seriesStep, 'days');
    assert.ok(s30.series.length >= 5 && s30.series.length <= 6);
    assert.throws(() => app.svc.stats.stats('main', 'year'), /Zeitraum/);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
