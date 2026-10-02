/**
 * Überblend-Profile (Sendereinstellungen): Kurvenform, Konfigurations-Rundlauf mit Grenzwerten und die
 * Profil-Liste in der Playout-Ansicht.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { DEFAULT_FADES, FADE_PROFILES, fadeShape } from '../src/server/playout.ts';

test('fadeShape: Grenzen und Kurvenformen', () => {
  for (const curve of ['linear', 'equal', 's'] as const) {
    assert.equal(fadeShape(curve, 0, true), 0);
    assert.equal(Math.round(fadeShape(curve, 1, true) * 1e6) / 1e6, 1);
    assert.equal(fadeShape(curve, -1, true), 0, 'unter 0 geklemmt');
    assert.equal(Math.round(fadeShape(curve, 2, true) * 1e6) / 1e6, 1, 'über 1 geklemmt');
  }
  assert.equal(fadeShape('linear', 0.25, true), 0.25);
  // Equal-Power: aufsteigende und absteigende Blende ergeben zusammen konstante Leistung
  const up = fadeShape('equal', 0.3, true);
  const down = 1 - fadeShape('equal', 0.3, false);
  assert.ok(Math.abs(up * up + down * down - 1) < 1e-9);
  // S-Kurve: flach an den Enden, in der Mitte genau 0.5
  assert.equal(fadeShape('s', 0.5, true), 0.5);
  assert.ok(fadeShape('s', 0.1, true) < 0.1);
});

test('Profile sind vollständig und enthalten die Voreinstellung', () => {
  for (const [id, p] of Object.entries(FADE_PROFILES)) {
    assert.ok(p.label, id);
    for (const k of ['stopMs', 'skipMs', 'endMs', 'fxMs', 'shortTrackMs', 'crossfadeMs', 'fadeInMs'] as const) assert.ok(p[k] >= 0, `${id}.${k}`);
    assert.ok(['linear', 'equal', 's'].includes(p.curve), `${id}.curve`);
  }
  const std = FADE_PROFILES.standard!;
  assert.deepEqual({ ...DEFAULT_FADES, profile: undefined }, { profile: undefined, stopMs: std.stopMs, skipMs: std.skipMs, endMs: std.endMs, fxMs: std.fxMs, shortTrackMs: std.shortTrackMs, curve: std.curve });
});

test('savePlayoutConfig: Fades speichern, klemmen und in der Ansicht liefern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-fades-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const view0 = app.playoutView('main') as any;
    assert.deepEqual(view0.config.fades, DEFAULT_FADES);
    assert.ok(view0.fadeProfiles.some((p: any) => p.id === 'club' && p.label === 'Club / Dance'));

    app.savePlayoutConfig('main', { fades: { profile: 'soft', stopMs: 1500, skipMs: 99_999, endMs: 3000, fxMs: -5, shortTrackMs: 45_000, curve: 's' } } as any);
    const f1 = (app.playoutView('main') as any).config.fades;
    assert.equal(f1.profile, 'soft');
    assert.equal(f1.stopMs, 1500);
    assert.equal(f1.skipMs, DEFAULT_FADES.skipMs, 'außerhalb des Bereichs → alter Wert bleibt');
    assert.equal(f1.fxMs, DEFAULT_FADES.fxMs, 'negativ → alter Wert bleibt');
    assert.equal(f1.endMs, 3000);
    assert.equal(f1.shortTrackMs, 45_000);
    assert.equal(f1.curve, 's');

    // Teil-Update: nur die Kurve, ungültiger Wert wird ignoriert
    app.savePlayoutConfig('main', { fades: { curve: 'bogus' } } as any);
    assert.equal((app.playoutView('main') as any).config.fades.curve, 's');
    app.savePlayoutConfig('main', { fades: { curve: 'linear' } } as any);
    const f2 = (app.playoutView('main') as any).config.fades;
    assert.equal(f2.curve, 'linear');
    assert.equal(f2.stopMs, 1500, 'übrige Werte unverändert');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
