// MusikHub Phase 3: rekursiver Ordner-Import aus der eigenen Nextcloud-Quelle - begrenzt auf
// MAX_FOLDER_IMPORT_FILES Dateien und eine feste Verzeichnistiefe, damit kein unbegrenzter Vollscan im
// Anfragethread entstehen kann. Ergänzt den bereits vorhandenen Einzeldatei-Import
// (test/musikhub-nextcloud.test.ts) um den rekursiven Fall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { MAX_FOLDER_IMPORT_FILES } from '../src/server/services/musikhub.ts';

const DAV = '/remote.php/dav/files/rekursivnutzer';

function multistatus(files: Record<string, Buffer>, dir: string): string {
  const kids = new Set<string>();
  for (const f of Object.keys(files)) {
    if (!f.startsWith(dir + '/')) continue;
    const rest = f.slice(dir.length + 1).split('/');
    kids.add(rest.length > 1 ? rest[0]! : f.split('/').pop()!);
  }
  const resp = (href: string, isDir: boolean, size = 0) => `<d:response><d:href>${DAV}${href.split('/').map(encodeURIComponent).join('/')}</d:href><d:propstat><d:prop>${isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontentlength>${size}</d:getcontentlength><d:getcontenttype>audio/mpeg</d:getcontenttype>`}</d:prop></d:propstat></d:response>`;
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${resp(dir + '/', true)}${[...kids].map((k) => {
    const full = `${dir}/${k}`;
    const isDirKid = !files[full];
    return resp(full, isDirKid, isDirKid ? 0 : files[full]!.length);
  }).join('')}</d:multistatus>`;
}

test('MusikHub: rekursiver Nextcloud-Ordner-Import - Tiefenbegrenzung, Dateitypfilter, Kontingent, Dublettenerkennung als "übersprungen"', async () => {
  const FILES: Record<string, Buffer> = {
    '/Radio/Top.mp3': Buffer.from('top-level'),
    '/Radio/Sub/Nested.mp3': Buffer.from('eine-ebene-tief'),
    '/Radio/Sub/Notes.txt': Buffer.from('kein Audio'),
    '/Radio/L1/L2/L3/L4/Found.mp3': Buffer.from('vier-ebenen-tief-wird-noch-gefunden'),
    '/Radio/L1/L2/L3/L4/L5/TooDeep.mp3': Buffer.from('fuenf-ebenen-tief-zu-tief'),
  };
  const davSrv = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '').slice(DAV.length)).replace(/\/$/, '');
    if (req.headers.authorization !== 'Basic ' + Buffer.from('rekursivnutzer:app-pw').toString('base64')) return void res.writeHead(401).end();
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); return void res.end(multistatus(FILES, p)); }
    if (req.method === 'GET' && FILES[p]) return void res.end(FILES[p]);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => davSrv.listen(0, '127.0.0.1', r));
  const davUrl = `http://127.0.0.1:${(davSrv.address() as { port: number }).port}/`;

  const dir = mkdtempSync(join(process.cwd(), '.musikhub-nextcloud-folder-test-'));
  const app = new AirDeckApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await app.users.create({ username: 'rekursivnutzer', password: 'Rekursiv-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const to = (await call('', 'POST', '/auth/login', { username: 'rekursivnutzer', password: 'Rekursiv-Passwort1' })).body.token as string; // gitleaks:allow - Test-Passwort, kein echtes Secret
    await call(to, 'PUT', '/music-hub/nextcloud', { url: davUrl, user: 'rekursivnutzer', password: 'app-pw', root: '/Radio' });

    // Pfadausbruch abgelehnt, bevor irgendein Netzwerkzugriff stattfindet.
    assert.equal((await call(to, 'POST', '/music-hub/nextcloud/import-folder', { path: '/../..' })).status, 400);

    const res = await call(to, 'POST', '/music-hub/nextcloud/import-folder', { path: '/' });
    assert.equal(res.status, 200);
    const titles = (res.body.imported as { title: string }[]).map((i) => i.title).sort();
    assert.deepEqual(titles, ['Found', 'Nested', 'Top'], 'Top-Level, eine Ebene tief und genau vier Ebenen tief werden gefunden');
    assert.equal(res.body.imported.length, 3, 'Notizen.txt (kein Audio) und die fünf Ebenen tiefe Datei werden nicht importiert');
    assert.equal(res.body.errors.length, 0);

    // Erneuter Lauf über denselben Ordner: alles bereits vorhanden - als "übersprungen" gezählt, nicht als Fehler.
    const rerun = await call(to, 'POST', '/music-hub/nextcloud/import-folder', { path: '/' });
    assert.equal(rerun.status, 200);
    assert.equal(rerun.body.imported.length, 0);
    assert.equal(rerun.body.skipped, 3, 'Dublettenerkennung: erneuter Import desselben Ordners überspringt statt Fehler zu melden');
    assert.equal(rerun.body.errors.length, 0);
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    davSrv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MusikHub: rekursiver Nextcloud-Ordner-Import - harte Obergrenze an Dateien je Aufruf', async () => {
  const COUNT = MAX_FOLDER_IMPORT_FILES + 5;
  const FILES: Record<string, Buffer> = {};
  for (let i = 0; i < COUNT; i++) FILES[`/Radio/Viele/Titel-${i}.mp3`] = Buffer.from(`inhalt-${i}`);
  const davSrv = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '').slice(DAV.length)).replace(/\/$/, '');
    if (req.headers.authorization !== 'Basic ' + Buffer.from('rekursivnutzer:app-pw').toString('base64')) return void res.writeHead(401).end();
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); return void res.end(multistatus(FILES, p)); }
    if (req.method === 'GET' && FILES[p]) return void res.end(FILES[p]);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => davSrv.listen(0, '127.0.0.1', r));
  const davUrl = `http://127.0.0.1:${(davSrv.address() as { port: number }).port}/`;

  const dir = mkdtempSync(join(process.cwd(), '.musikhub-nextcloud-folder-cap-test-'));
  const app = new AirDeckApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await app.users.create({ username: 'rekursivnutzer', password: 'Rekursiv2-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const to = (await call('', 'POST', '/auth/login', { username: 'rekursivnutzer', password: 'Rekursiv2-Passwort1' })).body.token as string; // gitleaks:allow - Test-Passwort, kein echtes Secret
    await call(to, 'PUT', '/music-hub/nextcloud', { url: davUrl, user: 'rekursivnutzer', password: 'app-pw', root: '/Radio' });

    const res = await call(to, 'POST', '/music-hub/nextcloud/import-folder', { path: '/Viele' });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported.length, MAX_FOLDER_IMPORT_FILES, `bricht bei genau ${MAX_FOLDER_IMPORT_FILES} Dateien ab, obwohl ${COUNT} vorhanden sind`);
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    davSrv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
