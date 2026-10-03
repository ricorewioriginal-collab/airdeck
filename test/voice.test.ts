// Voice Studio: Schnittberechnung (ohne ffmpeg) und echte Bearbeitung (mit ffmpeg).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { detectFfmpeg, generateTestTone, probeDurationMs } from '../src/server/ffmpeg.ts';
import { buildVoiceFilter, keptSegments } from '../src/server/services/voice.ts';

const ff = detectFfmpeg(process.cwd());

test('Schnitte: übrig bleibende Abschnitte, Zusammenfassen und Grenzen', () => {
  assert.deepEqual(keptSegments(10_000, {}), [{ fromMs: 0, toMs: 10_000 }]);
  assert.deepEqual(keptSegments(10_000, { cuts: [{ fromMs: 2000, toMs: 4000 }] }), [{ fromMs: 0, toMs: 2000 }, { fromMs: 4000, toMs: 10_000 }]);
  // überlappende und verkehrt liegende Schnitte werden zusammengefasst, Werte außerhalb begrenzt
  assert.deepEqual(keptSegments(10_000, { cuts: [{ fromMs: 3000, toMs: 5000 }, { fromMs: 4000, toMs: 6000 }, { fromMs: 9500, toMs: 99_000 }] }), [{ fromMs: 0, toMs: 3000 }, { fromMs: 6000, toMs: 9500 }]);
  assert.deepEqual(keptSegments(10_000, { keep: { fromMs: 1000, toMs: 5000 }, cuts: [{ fromMs: 2000, toMs: 3000 }] }), [{ fromMs: 1000, toMs: 2000 }, { fromMs: 3000, toMs: 5000 }]);
  assert.deepEqual(keptSegments(10_000, { cuts: [{ fromMs: 0, toMs: 10_000 }] }), []);
});

test('Filterkette: Schnitte, Effekte und Fehler bei leerem Ergebnis', () => {
  const r = buildVoiceFilter(10_000, { cuts: [{ fromMs: 2000, toMs: 4000 }], denoise: 'strong', eq: 'voice', compressor: true, gate: true, gainDb: 3, normalize: true, fadeInMs: 200, fadeOutMs: 500, stripSilence: true });
  assert.equal(r.outMs, 8000);
  for (const part of ['concat=n=2', 'afftdn=nr=25', 'agate', 'acompressor', 'silenceremove', 'volume=3.0dB', 'loudnorm', 'areverse', 'alimiter']) assert.ok(r.filter.includes(part), part);
  assert.throws(() => buildVoiceFilter(5000, { cuts: [{ fromMs: 0, toMs: 5000 }] }), /nichts übrig/);
  // ein einziger Abschnitt braucht kein concat
  assert.ok(!buildVoiceFilter(5000, {}).filter.includes('concat'));
});

test('Voice Studio: Schneiden, Effekte, Vorschau und Speichern mit echtem ffmpeg', { skip: !ff && 'ffmpeg nicht installiert', timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-voice-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: ff });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = app.svc.auth.createToken({ name: 'a', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    await generateTestTone(ff!.ffmpeg, join(app.mediaDir, 'main', 'rede.mp3'), 8, 440);
    app.svc.media.addMedia('main', { id: 'rede', title: 'Rede', artist: 'Ich', category: 'voice_track', file: 'rede.mp3', durationMs: 8000, addedAt: 0 });

    // Speichern: 2 s herausschneiden, Rauschentfernung, EQ, Kompressor, Normalisieren, Fades
    const r = await fetch(`${base}/api/v1/stations/main/media/rede/voice-edit`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ cuts: [{ fromMs: 2000, toMs: 4000 }], denoise: 'light', eq: 'voice', compressor: true, normalize: true, fadeInMs: 100, fadeOutMs: 300, title: 'Rede kurz', category: 'jingle' }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const item = (await r.json()) as { id: string; title: string; category: string; durationMs: number; file: string; folder?: string };
    assert.equal(item.title, 'Rede kurz');
    assert.equal(item.category, 'jingle');
    assert.ok(Math.abs(item.durationMs - 6000) < 250, `Länge ${item.durationMs}`);
    assert.ok(statSync(join(app.mediaDir, 'main', item.file)).size > 5000);
    assert.equal(app.svc.media.library('main').length, 2, 'Original bleibt, Ergebnis kommt dazu');

    // Vorschau: Audio-Antwort, nichts in der Bibliothek
    const p = await fetch(`${base}/api/v1/stations/main/media/rede/voice-edit`, { method: 'POST', headers: auth, body: JSON.stringify({ preview: true, keep: { fromMs: 1000, toMs: 3000 } }) });
    assert.equal(p.status, 200);
    assert.equal(p.headers.get('content-type'), 'audio/mpeg');
    assert.ok((await p.arrayBuffer()).byteLength > 1000);
    assert.equal(app.svc.media.library('main').length, 2);

    // Fehler: alles herausgeschnitten, unbekannte Stufe
    assert.equal((await fetch(`${base}/api/v1/stations/main/media/rede/voice-edit`, { method: 'POST', headers: auth, body: JSON.stringify({ cuts: [{ fromMs: 0, toMs: 8000 }] }) })).status, 400);
    assert.equal((await fetch(`${base}/api/v1/stations/main/media/rede/voice-edit`, { method: 'POST', headers: auth, body: JSON.stringify({ denoise: 'extrem' }) })).status, 400);
    // ohne Schreibrecht kein Zugriff
    const viewer = app.svc.auth.createToken({ name: 'v', scopes: ['media:read'], roles: ['viewer'], stationIds: ['main'] }).token;
    assert.equal((await fetch(`${base}/api/v1/stations/main/media/rede/voice-edit`, { method: 'POST', headers: { Authorization: `Bearer ${viewer}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    // Länge der gespeicherten Datei stimmt mit der Messung überein
    const measured = await probeDurationMs(ff!.ffprobe!, join(app.mediaDir, 'main', item.file));
    assert.ok(measured && Math.abs(measured - item.durationMs) < 100);
  } finally {
    app.shutdown();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
