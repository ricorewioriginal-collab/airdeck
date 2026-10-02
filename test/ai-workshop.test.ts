/**
 * KI-Werkstatt: Assistent mit Verlauf, Ton-Umschreiber, Sendeablauf-Tabelle, Hilfsfunktionen (SRT/JSON)
 * und Spot-Mix (Sprache über Musikbett mit Ducking, braucht ffmpeg). Text-KI wird gemockt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { parseJsonRows, parseSrt, toSrt } from '../src/server/services/ai.ts';
import { detectFfmpeg } from '../src/server/ffmpeg.ts';

const ff = detectFfmpeg(process.cwd());

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

test('SRT ↔ Segmente, JSON-Tabelle aus Prosa', () => {
  const segs = [{ start: 0, end: 1.5, text: 'Hallo' }, { start: 61.25, end: 63, text: 'Welt' }];
  const srt = toSrt(segs);
  assert.match(srt, /00:00:00,000 --> 00:00:01,500/);
  assert.match(srt, /00:01:01,250 --> 00:01:03,000/);
  assert.deepEqual(parseSrt(srt), segs);
  assert.deepEqual(parseJsonRows('Hier dein Plan:\n```json\n[{"time":"10:00","minutes":3}]\n```'), [{ time: '10:00', minutes: 3 }]);
  assert.equal(parseJsonRows('kein json'), null);
});

test('Assistent mit Verlauf, Ton-Umschreiber und Sendeablauf-Planer (Text-KI gemockt)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-ai-'));
  try {
    const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
    const calls: { system: string; prompt: string }[] = [];
    (app.ai as any).text = async (_s: string, _p: string, _t: unknown, system: string, prompt: string) => {
      calls.push({ system, prompt });
      if (/JSON-Array/.test(system)) return { text: 'Gern:\n[{"time":"10:00","minutes":4,"segment":"Musik","content":"Zwei Oldies"},{"time":"10:04","minutes":56,"segment":"Moderation","content":"Begrüßung"}]', providerId: 'p', model: 'mock', cost: 0 };
      return { text: `ANTWORT(${prompt.slice(-20)})`, providerId: 'p', model: 'mock', cost: 0.001 };
    };
    const a = await app.svc.ai.chatSend('main', 'Schreib einen Gruß', 'immer per Du');
    assert.match(a.reply, /ANTWORT/);
    assert.match(calls[0]!.system, /immer per Du/);
    await app.svc.ai.chatSend('main', 'Und kürzer');
    assert.match(calls[1]!.prompt, /Bisheriger Verlauf/, 'Verlauf geht als Kontext mit');
    assert.equal(app.svc.ai.chat('main').length, 4);
    await assert.rejects(app.svc.ai.chatSend('main', '   '), /eingeben/);
    app.svc.ai.chatClear('main');
    assert.equal(app.svc.ai.chat('main').length, 0);

    const rw = await app.svc.ai.rewrite('main', 'Text', 'witziger');
    assert.match(rw.text, /ANTWORT/);
    assert.match(calls.at(-1)!.system, /witziger/);
    await assert.rejects(app.svc.ai.rewrite('main', 'Text', 'lauter'), /Ton:/);

    const plan = await app.svc.ai.planShow('main', { topic: 'Oldies', minutes: 60, startTime: '10:00' });
    assert.equal(plan.rows.length, 2);
    assert.equal(plan.rows[0]!.segment, 'Musik');
    assert.equal(plan.rows[1]!.minutes, 56);
    await assert.rejects(app.svc.ai.planShow('main', { topic: '' }), /Thema/);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Spot-Mix: Stimme über Musikbett, Länge = Vorlauf + Stimme + Nachlauf', { skip: !ff && 'ffmpeg nicht installiert', timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-mix-'));
  try {
    const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: ff });
    wav(join(app.mediaDir, 'main', 'voice.wav'), 2, 300);
    wav(join(app.mediaDir, 'main', 'bed.wav'), 1, 880);
    app.svc.media.addMedia('main', { id: 'voice', title: 'Spot-Stimme', artist: '', category: 'tts', file: 'voice.wav', durationMs: 2000, addedAt: 0 });
    app.svc.media.addMedia('main', { id: 'bed', title: 'Bett', artist: '', category: 'bed', file: 'bed.wav', durationMs: 1000, addedAt: 0 });
    const m = await app.svc.ai.spotMix('main', { voiceMediaId: 'voice', bedMediaId: 'bed', tailMs: 1000, title: 'Testspot' });
    assert.equal(m.category, 'ad');
    assert.equal(m.title, 'Testspot');
    assert.ok(Math.abs((m.durationMs ?? 0) - 3600) < 50, `Länge ≈ 0,6 + 2 + 1 s (${m.durationMs})`);
    assert.ok(app.svc.media.library('main').some((x) => x.id === m.id));
    await assert.rejects(app.svc.ai.spotMix('main', { voiceMediaId: 'nope', bedMediaId: 'bed' }));
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
