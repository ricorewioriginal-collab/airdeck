// MusikHub Phase 3: Inhaltsbasierte Dublettenerkennung (sha256) für private Uploads - verhindert
// unnötigen doppelten Speicherverbrauch im eigenen Archiv, unabhängig vom Dateinamen. Gilt für
// direkten Upload, Ersetzen (Quellen-/Versionsmodell) und Nextcloud-Einzeldatei-Import gleichermaßen.
// Rein pro Eigentümer - fremde Archive werden nie verglichen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('MusikHub: Dublettenerkennung per Inhalts-Hash (Upload, Ersetzen, Nextcloud-Import)', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.musikhub-dup-test-'));
  const app = new AirDeckApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const put = (token: string, path: string, body: Buffer) => fetch(`${base}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body });

  const DAV = '/remote.php/dav/files/dupnutzer';
  const NC_FILES: Record<string, Buffer> = {};
  const davSrv = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '').slice(DAV.length)).replace(/\/$/, '');
    if (req.headers.authorization !== 'Basic ' + Buffer.from('dupnutzer:app-pw').toString('base64')) return void res.writeHead(401).end();
    if (req.method === 'GET' && NC_FILES[p]) return void res.end(NC_FILES[p]);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => davSrv.listen(0, '127.0.0.1', r));
  const davUrl = `http://127.0.0.1:${(davSrv.address() as { port: number }).port}/`;

  try {
    const owner = await app.users.create({ username: 'dupnutzer', password: 'Dupnutzer-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const other = await app.users.create({ username: 'anderernutzer', password: 'Anderer-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('dupnutzer', 'Dupnutzer-Passwort1');
    const tOther = await login('anderernutzer', 'Anderer-Passwort1');

    const contentA = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7) % 256));
    const contentB = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 11) % 256));

    // Erster Upload gelingt normal.
    const firstRes = await put(to, '/music-hub/uploads?name=Original.mp3', contentA);
    assert.equal(firstRes.status, 200);
    const first = await firstRes.json() as { id: string; title: string; source: { file: string } };

    // Identischer Inhalt unter anderem Dateinamen: abgelehnt, keine zweite Datei, kein zweiter Katalogeintrag.
    const dupRes = await put(to, '/music-hub/uploads?name=Kopie-anderer-Name.mp3', contentA);
    assert.equal(dupRes.status, 409);
    const dupBody = await dupRes.json() as { error: string; message: string };
    assert.equal(dupBody.error, 'duplicate_content');
    assert.match(dupBody.message, /Original/);
    assert.equal((await call(to, 'GET', '/music-hub/items?station=main&q=Kopie')).body.total, 0);
    const uploadDir = join(dir, 'musikhub', 'uploads', owner.id);
    assert.equal(readdirSync(uploadDir).length, 1, 'kein Datei-Fragment durch den abgelehnten Duplikat-Upload');

    // Anderer Inhalt gelingt weiterhin normal (Dublettenerkennung blockiert nicht generell).
    const secondRes = await put(to, '/music-hub/uploads?name=Anderer-Inhalt.mp3', contentB);
    assert.equal(secondRes.status, 200);
    const second = await secondRes.json() as { id: string };
    assert.equal(readdirSync(uploadDir).length, 2);

    // Derselbe Inhalt bei einem ANDEREN Nutzer ist kein Duplikat - Dublettenerkennung ist strikt pro Eigentümer.
    const otherUploadRes = await put(tOther, '/music-hub/uploads?name=Original.mp3', contentA);
    assert.equal(otherUploadRes.status, 200, 'Dublettenerkennung vergleicht nie über Eigentümergrenzen hinweg');

    // Ersetzen des zweiten Titels durch den bereits vorhandenen Inhalt des ersten: abgelehnt.
    const replaceDupRes = await put(to, `/music-hub/items/${second.id}/replace?station=main&name=X.mp3`, contentA);
    assert.equal(replaceDupRes.status, 409);
    assert.equal((await call(to, 'GET', `/music-hub/items?station=main&q=Anderer`)).body.total, 1, 'nicht erfolgreiches Ersetzen ändert den bestehenden Titel nicht');

    // Ersetzen eines Titels durch exakt seinen EIGENEN aktuellen Inhalt ist kein Duplikat (Selbstausschluss).
    const selfReplaceRes = await put(to, `/music-hub/items/${first.id}/replace?station=main&name=Original-erneut.mp3`, contentA);
    assert.equal(selfReplaceRes.status, 200, 'Ersetzen mit identischem eigenem Inhalt wird nicht fälschlich als Duplikat abgelehnt');

    // Nextcloud-Import: identischer Inhalt wie ein bereits vorhandener Titel landet als Sammelfehler,
    // nicht als zweiter Katalogeintrag - auch hier keine verwaiste Datei.
    NC_FILES['/Radio/Duplikat.mp3'] = contentB;
    NC_FILES['/Radio/Neu.mp3'] = Buffer.from('komplett anderer, neuer Inhalt');
    await call(to, 'PUT', '/music-hub/nextcloud', { url: davUrl, user: 'dupnutzer', password: 'app-pw', root: '/Radio' });
    const ncImport = await call(to, 'POST', '/music-hub/nextcloud/import', { paths: ['/Duplikat.mp3', '/Neu.mp3'] });
    assert.equal(ncImport.status, 200);
    assert.equal(ncImport.body.imported.length, 1, 'nur die wirklich neue Datei wird übernommen');
    assert.equal(ncImport.body.imported[0].title, 'Neu');
    assert.match(ncImport.body.errors[0], /bereits im eigenen Archiv/);
    assert.equal(readdirSync(uploadDir).length, 3, 'genau ein neuer Eintrag (Original, Anderer-Inhalt, Neu) - kein Duplikat-Fragment');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    davSrv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
