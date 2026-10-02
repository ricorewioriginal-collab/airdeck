// KI-Gesundheits-Dashboard mit Quarantäne (Abgleich mit dem AI Studio von anmacha_control_center):
// nach wiederholten Fehlern in Folge wird ein Provider automatisch übersprungen, statt bei jedem
// Aufruf erneut die volle Fehlerstrecke abzuwarten - der Fallback-Provider springt sofort ein.
// Ein einzelner Erfolg oder ein manuelles "Freigeben" hebt die Sperre sofort wieder auf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { AiError } from '../src/server/ai/providers.ts';

let mock: Server;
let base: string;
let calls: string[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-ai-health-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
  app.ai.update({
    providers: [
      { id: 'flaky', name: 'Wackelig', role: 'text', kind: 'openai_compat', baseUrl: `${base}/flaky/v1` },
      { id: 'backup', name: 'Ersatz', role: 'text', kind: 'openai_compat', baseUrl: `${base}/backup/v1` },
    ],
  });
  return { dir, app, done: () => { app.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test('Provider-Quarantäne nach wiederholten Fehlern, Fallback springt ein, manuelle Freigabe', async (t) => {
  calls = [];
  mock = createServer((req, res) => {
    calls.push(req.url ?? '');
    if (req.url?.startsWith('/flaky/')) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'kaputt' } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok von backup' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  t.after(() => mock.close());

  const { app, done } = setup();
  try {
    const only = [{ providerId: 'flaky', model: 'm' }];
    const both = [{ providerId: 'flaky', model: 'm' }, { providerId: 'backup', model: 'm' }];

    // Erste zwei Fehlschläge: noch keine Quarantäne, aber bereits gezählt
    await assert.rejects(app.ai.text('main', 'test', only, 's', 'p'), AiError);
    await assert.rejects(app.ai.text('main', 'test', only, 's', 'p'), AiError);
    let h = (app.ai.healthView() as { providerId: string; consecutiveFailures: number; quarantinedUntil?: number }[]).find((x) => x.providerId === 'flaky')!;
    assert.equal(h.consecutiveFailures, 2);
    assert.equal(h.quarantinedUntil, undefined, 'noch keine Quarantäne vor der dritten Fehlschlagsserie');

    // Dritter Fehlschlag löst die Quarantäne aus
    await assert.rejects(app.ai.text('main', 'test', only, 's', 'p'), AiError);
    h = (app.ai.healthView() as typeof h[]).find((x) => x.providerId === 'flaky')!;
    assert.equal(h.consecutiveFailures, 3);
    assert.ok(h.quarantinedUntil && h.quarantinedUntil > Date.now(), 'Provider ist jetzt in Quarantäne');

    const callsBeforeQuarantine = calls.filter((c) => c.startsWith('/flaky/')).length;
    assert.equal(callsBeforeQuarantine, 3, 'drei echte Versuche gegen den wackeligen Provider');

    // Mit Fallback: während der Quarantäne wird der wacklige Provider gar nicht mehr angefragt
    const r = await app.ai.text('main', 'test', both, 's', 'p');
    assert.equal(r.providerId, 'backup');
    assert.equal(calls.filter((c) => c.startsWith('/flaky/')).length, callsBeforeQuarantine, 'kein weiterer Versuch gegen den Provider in Quarantäne');

    // Manuelle Freigabe setzt den Zustand sofort zurück
    app.ai.releaseProvider('flaky');
    h = (app.ai.healthView() as typeof h[]).find((x) => x.providerId === 'flaky')!;
    assert.equal(h.consecutiveFailures, 0);
    assert.equal(h.quarantinedUntil, undefined);
    await assert.rejects(app.ai.text('main', 'test', only, 's', 'p'), AiError, 'nach der Freigabe wird wieder echt versucht');
    assert.equal(calls.filter((c) => c.startsWith('/flaky/')).length, callsBeforeQuarantine + 1);
  } finally {
    done();
  }
});

test('Ein Erfolg hebt eine laufende Fehlerserie sofort auf', async (t) => {
  calls = [];
  let fail = true;
  mock = createServer((req, res) => {
    calls.push(req.url ?? '');
    if (fail) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'kaputt' } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'wieder da' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  t.after(() => mock.close());

  const { app, done } = setup();
  try {
    const only = [{ providerId: 'flaky', model: 'm' }];
    await assert.rejects(app.ai.text('main', 'test', only, 's', 'p'), AiError);
    await assert.rejects(app.ai.text('main', 'test', only, 's', 'p'), AiError);
    fail = false;
    const r = await app.ai.text('main', 'test', only, 's', 'p');
    assert.equal(r.text, 'wieder da');
    const h = (app.ai.healthView() as { providerId: string; consecutiveFailures: number }[]).find((x) => x.providerId === 'flaky')!;
    assert.equal(h.consecutiveFailures, 0, 'Erfolg setzt die Fehlerserie zurück');
  } finally {
    done();
  }
});
