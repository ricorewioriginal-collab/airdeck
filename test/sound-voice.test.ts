/**
 * Sound & Stimme: Master-Filterkette (Bass/Höhen, Stereo-Breite, Presets) und Mikrofon-Kette (Gate,
 * Trittschall, Sprach-EQ, De-Esser, Kompressor) als ffmpeg-Filter; Konfiguration klemmt Werte. Mit ffmpeg
 * werden die Ketten tatsächlich auf ein Testsignal angewendet (Syntax-/Filterprüfung).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { DEFAULT_MIC, DSP_PRESETS, dspFilter, micFilter } from '../src/server/playout.ts';
import { detectFfmpeg } from '../src/server/ffmpeg.ts';

const ff = detectFfmpeg(process.cwd());

test('dspFilter: Bass/Höhen, Stereo-Breite und Presets ergeben gültige Ketten', () => {
  const base = { eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], compressor: false, limiter: false };
  assert.equal(dspFilter(base), null);
  assert.match(dspFilter({ ...base, bassDb: 3, trebleDb: -2 })!, /bass=g=3:f=110,treble=g=-2:f=4000/);
  assert.match(dspFilter({ ...base, stereoWidth: 150 })!, /stereotools=mlev=1:slev=1\.50/);
  assert.match(dspFilter({ ...base, stereoWidth: 0 })!, /pan=stereo/);
  assert.equal(dspFilter({ ...base, stereoWidth: 100 }), null, '100 % = unverändert');
  for (const [id, p] of Object.entries(DSP_PRESETS)) assert.ok(dspFilter(p.dsp) !== null || id === 'neutral' || id === 'classic', id);
  assert.match(dspFilter(DSP_PRESETS.radio!.dsp)!, /^highpass=f=60:p=2,/, 'Hochpass kommt zuerst');
});

test('micFilter: Kette nach Einstellungen', () => {
  assert.match(micFilter(DEFAULT_MIC)!, /^highpass=f=70:p=2,acompressor=threshold=0\.24:ratio=2\.[89]/);
  assert.equal(micFilter({ gate: 0, highpass: false, eq: 'off', deesser: false, compressor: 0 }), null);
  const full = micFilter({ gate: 50, highpass: true, eq: 'radio', deesser: true, compressor: 100 })!;
  assert.match(full, /^agate=threshold=0\.0320/);
  assert.match(full, /highpass=f=90:p=2/);
  assert.match(full, /deesser=/);
  assert.match(full, /acompressor=threshold=0\.10:ratio=6\.0/);
  assert.match(micFilter({ ...DEFAULT_MIC, eq: 'clear' })!, /equalizer=f=3500/);
});

test('Konfiguration: Bass/Höhen/Breite und Mikro-Kette werden geklemmt und in der Ansicht geliefert', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-snd-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    app.savePlayoutConfig('main', { dsp: { bassDb: 40, trebleDb: -3, stereoWidth: 999 }, mic: { gate: 150, compressor: -5, eq: 'warm', deesser: true, highpass: false } } as any);
    const v = app.playoutView('main') as any;
    assert.equal(v.config.dsp.bassDb, 12);
    assert.equal(v.config.dsp.trebleDb, -3);
    assert.equal(v.config.dsp.stereoWidth, 200);
    assert.deepEqual(v.config.mic, { gate: DEFAULT_MIC.gate, highpass: false, eq: 'warm', deesser: true, compressor: DEFAULT_MIC.compressor }, 'ungültige Zahlen → bisherige Werte');
    assert.ok(v.micEq.radio);
    app.savePlayoutConfig('main', { mic: { gate: 40, compressor: 60 } } as any);
    assert.equal((app.playoutView('main') as any).config.mic.gate, 40);
    assert.equal((app.playoutView('main') as any).config.mic.eq, 'warm', 'Teil-Update behält den Rest');
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ffmpeg akzeptiert alle Preset- und Mikro-Ketten', { skip: !ff && 'ffmpeg nicht installiert' }, () => {
  const chains = [
    ...Object.values(DSP_PRESETS).map((p) => dspFilter(p.dsp)).filter((x): x is string => !!x),
    micFilter({ gate: 70, highpass: true, eq: 'radio', deesser: true, compressor: 80 })!,
    micFilter({ gate: 10, highpass: false, eq: 'clear', deesser: false, compressor: 20 })!,
    dspFilter({ eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], compressor: false, limiter: true, stereoWidth: 0 })!,
  ];
  for (const af of chains) {
    execFileSync(ff!.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.3', '-ac', '2', '-af', af, '-f', 'null', '-'], { timeout: 30_000 });
  }
});
