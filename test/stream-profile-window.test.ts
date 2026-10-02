// Zusatz-Streams mit Zeitfenstern: Abgleich mit anmacha_control_center zeigte, dass Zusatz-Streams
// (z. B. Simulcast auf eine zweite Plattform) bisher nur dauerhaft an/aus geschaltet werden konnten,
// nicht zeitgesteuert. Dieser Test prüft echtes Verhalten: ein Profil mit Zeitfenster läuft nur
// innerhalb des Fensters (Encoder tatsächlich gestartet/gestoppt), nicht nur ein gespeichertes Flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { detectFfmpeg } from '../src/server/ffmpeg.ts';
import { weekday } from '../src/core/scheduler.ts';

const ff = detectFfmpeg(process.cwd());
const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };

function wav(file: string, seconds: number): void {
  const rate = 22050;
  const n = Math.floor(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  writeFileSync(file, b);
}

test('Zusatz-Stream-Profil mit Zeitfenster: validiert, läuft nur innerhalb des Fensters, Zeitplan schaltet um', { skip: !ff && 'ffmpeg nicht installiert' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-sp-window-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: ff });
  try {
    wav(join(app.mediaDir, 'main', 'a.wav'), 2);
    app.svc.media.addMedia('main', { id: 'a.wav', title: 'a', artist: 'A', category: 'music', file: 'a.wav', durationMs: null, addedAt: 0 });
    app.start();
    app.startPlayout(admin, 'main', { format: 'mp3', bitrateKbps: 128 });

    // Ungültiges Zeitfenster wird abgelehnt
    assert.throws(() => app.saveStreamProfile(admin, 'main', null, { name: 'X', format: 'aac', bitrateKbps: 64, window: { from: '25:00', to: '10:00' } }), /invalid_window|Uhrzeit/);

    // Immer aktiv (from === to → ganzer Tag, keine Tage-Einschränkung): Encoder läuft sofort
    const always = app.saveStreamProfile(admin, 'main', null, { name: 'Immer', format: 'aac', bitrateKbps: 64, window: { from: '00:00', to: '00:00', days: [] } }) as { id: string };
    assert.ok((app.playouts.get('main')!.playout.listProfiles()).includes(always.id));

    // Fenster auf einen Tag beschränkt, der heute sicher nicht ist → Encoder läuft nicht
    const notToday = (weekday(new Date()) + 1) % 7;
    const never = app.saveStreamProfile(admin, 'main', null, { name: 'Nie heute', format: 'aac', bitrateKbps: 64, window: { from: '00:00', to: '00:01', days: [notToday] } }) as { id: string };
    assert.ok(!(app.playouts.get('main')!.playout.listProfiles()).includes(never.id), 'Profil außerhalb seines Zeitfensters läuft nicht');

    // Zeitfenster entfernen (window: null) → Profil läuft wieder dauerhaft
    app.saveStreamProfile(admin, 'main', never.id, { window: null });
    assert.ok((app.playouts.get('main')!.playout.listProfiles()).includes(never.id), 'Ohne Zeitfenster läuft das Profil durchgehend');

    // Der minütliche Zeitplan-Takt gleicht Profile mit Zeitfenster erneut ab, ohne dass jemand speichert
    app.saveStreamProfile(admin, 'main', never.id, { window: { from: '00:00', to: '00:01', days: [notToday] } });
    assert.ok(!(app.playouts.get('main')!.playout.listProfiles()).includes(never.id));
    app.svc.planning.processSchedules();
    assert.ok(!(app.playouts.get('main')!.playout.listProfiles()).includes(never.id), 'bleibt aus - Takt deaktiviert nichts fälschlich');
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
