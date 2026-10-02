// MusikHub Paket 09 (erster Schritt): Ordner-Import aus der eigenen Nextcloud-Quelle als persistenter
// Hintergrundjob statt einer blockierenden Antwort. Nutzt denselben Mock-WebDAV-Server-Aufbau wie
// test/musikhub-nextcloud-folder.test.ts, wartet aber auf den asynchronen Jobabschluss per Polling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

const DAV = '/remote.php/dav/files/jobnutzer';

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

test('MusikHub: Ordner-Import als Hintergrundjob - queued/running/succeeded, Statusabfrage, eigene Job-Sicht, Neustart', async () => {
  const FILES: Record<string, Buffer> = { '/Radio/Erste.mp3': Buffer.from('erster-titel'), '/Radio/Zweite.mp3': Buffer.from('zweiter-titel') };
  let davFails = 0;
  const davSrv = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '').slice(DAV.length)).replace(/\/$/, '');
    if (req.headers.authorization !== 'Basic ' + Buffer.from('jobnutzer:app-pw').toString('base64')) return void res.writeHead(401).end();
    if (davFails > 0 && req.method === 'PROPFIND') { davFails--; res.writeHead(503); return void res.end(); }
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); return void res.end(multistatus(FILES, p)); }
    if (req.method === 'GET' && FILES[p]) return void res.end(FILES[p]);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => davSrv.listen(0, '127.0.0.1', r));
  const davUrl = `http://127.0.0.1:${(davSrv.address() as { port: number }).port}/`;

  const dir = mkdtempSync(join(process.cwd(), '.musikhub-import-job-test-'));
  const app = new AnMaChaCastApp(dir, { ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const waitForTerminal = async (token: string, jobId: string): Promise<{ status: string; result?: unknown; error?: string }> => {
    for (let i = 0; i < 50; i++) {
      const jobs = (await call(token, 'GET', '/music-hub/nextcloud/jobs')).body as { id: string; status: string; result?: unknown; error?: string }[];
      const job = jobs.find((j) => j.id === jobId);
      if (job && (job.status === 'succeeded' || job.status === 'failed')) return job;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Job wurde nicht rechtzeitig abgeschlossen');
  };

  try {
    await app.users.create({ username: 'jobnutzer', password: 'Jobnutzer-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const to = (await call('', 'POST', '/auth/login', { username: 'jobnutzer', password: 'Jobnutzer-Passwort1' })).body.token as string; // gitleaks:allow - Test-Passwort, kein echtes Secret

    // Ohne konfigurierte Nextcloud-Quelle wird sofort (nicht erst als später fehlschlagender Job) abgelehnt.
    const unconfigured = await call(to, 'POST', '/music-hub/nextcloud/import-folder-job', { path: '/' });
    assert.equal(unconfigured.status, 409);
    assert.equal((await call(to, 'GET', '/music-hub/nextcloud/jobs')).body.length, 0, 'kein Job wird für eine sofort abgelehnte Anfrage angelegt');

    await call(to, 'PUT', '/music-hub/nextcloud', { url: davUrl, user: 'jobnutzer', password: 'app-pw', root: '/Radio' });

    // Ungültiger Pfad wird ebenfalls sofort abgelehnt, kein Job entsteht.
    assert.equal((await call(to, 'POST', '/music-hub/nextcloud/import-folder-job', { path: '/../..' })).status, 400);
    assert.equal((await call(to, 'GET', '/music-hub/nextcloud/jobs')).body.length, 0);

    const started = await call(to, 'POST', '/music-hub/nextcloud/import-folder-job', { path: '/' });
    assert.equal(started.status, 200);
    assert.equal(started.body.status, 'queued');
    const jobId = started.body.id as string;

    const finished = await waitForTerminal(to, jobId);
    assert.equal(finished.status, 'succeeded');
    assert.deepEqual(finished.result, { imported: 2, skipped: 0, errors: [] });

    // Erneuter Lauf: laut.fm-typisches Zwei-Treffer-Muster hier als Dublettenerkennung - neuer Job, aber 0 neu importiert.
    const rerunStarted = await call(to, 'POST', '/music-hub/nextcloud/import-folder-job', { path: '/' });
    const rerunFinished = await waitForTerminal(to, rerunStarted.body.id);
    assert.equal(rerunFinished.status, 'succeeded');
    assert.deepEqual(rerunFinished.result, { imported: 0, skipped: 2, errors: [] });

    // Ein Job kennt nur den eigenen Aufrufer - fremder Zugriff (auch auf Neustart) wird abgelehnt.
    await app.users.create({ username: 'fremdnutzer', password: 'Fremdnutzer-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const otherToken = (await call('', 'POST', '/auth/login', { username: 'fremdnutzer', password: 'Fremdnutzer-Passwort1' })).body.token as string; // gitleaks:allow - Test-Passwort, kein echtes Secret
    assert.equal((await call(otherToken, 'GET', '/music-hub/nextcloud/jobs')).body.length, 0, 'fremde Jobs bleiben unsichtbar');
    assert.equal((await call(otherToken, 'POST', `/music-hub/nextcloud/jobs/${jobId}/restart`, {})).status, 404, 'fremder Neustart wird wie ein nicht vorhandener Job abgelehnt');

    // Ein fehlgeschlagener Job (Nextcloud vorübergehend nicht erreichbar) lässt sich unter derselben Job-ID neu starten.
    davFails = 1;
    const failStart = await call(to, 'POST', '/music-hub/nextcloud/import-folder-job', { path: '/' });
    const failed = await waitForTerminal(to, failStart.body.id);
    assert.equal(failed.status, 'failed');
    assert.ok(failed.error, 'Fehlermeldung wird ehrlich festgehalten statt verschluckt');

    const restarted = await call(to, 'POST', `/music-hub/nextcloud/jobs/${failStart.body.id}/restart`, {});
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.id, failStart.body.id, 'dieselbe Job-ID bleibt beim Neustart bestehen');
    const restartedFinished = await waitForTerminal(to, failStart.body.id);
    assert.equal(restartedFinished.status, 'succeeded', 'Neustart ohne erneuten Fehler läuft diesmal durch');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    davSrv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
