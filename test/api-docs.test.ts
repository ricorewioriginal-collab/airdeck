// API-Dokumentation: jede Route ist beschrieben, die eingecheckten Referenzdateien sind aktuell,
// und /api/v1/openapi.json liefert dieselbe Spezifikation ohne Anmeldung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { ALL_SCOPES } from '../src/server/model.ts';
import { buildMarkdown, buildOpenApi, endpoints, parseSummaries, scopeTable, tagOf, TAGS } from '../src/server/api/spec.ts';

const root = join(import.meta.dirname, '..');
const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;

function setup() {
  const app = new AnMaChaCastApp(mkdtempSync(join(tmpdir(), 'anmachacast-apidoc-')), { stableMs: 0, ffmpeg: null });
  return { app, server: createHttpServer(app, join(root, 'studio')) };
}

test('Jede Route hat eine Beschreibung, jede Beschreibung eine Route', () => {
  const { server } = setup();
  const sums = parseSummaries();
  const have = new Set(server.apiRoutes.map((r) => `${r.method} ${r.path.replace('/api/v1', '')}`));
  const missing = [...have].filter((k) => !sums.get(k));
  const stale = [...sums.keys()].filter((k) => !have.has(k));
  assert.deepEqual(missing, [], 'Route ohne Beschreibung in src/server/api/summaries.ts');
  assert.deepEqual(stale, [], 'Beschreibung ohne Route in src/server/api/summaries.ts');
  assert.ok(have.size > 300);
});

test('Bereiche: alle Endpunkte liegen in einem bekannten Bereich', () => {
  const { server } = setup();
  const names = new Set(TAGS.map((t) => t.name));
  for (const e of endpoints(server.apiRoutes)) assert.ok(names.has(e.tag), `${e.method} ${e.path} → ${e.tag}`);
  assert.equal(tagOf('/stations/:sid/podcast/host'), 'Podcast');
  assert.equal(tagOf('/stations/:sid/media/:id/voice-edit'), 'Bibliothek');
  assert.equal(tagOf('/pairing'), 'Apps & Geräte');
  assert.equal(tagOf('/music-hub/nextcloud/list'), 'Nextcloud');
});

test('Alle Rechte sind beschrieben und werden von Routen verwendet', () => {
  const { server } = setup();
  const used = new Set(server.apiRoutes.map((r) => r.scope).filter(Boolean));
  for (const s of used) assert.ok((ALL_SCOPES as readonly string[]).includes(s!), `unbekanntes Recht ${s}`);
  for (const [s, text] of scopeTable()) assert.ok(text, `Recht ${s} ohne Beschreibung`);
});

test('docs/openapi.json und docs/API-REFERENCE.md sind aktuell (npm run docs:api)', () => {
  const { server } = setup();
  const json = JSON.stringify(buildOpenApi(server.apiRoutes, version), null, 2) + '\n';
  assert.equal(readFileSync(join(root, 'docs', 'openapi.json'), 'utf8'), json, 'docs/openapi.json veraltet – npm run docs:api ausführen');
  assert.equal(readFileSync(join(root, 'docs', 'API-REFERENCE.md'), 'utf8'), buildMarkdown(server.apiRoutes, version), 'docs/API-REFERENCE.md veraltet – npm run docs:api ausführen');
});

test('OpenAPI: gültige Struktur, Pfadparameter, Rechte und öffentliche Auslieferung', async () => {
  const { server } = setup();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const res = await fetch(`${base}/api/v1/openapi.json`); // ohne Anmeldung
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const spec = await res.json() as { openapi: string; paths: Record<string, Record<string, { summary: string; security?: unknown[]; parameters: Array<{ name: string }>; 'x-scope'?: string; operationId: string }>> };
    assert.equal(spec.openapi, '3.1.0');
    const ids = new Set<string>();
    let ops = 0;
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(methods)) {
        ops++;
        assert.ok(op.summary, `${m} ${path} ohne Beschreibung`);
        assert.ok(!ids.has(op.operationId), `doppelte operationId ${op.operationId}`);
        ids.add(op.operationId);
        const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
        assert.deepEqual(op.parameters.map((p) => p.name), inPath, `${m} ${path}: Parameter`);
      }
    }
    assert.ok(ops > 320);
    assert.deepEqual(spec.paths['/stations/{sid}/queue']!.post!.security, [{ bearer: ['queue:write'] }]);
    assert.equal(spec.paths['/stations/{sid}/queue']!.post!['x-scope'], 'queue:write');
    assert.deepEqual(spec.paths['/auth/login']!.post!.security, [], 'Anmeldung braucht keine Anmeldung');
    // OpenAPI ist Dokumentation, kein Schlupfloch: geschützte Routen bleiben geschützt
    assert.equal((await fetch(`${base}/api/v1/stations/main/queue`)).status, 401);
  } finally {
    server.close();
  }
});
