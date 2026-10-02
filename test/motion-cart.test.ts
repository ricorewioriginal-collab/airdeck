// Motion-Cart-Vorbereitung: Loop-Ende-Markierung für Jingles/Betten/Sweeper (siehe
// src/core/automation.ts MediaItem.loopEndMs) - reines Datenfeld, Grundlage für die noch offene
// Endlos-Loop-Wiedergabe mit Weiterschalten in Drop/Outro (dokumentiert in docs/FEATURE_PARITY.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-motioncart-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
  app.svc.media.addMedia('main', { id: 'j1', title: 'Sweeper 1', artist: '', category: 'sweeper', file: 'j1.mp3', durationMs: 20_000, addedAt: 0 });
  return { app, done: () => { app.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test('loopEndMs: setzen, auslesen, mit null wieder entfernen', () => {
  const { app, done } = setup();
  try {
    assert.equal(app.svc.media.media('main', 'j1').loopEndMs, undefined);
    const updated = app.svc.media.updateMedia('main', 'j1', { loopEndMs: 8000 });
    assert.equal(updated.loopEndMs, 8000);
    assert.equal(app.svc.media.media('main', 'j1').loopEndMs, 8000);
    const cleared = app.svc.media.updateMedia('main', 'j1', { loopEndMs: null });
    assert.equal(cleared.loopEndMs, undefined);
  } finally {
    done();
  }
});

test('loopEndMs: ungültige Werte (negativ, kein Zahl) werden ignoriert statt übernommen', () => {
  const { app, done } = setup();
  try {
    app.svc.media.updateMedia('main', 'j1', { loopEndMs: 5000 });
    app.svc.media.updateMedia('main', 'j1', { loopEndMs: -100 });
    assert.equal(app.svc.media.media('main', 'j1').loopEndMs, 5000, 'negativer Wert darf den gültigen alten nicht überschreiben');
    app.svc.media.updateMedia('main', 'j1', { loopEndMs: 'bald' });
    assert.equal(app.svc.media.media('main', 'j1').loopEndMs, 5000);
  } finally {
    done();
  }
});
