import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { cleanPath, parseMultistatus } from '../src/server/nextcloud.ts';
import { storedText } from './helpers.ts';
import { UserStore } from '../src/server/users.ts';

const FILES: Record<string, Buffer> = {
  '/Radio/Hits/Kygo - Firestone.mp3': Buffer.from('ID3-firestone'),
  '/Radio/Hits/Cover.jpg': Buffer.from('jpg'),
  '/Radio/Hits/Deep/Avicii - Levels.mp3': Buffer.from('ID3-levels'),
};
const uploads: Record<string, string> = {};
const DAV = '/remote.php/dav/files/rico%20r';

function multistatus(dir: string): string {
  const kids = new Set<string>();
  for (const f of Object.keys(FILES)) {
    if (!f.startsWith(dir + '/')) continue;
    const rest = f.slice(dir.length + 1).split('/');
    kids.add(rest.length > 1 ? `${dir}/${rest[0]}/` : f);
  }
  const resp = (href: string, isDir: boolean, size = 0) => `<d:response><d:href>${DAV}${href.split('/').map(encodeURIComponent).join('/')}</d:href><d:propstat><d:prop>${isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontentlength>${size}</d:getcontentlength><d:getcontenttype>audio/mpeg</d:getcontenttype>`}</d:prop></d:propstat></d:response>`;
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${resp(dir + '/', true)}${[...kids].map((k) => (k.endsWith('/') ? resp(k, true) : resp(k, false, FILES[k]!.length))).join('')}</d:multistatus>`;
}

test('WebDAV-Antwort lesen und Pfade absichern', () => {
  const xml = multistatus('/Radio/Hits');
  const list = parseMultistatus(xml, `http://x${DAV}`);
  assert.deepEqual(list.map((e) => [e.path, e.dir]), [['/Radio/Hits', true], ['/Radio/Hits/Kygo - Firestone.mp3', false], ['/Radio/Hits/Cover.jpg', false], ['/Radio/Hits/Deep', true]]);
  assert.equal(cleanPath('a//b/./c/'), '/a/b/c');
  assert.throws(() => cleanPath('/Radio/../../etc'), /Ungültiger Pfad/);
});

