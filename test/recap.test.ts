// Sendungs-Rückblick (inspiriert vom "Sendungs-Rückblick"-Menüpunkt in anmacha_control_center/live.html):
// Zeitraum -> gespielte Titel mit Uhrzeit, Hörer-Spitze, gesendete Datenmenge, als Übersicht, CSV und E-Mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { Notifier } from '../src/server/notify.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-recap-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
  return { dir, app, done: () => { app.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test('Sendungs-Rückblick: Titelliste, Hörer-Spitze und Datenmenge werden aus dem Zeitraum berechnet', () => {
  const { app, done } = setup();
  try {
    const rt = app.rt('main');
    const base = Date.now() - 3 * 3600_000;
    rt.data.playLog = [
      { at: base + 10_000, mediaId: 'a', title: 'Believer', artist: 'Imagine Dragons', category: 'music' },
      { at: base + 20_000, mediaId: 'b', title: 'Radioactive', artist: 'Imagine Dragons', category: 'music' },
      { at: base - 999_000, mediaId: 'c', title: 'Außerhalb', artist: 'X', category: 'music' }, // vor dem Zeitraum
    ];
    rt.data.recapSamples = [
      { at: base, listeners: 3, bytesTotal: 1_000_000 },
      { at: base + 15_000, listeners: 9, bytesTotal: 1_500_000 },
      { at: base + 30_000, listeners: 5, bytesTotal: 2_000_000 },
    ];

    const report = app.svc.recap.generate('main', base, base + 60_000);
    assert.equal(report.trackCount, 2);
    assert.deepEqual(report.tracks.map((t) => t.mediaId), ['a', 'b']);
    assert.equal(report.listenersPeak, 9, 'höchste Stichprobe im Zeitraum');
    assert.equal(report.bytesSent, 1_000_000, 'letzte minus erste Stichprobe im Zeitraum');

    assert.throws(() => app.svc.recap.generate('main', base + 60_000, base), /Zeitraum/);
  } finally {
    done();
  }
});

test('Sendungs-Rückblick: zu wenige Stichproben liefern "unbekannt" statt einer falschen Zahl', () => {
  const { app, done } = setup();
  try {
    const rt = app.rt('main');
    const base = Date.now() - 3600_000;
    rt.data.recapSamples = [{ at: base + 1000, listeners: 2, bytesTotal: 500 }];
    const report = app.svc.recap.generate('main', base, base + 60_000);
    assert.equal(report.bytesSent, null);
    assert.equal(report.listenersPeak, 2);
  } finally {
    done();
  }
});

test('Sendungs-Rückblick: CSV-Export mit Kopfzeile und Titelliste (Semikolon, Excel-tauglich)', () => {
  const { app, done } = setup();
  try {
    const rt = app.rt('main');
    const base = Date.now() - 3600_000;
    rt.data.playLog = [{ at: base + 1000, mediaId: 'a', title: 'Mit "Zitat"', artist: 'Band; X', category: 'music' }];
    const report = app.svc.recap.generate('main', base, base + 60_000);
    const csv = app.svc.recap.csv(report);
    assert.match(csv, /^Sendungs-Rückblick;/);
    assert.match(csv, /"Band; X";"Mit ""Zitat""";"music"/, 'Semikolon und Anführungszeichen korrekt escaped');
  } finally {
    done();
  }
});

test('Stichproben: der normale Sendetakt zeichnet Hörerzahl und gesendete Bytes je Sender auf', () => {
  const { app, done } = setup();
  try {
    const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
    app.saveOutput(admin, 'main', null, { name: 'out', host: '127.0.0.1', port: 8000, mount: '/x', password: 'pw-123456' });
    const out = [...app.outputs.values()][0]!;
    out.state.status = 'connected';
    out.state.listeners = 7;
    out.state.bytesSent = 12_345;

    assert.equal(app.rt('main').data.recapSamples?.length ?? 0, 0);
    app.tick(); // tickCount beginnt bei 0, 0 % 60 === 0 → erste Stichprobe sofort
    const samples = app.rt('main').data.recapSamples;
    assert.equal(samples?.length, 1);
    assert.equal(samples![0]!.listeners, 7);
    assert.equal(samples![0]!.bytesTotal, 12_345);
  } finally {
    done();
  }
});

test('Sendungs-Rückblick per E-Mail: nutzt den konfigurierten Kanal, lehnt ohne Konfiguration ab', async () => {
  const { app, done } = setup();
  try {
    const base = Date.now() - 3600_000;
    await assert.rejects(app.svc.recap.email('main', base, base + 1000), /E-Mail-Kanal/);

    app.svc.notifications.setIntegrations({ id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] }, 'main', {
      email: { to: 'team@example.com', smtpHost: 'smtp.example.com', smtpPort: 587, secure: false, user: 'bot@example.com', password: 'geheim', from: 'bot@example.com' },
    });
    const sent: { subject: string; body: string; to?: string }[] = [];
    const notifier = new Notifier((ref) => app.secrets.get(ref), () => {}, fetch, async (cfg, subject, body) => { sent.push({ subject, body, to: cfg.to }); });
    (app as unknown as { notifier: Notifier }).notifier = notifier;

    const rt = app.rt('main');
    rt.data.playLog = [{ at: base + 1000, mediaId: 'a', title: 'Believer', artist: 'Imagine Dragons', category: 'music' }];
    const ok = await app.svc.recap.email('main', base, base + 60_000, 'extra@example.com');
    assert.equal(ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, 'extra@example.com', 'explizit angegebener Empfänger überschreibt die Standard-Adresse');
    assert.match(sent[0]!.body, /Believer/);
  } finally {
    done();
  }
});
