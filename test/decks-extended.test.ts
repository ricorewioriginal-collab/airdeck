// Decks erweitert: Tempo (atempo), Handschleife und Wellenform. Echtes ffmpeg, sonst übersprungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { detectFfmpeg } from '../src/server/ffmpeg.ts';
import type { PlayoutStatus } from '../src/server/playout.ts';

const ff = detectFfmpeg(process.cwd());
const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timeout');
    await wait(25);
  }
}
/** Sinus, in der ersten Hälfte laut und in der zweiten leise: die Wellenform muss das zeigen. */
function wav(file: string, seconds: number): void {
  const rate = 22050;
  const n = Math.floor(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round((i < n / 2 ? 20000 : 2000) * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  writeFileSync(file, b);
}

test('Decks erweitert: Tempo, Handschleife, Wellenform', { skip: !ff && 'ffmpeg nicht installiert', timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-decks-ext-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: ff });
  try {
    wav(join(app.mediaDir, 'main', 'lang.wav'), 40);
    app.svc.media.addMedia('main', { id: 'lang', title: 'Lang', artist: 'x', category: 'music', file: 'lang.wav', durationMs: 40_000, addedAt: 0 });
    app.setBaseMode(admin, 'main', 'MANUAL');
    app.start();
    const st = () => (app.playoutView('main') as { status: PlayoutStatus | null }).status!;
    const deck = (id: string) => st().decks.find((d) => d.id === id)!;

    // Wellenform: 600 Werte, erste Hälfte deutlich lauter als die zweite
    const peaks = await app.svc.media.waveform('main', 'lang');
    assert.equal(peaks.length, 600);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    assert.ok(avg(peaks.slice(0, 280)) > avg(peaks.slice(320)) + 20, 'laut vorn, leise hinten');
    assert.deepEqual(await app.svc.media.waveform('main', 'lang'), peaks, 'zweiter Abruf aus dem Zwischenspeicher gleich');

    app.deckAction(admin, 'main', 'A', 'load', { mediaId: 'lang' });
    assert.throws(() => app.deckAction(admin, 'main', 'A', 'loop', { ms: 2000 }), /spielt nicht/);

    // Tempo +25 %: nach ~2 s Wiedergabe steht die Position bei ca. 2,5 s Dateizeit
    app.deckAction(admin, 'main', 'A', 'tempo', { tempo: 1.25 });
    assert.equal(deck('A').tempo, 1.25);
    app.deckAction(admin, 'main', 'A', 'tempo', { tempo: 5 });
    assert.equal(deck('A').tempo, 1.25, 'Tempo wird auf 1,25 begrenzt');
    app.deckAction(admin, 'main', 'A', 'play', {});
    await until(() => deck('A').positionMs > 2000, 10_000);
    const fast = deck('A').positionMs;
    assert.ok(fast > 2000 && fast < 6000, `Dateizeit schneller als Echtzeit (${fast})`);

    // Tempo während des Spielens ändern: geht an derselben Stelle weiter
    app.deckAction(admin, 'main', 'A', 'tempo', { tempo: 1 });
    assert.equal(deck('A').state, 'playing');
    assert.ok(deck('A').positionMs >= fast - 500, `weiter ab ${fast}, jetzt ${deck('A').positionMs}`);

    // Schleife über 1 s: Position bleibt im Bereich, Schleife wird gemeldet und verlassen
    app.deckAction(admin, 'main', 'A', 'loop', { ms: 1000 });
    await until(() => deck('A').loop != null, 3000);
    const lp = deck('A').loop!;
    assert.ok(Math.abs(lp.outMs - lp.inMs - 1000) < 60, `Schleifenlänge ${lp.outMs - lp.inMs}`);
    await wait(2500);
    assert.ok(st().loops?.some((l) => l.mediaId === 'lang' && l.loopCount >= 1), 'wiederholt sich');
    assert.ok(deck('A').positionMs <= lp.outMs + 100, 'Position bleibt am Schleifenende');
    // Tempo ändern mitten in der Schleife: Schleife bleibt bestehen
    app.deckAction(admin, 'main', 'A', 'tempo', { tempo: 1.1 });
    await until(() => deck('A').loop != null, 3000);
    assert.ok(Math.abs(deck('A').loop!.inMs - lp.inMs) < 5, 'gleicher Schleifenanfang');
    app.deckAction(admin, 'main', 'A', 'loop', { ms: 0 });
    await until(() => deck('A').loop == null && deck('A').positionMs > lp.outMs + 300, 5000);

    // Eject setzt das Tempo zurück
    app.deckAction(admin, 'main', 'A', 'tempo', { tempo: 0.9 });
    app.deckAction(admin, 'main', 'A', 'eject', {});
    assert.equal(deck('A').tempo, 1);
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
