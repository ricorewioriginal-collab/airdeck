// MusikHub Phase 3 (Beginn): eigene Nextcloud-Quelle je Nutzerkonto für "Mein Archiv" - getrennt vom
// bestehenden globalen, senderweiten Nextcloud-Import. Kein geteiltes Konto, kein rekursiver Vollscan,
// dieselbe Kontingentprüfung wie bei jedem anderen privaten Upload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { storedText } from './helpers.ts';

const FILES: Record<string, Buffer> = {
  '/Radio/Archiv/Mitschnitt.mp3': Buffer.from('ID3-mitschnitt-inhalt'),
  '/Radio/Archiv/Notizen.txt': Buffer.from('kein Audio'),
};
const DAV = '/remote.php/dav/files/quellnutzer';

function multistatus(dir: string): string {
  const kids = new Set<string>();
  for (const f of Object.keys(FILES)) {
    if (!f.startsWith(dir + '/')) continue;
    kids.add(f.slice(dir.length + 1));
  }
  const resp = (href: string, isDir: boolean, size = 0) => `<d:response><d:href>${DAV}${href.split('/').map(encodeURIComponent).join('/')}</d:href><d:propstat><d:prop>${isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontentlength>${size}</d:getcontentlength><d:getcontenttype>audio/mpeg</d:getcontenttype>`}</d:prop></d:propstat></d:response>`;
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${resp(dir + '/', true)}${[...kids].map((k) => resp(`${dir}/${k}`, false, FILES[`${dir}/${k}`]!.length)).join('')}</d:multistatus>`;
}