test('Nextcloud-Brücke: durchsuchen, übernehmen (ohne Doppelte), Mitschnitt hochladen', async () => {
  const auths = new Set<string>();
  const srv = createServer((req, res) => {
    auths.add(String(req.headers.authorization));
    const path = decodeURIComponent((req.url ?? '').slice(DAV.length)).replace(/\/$/, '');
    let body = Buffer.alloc(0);
    req.on('data', (d) => (body = Buffer.concat([body, d])));
    req.on('end', () => {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('rico r:app-pw').toString('base64')) return void res.writeHead(401).end();
      if (req.method === 'PROPFIND') {
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        return void res.end(multistatus(path));
      }
      if (req.method === 'GET' && FILES[path]) return void res.end(FILES[path]);
      if (req.method === 'MKCOL') return void res.writeHead(201).end();
      if (req.method === 'PUT') {
        uploads[path] = body.toString();
        return void res.writeHead(201).end();
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-nc-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
  try {
    assert.throws(() => app.svc.nextcloud.setNextcloud({ url: 'ftp://x', user: 'a', password: 'b' }), /https/);
    app.svc.nextcloud.setNextcloud({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/`, user: 'rico r', password: 'app-pw', root: '/Radio' });
    assert.ok(!storedText(app).includes('app-pw'), 'Passwort nie im Klartext');

    const ownerUser = await app.users.create({ username: 'cloud-owner', password: ['Cloud', 'Owner', 'Pass', '1'].join('-'), roles: ['admin'], stationIds: ['main'], mustChangePassword: false });
    const otherUser = await app.users.create({ username: 'cloud-other', password: ['Cloud', 'Other', 'Pass', '1'].join('-'), roles: ['admin'], stationIds: ['main'], mustChangePassword: false });
    const principal = (u: typeof ownerUser) => ({
      id: u.id, tokenId: `test:${u.id}`, roles: u.roles, stationIds: u.stationIds, scopes: UserStore.scopesFor(u.roles),
      user: { id: u.id, username: u.username, name: u.name },
    });
    const ownerP = principal(ownerUser);
    const otherP = principal(otherUser);

    const hubSource = await app.svc.nextcloud.saveHubNextcloudSource(ownerP, 'main', null, {
      ownerKind: 'user', name: 'Private Cloud', url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`,
      user: 'rico r', password: 'app-pw', root: '/Radio', allowPrivateNetwork: true,
      syncEnabled: true, syncIntervalMinutes: 5, syncQuotaBytes: 64 * 1024 * 1024, syncMaxFileBytes: 16 * 1024 * 1024,
    }) as { id: string; revision: number; hasPassword: boolean; secretRef?: string; syncEnabled: boolean; syncIntervalMinutes: number };
    assert.equal(hubSource.hasPassword, true);
    assert.equal(hubSource.syncEnabled, true);
    assert.equal(hubSource.syncIntervalMinutes, 5);
    assert.equal(hubSource.secretRef, undefined, 'Secret-Referenz wird nie über die API geliefert');
    assert.equal(app.svc.nextcloud.hubNextcloudSources(otherP, 'main').length, 0, 'fremder Nutzer sieht persönliche Cloudquelle nicht');
    const dedupeState = app.docs.get<any>('musikhub-nextcloud', { sources: [], entries: [], jobs: [] });
    dedupeState.jobs.push({
      id: 'running-scan', sourceId: hubSource.id, kind: 'scan', status: 'running',
      createdAt: Date.now(), updatedAt: Date.now(), files: 0, error: null,
    });
    app.docs.set('musikhub-nextcloud', dedupeState);
    await app.docs.flush();
    await assert.rejects(
      app.svc.nextcloud.scanHubNextcloudSource(ownerP, 'main', hubSource.id),
      /bereits ein Scan/,
      'doppelter Scan wird serverseitig abgefangen',
    );
    dedupeState.jobs = dedupeState.jobs.filter((j: any) => j.id !== 'running-scan');
    app.docs.set('musikhub-nextcloud', dedupeState);
    await app.docs.flush();
    const scan = await app.svc.nextcloud.scanHubNextcloudSource(ownerP, 'main', hubSource.id) as { status: string; files: number };
    assert.equal(scan.status, 'done');
    assert.equal(scan.files, 2);
    const index = app.svc.nextcloud.hubNextcloudIndex(ownerP, 'main', hubSource.id) as Array<{ name: string; path: string }>;
    assert.deepEqual(index.map((e) => e.name).sort(), ['Avicii - Levels.mp3', 'Kygo - Firestone.mp3']);
    assert.equal(app.svc.nextcloud.hubNextcloudJobs(ownerP, 'main').some((j) => j.kind === 'scan' && j.status === 'done' && j.files === 2), true);

    const firestonePath = index.find((e) => e.name === 'Kygo - Firestone.mp3')!.path;
    const sourceBusy = app.docs.get<any>('musikhub-nextcloud', { sources: [], entries: [], jobs: [] });
    sourceBusy.jobs.push({
      id: 'source-sync-busy', sourceId: hubSource.id, kind: 'sync', status: 'running',
      createdAt: Date.now(), updatedAt: Date.now(), files: 0, error: null,
    });
    app.docs.set('musikhub-nextcloud', sourceBusy);
    await app.docs.flush();
    await assert.rejects(
      app.svc.nextcloud.scanHubNextcloudSource(ownerP, 'main', hubSource.id),
      /bereits eine Synchronisierung/,
      'manueller Scan startet nicht parallel zum Quellen-Sync',
    );
    await assert.rejects(
      app.svc.nextcloud.retrieveHubNextcloudEntry(ownerP, 'main', hubSource.id, firestonePath),
      /bereits eine Synchronisierung/,
      'manueller Dateiabruf startet nicht parallel zum Quellen-Sync',
    );
    sourceBusy.jobs = sourceBusy.jobs.filter((j: any) => j.id !== 'source-sync-busy');
    app.docs.set('musikhub-nextcloud', sourceBusy);
    await app.docs.flush();

    const retrieveDedupe = app.docs.get<any>('musikhub-nextcloud', { sources: [], entries: [], jobs: [] });
    retrieveDedupe.jobs.push({
      id: 'running-retrieve', sourceId: hubSource.id, kind: 'retrieve', status: 'running',
      path: firestonePath, createdAt: Date.now(), updatedAt: Date.now(), files: 0, error: null,
    });
    app.docs.set('musikhub-nextcloud', retrieveDedupe);
    await app.docs.flush();
    await assert.rejects(
      app.svc.nextcloud.retrieveHubNextcloudEntry(ownerP, 'main', hubSource.id, firestonePath),
      /bereits abgerufen/,
      'doppelter Abruf derselben Datei wird abgefangen',
    );
    retrieveDedupe.jobs = retrieveDedupe.jobs.filter((j: any) => j.id !== 'running-retrieve');
    app.docs.set('musikhub-nextcloud', retrieveDedupe);
    await app.docs.flush();
    const retrieved = await app.svc.nextcloud.retrieveHubNextcloudEntry(ownerP, 'main', hubSource.id, firestonePath) as { item: { id: string; title: string } };
    assert.equal(retrieved.item.title, 'Firestone');
    const hubCatalog = app.svc.musikhub.listItems(ownerP, 'main') as { items: Array<{ id: string; source?: { kind: string; file?: string }; availability: { state: string; sourceKind: string }; revision: number }> };
    const cloudItem = hubCatalog.items.find((x) => x.id === retrieved.item.id)!;
    assert.equal(cloudItem.source?.kind, 'nextcloud');
    assert.equal(cloudItem.source?.file, undefined, 'interner Cloud-Cache-Dateiname wird nicht an das Studio gegeben');
    assert.deepEqual(cloudItem.availability, { state: 'ready', sourceKind: 'nextcloud' });
    assert.equal((app.svc.nextcloud.hubNextcloudJobs(ownerP, 'main')).some((j) => j.kind === 'retrieve' && j.itemId === retrieved.item.id), true);

    const edited = await app.svc.musikhub.updateItemMetadata(ownerP, retrieved.item.id, 'main', {
      revision: cloudItem.revision, title: 'Firestone Lokal', artist: 'Kygo', version: 'Studio Edit',
    });
    assert.equal(edited.title, 'Firestone Lokal');

    FILES['/Radio/Hits/Kygo - Firestone.mp3'] = Buffer.from('ID3-firestone-updated-and-longer');
    await app.svc.nextcloud.scanHubNextcloudSource(ownerP, 'main', hubSource.id);
    const changedCatalog = app.svc.musikhub.listItems(ownerP, 'main') as {
      items: Array<{ id: string; title: string; availability: { state: string }; source?: { kind: string; localMetadataDirty?: boolean; remoteStatus?: { state: string } }; revision: number }>
    };
    const changedItem = changedCatalog.items.find((x) => x.id === retrieved.item.id)!;
    assert.equal(changedItem.source?.remoteStatus?.state, 'remote_changed');
    assert.equal(changedItem.source?.localMetadataDirty, true);
    assert.equal(changedItem.title, 'Firestone Lokal');

    const refreshed = await app.svc.nextcloud.retrieveHubNextcloudEntry(ownerP, 'main', hubSource.id, firestonePath) as { item: { id: string } };
    assert.equal(refreshed.item.id, retrieved.item.id, 'gleicher Remote-Pfad aktualisiert denselben MusicHub-Eintrag');
    const refreshedCatalog = app.svc.musikhub.listItems(ownerP, 'main') as {
      items: Array<{ id: string; title: string; version: string | null; availability: { state: string }; source?: { localMetadataDirty?: boolean; remoteStatus?: { state: string } }; revision: number }>
    };
    const refreshedItem = refreshedCatalog.items.find((x) => x.id === retrieved.item.id)!;
    assert.equal(refreshedItem.revision > changedItem.revision, true);
    assert.equal(refreshedItem.title, 'Firestone Lokal', 'Cloud-Audio-Refresh überschreibt lokale Metadaten nicht');
    assert.equal(refreshedItem.version, 'Studio Edit');
    assert.equal(refreshedItem.source?.localMetadataDirty, true);
    assert.equal(refreshedItem.source?.remoteStatus?.state, 'current');

    delete FILES['/Radio/Hits/Kygo - Firestone.mp3'];
    await app.svc.nextcloud.scanHubNextcloudSource(ownerP, 'main', hubSource.id);
    const missingRemoteCatalog = app.svc.musikhub.listItems(ownerP, 'main') as {
      items: Array<{ id: string; availability: { state: string }; source?: { remoteStatus?: { state: string } } }>
    };
    const missingRemoteItem = missingRemoteCatalog.items.find((x) => x.id === retrieved.item.id)!;
    assert.equal(missingRemoteItem.source?.remoteStatus?.state, 'remote_missing');
    assert.equal(missingRemoteItem.availability.state, 'ready', 'Remote-Löschung lässt lokalen MusicHub-Cache bewusst bestehen');
    FILES['/Radio/Hits/Kygo - Firestone.mp3'] = Buffer.from('ID3-firestone-updated-and-longer');
    await app.svc.nextcloud.scanHubNextcloudSource(ownerP, 'main', hubSource.id);

    FILES['/Radio/Hits/New Artist - New Song.mp3'] = Buffer.from('ID3-new-song');
    const syncDedupe = app.docs.get<any>('musikhub-nextcloud', { sources: [], entries: [], jobs: [] });
    syncDedupe.jobs.push({
      id: 'running-sync', sourceId: hubSource.id, kind: 'sync', status: 'running',
      createdAt: Date.now(), updatedAt: Date.now(), files: 0, error: null,
    });
    app.docs.set('musikhub-nextcloud', syncDedupe);
    await app.docs.flush();
    await assert.rejects(
      app.svc.nextcloud.syncHubNextcloudSource(ownerP, 'main', hubSource.id, false),
      /bereits eine Synchronisierung/,
      'doppelter Quellen-Sync wird abgefangen',
    );
    syncDedupe.jobs = syncDedupe.jobs.filter((j: any) => j.id !== 'running-sync');
    app.docs.set('musikhub-nextcloud', syncDedupe);
    await app.docs.flush();
    const autoSync = await app.svc.nextcloud.syncHubNextcloudSource(ownerP, 'main', hubSource.id, false) as {
      imported: number; skippedUnchanged: number; skippedQuota: number; skippedTooLarge: number;
    };
    assert.equal(autoSync.imported, 2, 'Auto-Sync holt fehlende/geänderte Indexdateien');
    assert.equal(autoSync.skippedUnchanged >= 1, true, 'unveränderte bereits synchronisierte Datei wird nicht erneut geladen');
    const afterSync = app.svc.musikhub.listItems(ownerP, 'main') as { items: Array<{ title: string; availability: { sourceKind: string } }> };
    assert.equal(afterSync.items.some((x) => x.title === 'New Song' && x.availability.sourceKind === 'nextcloud'), true);

    const currentSource = app.svc.nextcloud.hubNextcloudSources(ownerP, 'main').find((x) => x.id === hubSource.id)!;
    await app.svc.nextcloud.saveHubNextcloudSource(ownerP, 'main', hubSource.id, {
      revision: currentSource.revision,
      ownerKind: 'user', name: currentSource.name, url: currentSource.url, user: currentSource.user, root: currentSource.root,
      allowPrivateNetwork: true, syncEnabled: true, syncIntervalMinutes: 5,
      syncQuotaBytes: currentSource.syncQuotaBytes, syncMaxFileBytes: 4,
    }) as { revision: number };
    FILES['/Radio/Hits/Too Large.mp3'] = Buffer.from('ID3-too-large-for-limit');
    const limitedSync = await app.svc.nextcloud.syncHubNextcloudSource(ownerP, 'main', hubSource.id, false) as { skippedTooLarge: number };
    assert.equal(limitedSync.skippedTooLarge >= 1, true, 'Dateien über Quelllimit werden übersprungen');
    const tooLargeIndex = app.svc.nextcloud.hubNextcloudIndex(ownerP, 'main', hubSource.id) as Array<{ name: string; path: string }>;
    const tooLargePath = tooLargeIndex.find((e) => e.name === 'Too Large.mp3')!.path;
    await assert.rejects(
      app.svc.nextcloud.retrieveHubNextcloudEntry(ownerP, 'main', hubSource.id, tooLargePath),
      /Limit/,
      'manueller Abruf kann Dateigrößen-/Quotenregeln nicht umgehen',
    );

    const sourceBeforeFailure = app.svc.nextcloud.hubNextcloudSources(ownerP, 'main').find((x) => x.id === hubSource.id)!;
    await app.svc.nextcloud.saveHubNextcloudSource(ownerP, 'main', hubSource.id, {
      revision: sourceBeforeFailure.revision,
      ownerKind: 'user', name: sourceBeforeFailure.name, url: sourceBeforeFailure.url, user: sourceBeforeFailure.user, root: sourceBeforeFailure.root,
      allowPrivateNetwork: true, syncEnabled: true, syncIntervalMinutes: 5,
      syncQuotaBytes: sourceBeforeFailure.syncQuotaBytes, syncMaxFileBytes: 16 * 1024 * 1024,
      password: 'wrong-app-password',
    });
    await assert.rejects(app.svc.nextcloud.syncHubNextcloudSource(ownerP, 'main', hubSource.id, true), /Nextcloud/);
    const failedSource = app.svc.nextcloud.hubNextcloudSources(ownerP, 'main').find((x) => x.id === hubSource.id)!;
    assert.equal(failedSource.syncFailures >= 1, true);
    assert.equal((failedSource.offlineUntil ?? 0) > Date.now(), true, 'Fehler setzt Backoff/Offline-Zeit');
    assert.equal((failedSource.nextSyncAt ?? 0) >= (failedSource.offlineUntil ?? 0), true);

    await app.svc.nextcloud.saveHubNextcloudSource(ownerP, 'main', hubSource.id, {
      revision: failedSource.revision,
      ownerKind: 'user', name: failedSource.name, url: failedSource.url, user: failedSource.user, root: failedSource.root,
      allowPrivateNetwork: true, syncEnabled: true, syncIntervalMinutes: 5,
      syncQuotaBytes: failedSource.syncQuotaBytes, syncMaxFileBytes: 16 * 1024 * 1024,
      password: 'app-pw',
    }) as { revision: number };
    const syncState = app.docs.get<any>('musikhub-nextcloud', { sources: [], entries: [], jobs: [] });
    syncState.jobs.push({
      id: 'restart-job', sourceId: hubSource.id, kind: 'sync', status: 'running',
      createdAt: Date.now(), updatedAt: Date.now(), files: 0, error: null,
    });
    app.docs.set('musikhub-nextcloud', syncState);
    await app.docs.flush();
    await app.svc.nextcloud.resumeHubNextcloudSync();
    const resumedState = app.docs.get<any>('musikhub-nextcloud', { sources: [], entries: [], jobs: [] });
    const interrupted = resumedState.jobs.find((j: any) => j.id === 'restart-job');
    assert.equal(interrupted.status, 'failed');
    assert.match(interrupted.error, /Neustart/);
    assert.equal(resumedState.sources.find((x: any) => x.id === hubSource.id).nextSyncAt <= Date.now() + 1000, true, 'unterbrochener Auto-Sync wird neu eingeplant');

    await assert.rejects(
      app.svc.nextcloud.saveHubNextcloudSource(ownerP, 'main', hubSource.id, {
        revision: 0, ownerKind: 'user', name: 'Alt', url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`,
        user: 'rico r', root: '/Radio', allowPrivateNetwork: true,
      }),
      /inzwischen geändert/,
    );
    delete FILES['/Radio/Hits/New Artist - New Song.mp3'];
    delete FILES['/Radio/Hits/Too Large.mp3'];

    const top = (await app.svc.nextcloud.nextcloudList('/Hits')) as { entries: { name: string; path: string; dir: boolean; audio: boolean }[] };
    assert.deepEqual(top.entries.map((e) => [e.name, e.dir, e.audio]), [['Deep', true, false], ['Cover.jpg', false, false], ['Kygo - Firestone.mp3', false, true]]);
    assert.equal(top.entries[2]!.path, '/Hits/Kygo - Firestone.mp3');
    await assert.rejects(app.svc.nextcloud.nextcloudList('/../..'), /Ungültiger Pfad/);

    const r = await app.svc.nextcloud.nextcloudImport('main', ['/Hits'], { category: 'music' });
    assert.deepEqual(r, { imported: 2, skipped: 0, errors: [] });
    const lib = app.svc.media.library('main');
    const levels = lib.find((m) => m.title === 'Levels')!;
    assert.equal(levels.artist, 'Avicii');
    assert.equal(levels.folder, 'Hits / Deep');
    assert.equal(readFileSync(app.svc.media.mediaPath('main', levels), 'utf8'), 'ID3-levels');
    assert.deepEqual(await app.svc.nextcloud.nextcloudImport('main', ['/Hits/Kygo - Firestone.mp3'], {}), { imported: 0, skipped: 1, errors: [] });

    // Mitschnitt hochladen
    const rec = { id: 'r1', label: 'Morning Show', startedAt: Date.UTC(2026, 8, 24, 7, 0), bytes: 4, contentType: 'audio/mpeg', file: 'r1.mp3' };
    (app as unknown as { rt(id: string): { data: { recordings: unknown[] } } }).rt('main').data.recordings.push(rec);
    mkdirSync(join(dir, 'recordings', 'main'), { recursive: true });
    writeFileSync(join(dir, 'recordings', 'main', 'r1.mp3'), 'DATA');
    const up = (await app.svc.nextcloud.nextcloudUploadRecording('main', 'r1', 'Replays')) as { uploaded: string };
    assert.equal(up.uploaded, '/Radio/Replays/2026-09-24-07-00 Morning Show.mp3');
    assert.equal(uploads['/Radio/Replays/2026-09-24-07-00 Morning Show.mp3'], 'DATA');
    await app.svc.nextcloud.deleteHubNextcloudSource(ownerP, 'main', hubSource.id);
    assert.equal(app.svc.nextcloud.hubNextcloudSources(ownerP, 'main').length, 0);
    assert.equal(app.svc.nextcloud.hubNextcloudJobs(ownerP, 'main').length, 0);

    // Entfernen wirkt (auch nach Neustart): Einstellung und Passwort sind weg
    assert.deepEqual(app.svc.nextcloud.setNextcloud({ remove: true }), { configured: false });
    assert.deepEqual(app.svc.nextcloud.nextcloudConfig(), { configured: false });
    app.docs.flushSync();
    const again = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
    assert.deepEqual(again.svc.nextcloud.nextcloudConfig(), { configured: false });
  } finally {
    app.shutdown();
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
