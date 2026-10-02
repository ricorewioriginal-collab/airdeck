/**
 * Podcast-Auto-Veröffentlichung: fertige Mitschnitte werden nach Vorlage zur Episode (Entwurf oder sofort im
 * Feed), mit Mindestdauer, „nur Zeitfenster“ und fortlaufender Episodennummer; nie doppelt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { renderTemplate, templateVars } from '../src/server/services/podcast.ts';
import type { Recording } from '../src/server/model.ts';

const rec = (id: string, minutes: number, planId?: string): Recording => {
  const startedAt = new Date(2026, 9, 2, 20, 0).getTime();
  return { id, label: 'Abendshow', startedAt, endedAt: startedAt + minutes * 60_000, bytes: 1000, contentType: 'audio/mpeg', file: `${id}.mp3`, planId };
};

test('Vorlagen: Platzhalter, unbekannte bleiben stehen, Dauer-Format', () => {
  const v = templateVars('Radio Test', rec('r1', 95), 7);
  assert.equal(v.date, '02.10.2026');
  assert.equal(v.time, '20:00');
  assert.equal(v.weekday, 'Freitag');
  assert.equal(v.duration, '1 h 35 min');
  assert.equal(templateVars('x', rec('r2', 12), 1).duration, '12 min');
  assert.equal(renderTemplate('{label} #{n} vom {date} ({duration}) – {unbekannt}', v), 'Abendshow #7 vom 02.10.2026 (1 h 35 min) – {unbekannt}');
});

test('Auto-Episode: aus, Mindestdauer, nur Zeitfenster, Entwurf/veröffentlicht, Nummerierung, kein Duplikat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-podauto-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const pc = app.svc.podcast;
    const rt = app.rt('main');
    rt.data.recordings = [rec('a', 30), rec('b', 5), rec('c', 60, 'rp1'), rec('d', 45)];
    assert.equal(pc.autoEpisode('main', rec('a', 30)), null, 'Auto aus → nichts');

    pc.saveConfig('main', { auto: { enabled: true, titleTemplate: '{label} {n}', descriptionTemplate: '{weekday} {duration}', minMinutes: 10, onlyPlanned: false, publish: false } });
    const cfg = pc.config('main');
    assert.equal(cfg.auto?.enabled, true);
    assert.equal(cfg.auto?.minMinutes, 10);
    assert.equal(pc.autoEpisode('main', rec('b', 5)), null, 'zu kurz');
    const e1 = pc.autoEpisode('main', rec('a', 30))!;
    assert.equal(e1.title, 'Abendshow 1');
    assert.equal(e1.description, 'Freitag 30 min');
    assert.equal(e1.episodeNumber, 1);
    assert.equal(e1.publishedAt, undefined, 'Entwurf');
    assert.equal(pc.autoEpisode('main', rec('a', 30)), null, 'kein Duplikat je Mitschnitt');

    pc.saveConfig('main', { auto: { ...cfg.auto, enabled: true, onlyPlanned: true, publish: true } });
    assert.equal(pc.autoEpisode('main', rec('d', 45)), null, 'manueller Mitschnitt bei „nur Zeitfenster“');
    const e2 = pc.autoEpisode('main', rec('c', 60, 'rp1'))!;
    assert.equal(e2.episodeNumber, 2);
    assert.ok(e2.publishedAt, 'sofort veröffentlicht');
    assert.equal(pc.episodes('main').length, 2);

    // Stammdaten-Speichern ohne auto-Feld lässt die Automatik unverändert
    pc.saveConfig('main', { title: 'Neu' });
    assert.equal(pc.config('main').auto?.onlyPlanned, true);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
