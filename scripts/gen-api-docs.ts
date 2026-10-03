// Erzeugt docs/openapi.json und docs/API-REFERENCE.md aus der Routentabelle des Servers.
// Aufruf: npm run docs:api   (ein Test stellt sicher, dass die eingecheckten Dateien aktuell sind)
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { buildMarkdown, buildOpenApi } from '../src/server/api/spec.ts';

const root = join(import.meta.dirname, '..');
const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
const dir = mkdtempSync(join(tmpdir(), 'anmachacast-apidocs-'));
try {
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(root, 'studio'));
  writeFileSync(join(root, 'docs', 'openapi.json'), JSON.stringify(buildOpenApi(server.apiRoutes, version), null, 2) + '\n');
  writeFileSync(join(root, 'docs', 'API-REFERENCE.md'), buildMarkdown(server.apiRoutes, version));
  console.log('docs/openapi.json und docs/API-REFERENCE.md geschrieben');
  process.exit(0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
