import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

const studio = join(import.meta.dirname, '../studio');

test('PWA: Service Worker wird als JavaScript ausgeliefert, nutzt keinen API-Cache und ist eingebunden', async () => {
  const app = new AnMaChaCastApp(mkdtempSync(join(tmpdir(), 'anmachacast-pwa-')), { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, studio);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const r = await fetch(`${base}/sw.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /javascript/);
    assert.match(await r.text(), /startsWith\('\/api\/'\)/);
    const pwa = await fetch(`${base}/js/pwa.js`);
    assert.equal(pwa.status, 200);
    for (const f of ['mobil.html', 'mobil.css', 'mobil.webmanifest', 'js/mobil.js']) assert.equal((await fetch(`${base}/${f}`)).status, 200, f);
    // Mobil-Web-App der Projektseite (GitHub Pages) darf den Server erreichen
    const pre = await fetch(`${base}/api/v1/stations`, { method: 'OPTIONS', headers: { Origin: 'https://ricorewioriginal-collab.github.io', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://ricorewioriginal-collab.github.io');
  } finally {
    server.close();
  }
  const html = readFileSync(join(studio, 'index.html'), 'utf8');
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(readFileSync(join(studio, 'js/app.js'), 'utf8'), /registerWorker\(\)/);
});
