/**
 * Sendezentrale: Netzwerk-Senderkarten mit Hörer-Kennzahlen (Live aus verbundenen Ausgängen, Ø 24 h aus den
 * 30-s-Stichproben, Ø 7 Tage aus dem Stunden-Aggregat), nur für sichtbare Sender.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';

const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };

test('Netzwerk-Kennzahlen je Sender: ohne Daten null, sonst Ø 24 h und Ø 7 Tage, sortierbar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-network-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const now = Date.now();
    const h = 3_600_000;
    const empty = app.svc.stats.cardNumbers('main', now);
    assert.deepEqual(empty, { live: 0, avg24h: null, avg7d: null });

    const rt = app.rt('main');
    rt.data.recapSamples = [
      { at: now - 60_000, listeners: 10, bytesTotal: 0 }, { at: now - 120_000, listeners: 20, bytesTotal: 0 },
      { at: now - 30 * h, listeners: 500, bytesTotal: 0 }, // älter als 24 h → zählt nicht
    ];
    rt.data.listenerHours = [
      { at: now - 2 * h, sum: 40, n: 4, peak: 15 }, { at: now - 3 * 24 * h, sum: 20, n: 4, peak: 9 },
      { at: now - 9 * 24 * h, sum: 999, n: 1, peak: 999 }, // älter als 7 Tage
    ];
    const k = app.svc.stats.cardNumbers('main', now);
    assert.equal(k.avg24h, 15);
    assert.equal(k.avg7d, 7.5, '(40+20)/(4+4)');

    app.svc.stations.createStation({ id: 'zwei', name: 'Zweiter Sender' });
    const net = app.svc.stations.network(admin);
    assert.equal(net.length, 2);
    assert.equal(net.find((s) => s.id === 'main')?.avg24h, 15);
    assert.equal(net.find((s) => s.id === 'zwei')?.avg24h, null);
    // Nur sichtbare Sender
    const limited = { ...admin, roles: ['moderator'], stationIds: ['zwei'], scopes: ['branding:read'] };
    assert.deepEqual(app.svc.stations.network(limited).map((s) => s.id), ['zwei']);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