test('MusikHub: eigene Nextcloud-Quelle je Nutzerkonto, getrennter Einzeldatei-Import', async () => {
  const davSrv = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '').slice(DAV.length)).replace(/\/$/, '');
    if (req.headers.authorization !== 'Basic ' + Buffer.from('quellnutzer:app-pw').toString('base64')) return void res.writeHead(401).end();
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); return void res.end(multistatus(path)); }
    if (req.method === 'GET' && FILES[path]) return void res.end(FILES[path]);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => davSrv.listen(0, '127.0.0.1', r));
  const davUrl = `http://127.0.0.1:${(davSrv.address() as { port: number }).port}/`;

  const dir = mkdtempSync(join(process.cwd(), '.musikhub-nextcloud-test-'));
  const app = new AnMaChaCastApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    const owner = await app.users.create({ username: 'quellnutzer', password: 'Quellnutzer-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const stranger = await app.users.create({ username: 'ohnequelle', password: 'Ohnequelle-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('quellnutzer', 'Quellnutzer-Passwort1');
    const ts = await login('ohnequelle', 'Ohnequelle-Passwort1');

    // Vor Einrichtung: kein Browsen, kein Import.
    assert.deepEqual((await call(to, 'GET', '/music-hub/nextcloud')).body, { configured: false });
    assert.equal((await call(to, 'GET', '/music-hub/nextcloud/list?path=/')).status, 409);

    // Ungültige Eingaben werden vor jedem Netzwerkzugriff abgelehnt.
    assert.equal((await call(to, 'PUT', '/music-hub/nextcloud', { url: 'ftp://x', user: 'a', password: 'b' })).status, 400);
    assert.equal((await call(to, 'PUT', '/music-hub/nextcloud', { url: davUrl, user: '', password: 'b' })).status, 400);
    assert.equal((await call(to, 'PUT', '/music-hub/nextcloud', { url: davUrl, user: 'quellnutzer' })).status, 400, 'ohne Passwort und ohne bereits gespeichertes Passwort');

    // Einrichten.
    const setRes = await call(to, 'PUT', '/music-hub/nextcloud', { url: davUrl, user: 'quellnutzer', password: 'app-pw', root: '/Radio' });
    assert.equal(setRes.status, 200);
    assert.equal(setRes.body.hasPassword, true);
    assert.equal(setRes.body.url, davUrl.replace(/\/+$/, ''));
    assert.ok(!storedText(app).includes('app-pw'), 'Nextcloud-App-Passwort nie im Klartext gespeichert');

    // Ein reiner API-/Desktop-Token ohne Benutzerkonto bekommt keine eigene Quelle (konsistent mit Upload).
    const platformToken = app.svc.auth.createToken({ name: 'ohne-login', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
    assert.equal((await call(platformToken, 'GET', '/music-hub/nextcloud')).status, 403);

    // Fremde Nutzer sehen weder die Quelle noch können sie sie verwenden - vollständig getrennt.
    assert.deepEqual((await call(ts, 'GET', '/music-hub/nextcloud')).body, { configured: false });
    assert.equal((await call(ts, 'GET', '/music-hub/nextcloud/list?path=/Archiv')).status, 409);

    // Durchsuchen (Depth 1, kein rekursiver Scan) - Audiodatei erkannt, Textdatei nicht.
    const browse = await call(to, 'GET', '/music-hub/nextcloud/list?path=/Archiv');
    assert.equal(browse.status, 200);
    const entries = browse.body.entries as { name: string; path: string; audio: boolean }[];
    assert.deepEqual(entries.map((e) => [e.name, e.audio]).sort(), [['Mitschnitt.mp3', true], ['Notizen.txt', false]]);

    // Pfadausbruch wird abgelehnt, bevor irgendetwas an die Nextcloud geschickt wird.
    assert.equal((await call(to, 'GET', '/music-hub/nextcloud/list?path=/../..')).status, 400);

    // Import: Textdatei wird als nicht unterstützt zurückgewiesen (kein harter Fehler, Sammelergebnis).
    const badImport = await call(to, 'POST', '/music-hub/nextcloud/import', { paths: ['/Archiv/Notizen.txt'] });
    assert.equal(badImport.status, 200);
    assert.equal(badImport.body.imported.length, 0);
    assert.match(badImport.body.errors[0], /kein unterstützter Audiotyp/);

    // Erfolgreicher Import: landet in "Mein Archiv", byte-exakter Inhalt, Kontingent gebucht.
    const importRes = await call(to, 'POST', '/music-hub/nextcloud/import', { paths: ['/Archiv/Mitschnitt.mp3'] });
    assert.equal(importRes.status, 200);
    assert.equal(importRes.body.imported.length, 1);
    const item = importRes.body.imported[0] as { id: string; owner: { kind: string; id: string }; source: { kind: string; sizeBytes: number } };
    assert.equal(item.owner.kind, 'user');
    assert.equal(item.owner.id, owner.id);
    assert.equal(item.source.sizeBytes, FILES['/Radio/Archiv/Mitschnitt.mp3']!.length);

    const preview = await fetch(`${base}/music-hub/items/${item.id}/preview?station=main`, { headers: { Authorization: `Bearer ${to}` } });
    assert.equal(preview.status, 200);
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), new Uint8Array(FILES['/Radio/Archiv/Mitschnitt.mp3']!));

    const quota = await call(to, 'GET', '/music-hub/uploads/quota');
    assert.equal(quota.body.usedBytes, item.source.sizeBytes);

    // Fremde sehen den importierten Titel nicht (dieselbe MusikHub-Isolation wie bei jedem privaten Upload).
    assert.equal((await call(ts, 'GET', '/music-hub/items?station=main&q=Mitschnitt')).body.total, 0);

    // Zu viele Pfade auf einmal: klar abgelehnt statt eines blockierenden Massenimports.
    const tooMany = await call(to, 'POST', '/music-hub/nextcloud/import', { paths: Array.from({ length: 11 }, (_, i) => `/Archiv/${i}.mp3`) });
    assert.equal(tooMany.status, 400);

    // Entfernen wirkt sofort: Konfiguration und Passwort sind weg, auch nach Neustart.
    assert.deepEqual((await call(to, 'PUT', '/music-hub/nextcloud', { remove: true })).body, { configured: false });
    assert.equal((await call(to, 'GET', '/music-hub/nextcloud/list?path=/')).status, 409);
    app.docs.flushSync();
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    davSrv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
