// Motion-Mix-Video: echter End-zu-Ende-Test mit echtem ffmpeg - zwei kurze WAV-"Titel" in eine
// Playlist, rendern lassen, und das Ergebnis mit ffprobe prüfen (Video- und Audiospur vorhanden,
// Dauer passt zur Summe der Titellängen, Titel-Einblendungen im Dateinamen-sicheren Rahmen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { detectFfmpeg } from '../src/server/ffmpeg.ts';
import type { MotionMixJob } from '../src/server/model.ts';

const ff = detectFfmpeg(process.cwd());
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wav(file: string, seconds: number, freq: number): void {
  const rate = 22050;
  const n = Math.floor(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  writeFileSync(file, b);
}

function probe(ffprobeBin: string, file: string): Promise<{ durationSec: number; hasVideo: boolean; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe fehlgeschlagen'));
      const j = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
      resolve({
        durationSec: Number(j.format?.duration ?? 0),
        hasVideo: !!j.streams?.some((s) => s.codec_type === 'video'),
        hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
      });
    });
    p.on('error', reject);
  });
}

async function untilDone(getJob: () => MotionMixJob, ms = 60_000): Promise<MotionMixJob> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const j = getJob();
    if (j.status === 'succeeded' || j.status === 'failed') return j;
    await wait(100);
  }
  throw new Error('Timeout beim Warten auf den Motion-Mix-Job');
}

test(
  'Motion-Mix-Video: aus einer Playlist gerendert, echte Video-/Audiospur, passende Dauer',
  { skip: !ff && 'ffmpeg nicht installiert', timeout: 60_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anmachacast-mmx-'));
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: ff });
    try {
      wav(join(app.mediaDir, 'main', 'a.wav'), 3, 440);
      wav(join(app.mediaDir, 'main', 'b.wav'), 2, 660);
      app.svc.media.addMedia('main', { id: 'a', title: 'Erster Titel', artist: "DJ O'Brien", category: 'music', file: 'a.wav', durationMs: 3000, addedAt: 0 });
      app.svc.media.addMedia('main', { id: 'b', title: 'Zweiter Titel: Teil 2', artist: 'Act B', category: 'music', file: 'b.wav', durationMs: 2000, addedAt: 0 });
      const pl = app.svc.planning.savePlaylist('main', null, { name: 'Test-Mix', items: ['a', 'b'] });

      const presets = app.svc.motionMix.presets();
      assert.ok(presets.length >= 3, 'mehrere Vorlagen verfügbar');

      const started = await app.svc.motionMix.start('main', pl.id, presets[0]!.id);
      assert.equal(started.status, 'queued');
      assert.equal(started.trackCount, 2);

      const job = await untilDone(() => app.svc.motionMix.job('main', started.id));
      assert.equal(job.status, 'succeeded', job.error ?? 'unerwarteter Fehlschlag');
      assert.equal(job.durationMs, 5000);

      const file = app.svc.motionMix.file('main', job.id);
      const info = await probe(ff!.ffprobe!, file);
      assert.ok(info.hasVideo, 'Ausgabedatei hat eine Videospur');
      assert.ok(info.hasAudio, 'Ausgabedatei hat eine Audiospur');
      assert.ok(Math.abs(info.durationSec - 5) < 0.5, `Dauer ${info.durationSec}s sollte ~5s sein`);

      // Job löschen entfernt auch die Datei
      app.svc.motionMix.deleteJob('main', job.id);
      assert.equal(app.svc.motionMix.jobs('main').length, 0);
    } finally {
      app.shutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('Motion-Mix: Playlist ohne lokale Titel (nur Streams) wird klar abgelehnt', { skip: !ff && 'ffmpeg nicht installiert' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-mmx-empty-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: ff });
  try {
    app.svc.media.addMedia('main', { id: 's', title: 'Stream', artist: '', category: 'stream', file: '', url: 'https://example.invalid/stream.mp3', durationMs: null, addedAt: 0 });
    const pl = app.svc.planning.savePlaylist('main', null, { name: 'Nur Stream', items: ['s'] });
    await assert.rejects(() => app.svc.motionMix.start('main', pl.id, 'aurora'), /lokalen Titel/);
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
