/**
 * Ereignisse (Zeitplan/Stunden-Uhr): Typen Kategorie (z. B. Werbung), Nachrichten (laut.fm) und KI-Ansage.
 * KI-Ansagen brauchen den eingeschalteten KI-Regisseur; Preflight prüft alle Ziel-Arten.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';

test('Ereignis-Typen: Kategorie, KI-Ansage (nur bei aktivem Regisseur), Preflight-Meldungen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-events-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const pl = app.svc.planning;
    // Kategorie Werbung ohne Spots → klare Ablehnung; mit Spot → ok
    assert.throws(() => pl.saveClockEvent('main', null, { kind: 'category', category: 'ad', minutes: [15] }), /nichts hochgeladen/);
    app.svc.media.addMedia('main', { id: 'spot', title: 'Spot', artist: '', category: 'ad', file: 'spot.mp3', durationMs: 30000, addedAt: 0 });
    const ad = pl.saveClockEvent('main', null, { kind: 'category', category: 'ad', minutes: [15], label: 'Werbeblock' });
    assert.equal(ad.category, 'ad');

    // KI-Ansage: Regisseur aus → 409, an → Eintrag mit Standard-Bezeichnung, Modus immer „nach dem Titel“
    assert.throws(() => pl.saveClockEvent('main', null, { kind: 'ai', aiKind: 'break', minutes: [30] }), /KI-Regisseur ist aus/);
    app.rt('main').data.ai = { ...app.svc.ai.aiConfig('main'), enabled: true };
    const ai = pl.saveClockEvent('main', null, { kind: 'ai', aiKind: 'news', minutes: [58], mode: 'fx' });
    assert.equal(ai.kind, 'ai');
    assert.equal(ai.aiKind, 'news');
    assert.equal(ai.mode, 'track');
    assert.equal(ai.label, 'KI-Nachrichten');
    const ai2 = pl.saveClockEvent('main', null, { kind: 'ai', minutes: [20] });
    assert.equal(ai2.aiKind, 'break');
    assert.equal(ai2.label, 'KI-Ansage');
    assert.throws(() => pl.saveClockEvent('main', null, { kind: 'bogus', minutes: [0] }), /news oder ai/);

    // Preflight kennt alle Arten: Spot-Datei fehlt → Kategorie leer; KI ok; nach Abschalten Warnung
    const p1 = pl.preflight('main');
    const byLabel = (l: string) => p1.items.find((i) => i.label === l);
    assert.equal(byLabel('Werbeblock')?.status, 'empty');
    assert.equal(byLabel('KI-Nachrichten')?.status, 'ok');
    app.rt('main').data.ai = { ...app.svc.ai.aiConfig('main'), enabled: false };
    assert.equal(pl.preflight('main').items.find((i) => i.label === 'KI-Ansage')?.status, 'warning');

    // Auslösen ohne Anbieter: Regisseur meldet Fehler ins Audit, nichts stürzt ab
    app.rt('main').data.ai = { ...app.svc.ai.aiConfig('main'), enabled: true };
    pl.fireClockEvent('main', ai2.id);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
