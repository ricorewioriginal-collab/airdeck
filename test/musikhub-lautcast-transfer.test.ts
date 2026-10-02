// lautCast-Übertragung (Phase 5, zweiter Schritt): tatsächlicher Upload eines Hub-Titels zu laut.fm
// über den verifiziert nicht deprecateten POST /stations/{id}/tracks-Endpunkt, siehe Kommentar an
// lautcastTransfer() in src/server/services/musikhub.ts. Nachbau des laut.fm-Verhaltens per lokalem
// Mock-Server: Upload liefert zunächst eine negative "in Bearbeitung"-ID, die per Poll positiv wird.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'lautcast-transfer-test-token-123456';
const ORIGIN = 'airdeck';
let uploadCount = 0;
let nextUploadId = -501;
const pollCallsForId: Record<number, number> = {};

const mock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    if (req.headers.authorization !== `Bearer ${TOKEN}` || req.headers.origin !== ORIGIN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    if (req.method === 'POST' && req.url === '/stations/42/tracks') {
      uploadCount++;
      const body = Buffer.concat(chunks).toString('utf8');
      if (!body.includes('name="track"')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'no file field' }));
      }
      const id = nextUploadId;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id }));
    }
    const pollMatch = req.method === 'GET' && req.url?.match(/^\/stations\/42\/tracks\/(-?\d+)$/);
    if (pollMatch) {
      const id = Number(pollMatch[1]);
      pollCallsForId[id] = (pollCallsForId[id] ?? 0) + 1;
      // Never-never-Track (id === -999) bleibt absichtlich für immer negativ (Prozessierungs-Endlosfall).
      const resolved = id !== -999 && pollCallsForId[id]! >= 1 ? Math.abs(id) + 100000 : id;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ tracks: [{ id: resolved }] }));
    }
    const playlistMatch = req.method === 'POST' && req.url?.match(/^\/stations\/42\/playlists\/(\d+)$/);
    if (playlistMatch) {
      const playlistId = Number(playlistMatch[1]);
      if (playlistId === 8) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'forbidden' }));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: playlistId, name: 'Rotation', track_ids: [payload.track_id] }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
process.env.AIRDECK_RADIOADMIN_URL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

const { AnMaChaCastApp } = await import('../src/server/app.ts');
const { createHttpServer } = await import('../src/server/http.ts');
const { mkdirSync, writeFileSync } = await import('node:fs');

test('MusikHub: lautCast-Übertragung - Upload, Polling, Zwei-Treffer-Wiederverwendung, ehrliches "processing"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-lautcast-transfer-'));
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
    mkdirSync(join(app.mediaDir, 'main'), { recursive: true });
    writeFileSync(join(app.mediaDir, 'main', 'song.mp3'), Buffer.from('echter-inhalt-zum-hochladen'));
    app.svc.media.addMedia('main', { id: 'song', title: 'Abendshow', artist: 'Test', category: 'music', file: 'song.mp3', durationMs: 3000, addedAt: Date.now() });

    const owner = await app.users.create({ username: 'redaktion2', password: 'Redaktion2-Passwort1', roles: ['editor'], stationIds: ['main'], mustChangePassword: false }); // gitleaks:allow - Test-Passwort, kein echtes Secret
    const login = async (name: string, pw: string) => (await call('', 'POST', '/auth/login', { username: name, password: pw })).body.token as string;
    const to = await login('redaktion2', 'Redaktion2-Passwort1');

    // laut.fm-Verbindung mit echtem Mock-Server (Origin + Token wie vom Server erwartet).
    app.secrets.set('lautfm:main', TOKEN);
    app.rt('main').data.lautfm = { stationId: 42, stationName: 'testsender', origin: ORIGIN };

    const item = (await call(to, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'song' })).body as { id: string };

    // Erster Aufruf: echter Upload, laut.fm liefert zunächst eine negative "in Bearbeitung"-ID,
    // die nach einem Poll positiv wird.
    const first = await call(to, 'POST', `/music-hub/items/${item.id}/lautcast-transfer`, { station: 'main' });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(typeof first.body.trackId, 'number');
    assert.ok(first.body.trackId > 0);
    assert.equal(uploadCount, 1);

    // Zweiter Aufruf für denselben Titel/Sender: Zwei-Treffer-Modell verwendet die gespeicherte
    // Zuordnung wieder, laedt NICHT erneut hoch.
    const second = await call(to, 'POST', `/music-hub/items/${item.id}/lautcast-transfer`, { station: 'main' });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal(uploadCount, 1, 'kein erneuter Upload bei bereits zugeordneter laut.fm-Track-ID');

    // Zweiter, unabhängiger Titel, dessen Upload für immer in Bearbeitung bleibt (Mock-Sonderfall):
    // ehrliches "processing" statt eines erfundenen Erfolgs, Mapping wird trotzdem (negativ) gespeichert.
    nextUploadId = -999;
    app.svc.media.addMedia('main', { id: 'song2', title: 'Nachtschicht', artist: 'Test', category: 'music', file: 'song2.mp3', durationMs: 3000, addedAt: Date.now() });
    writeFileSync(join(app.mediaDir, 'main', 'song2.mp3'), Buffer.from('noch-mehr-inhalt'));
    const item2 = (await call(to, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'song2' })).body as { id: string };
    const stuck = await call(to, 'POST', `/music-hub/items/${item2.id}/lautcast-transfer`, { station: 'main' });
    assert.equal(stuck.status, 200);
    assert.deepEqual(stuck.body, { ok: false, reason: 'processing', itemId: item2.id, stationId: 'main', trackId: -999 });

    // Erneuter Aufruf fragt dieselbe ID erneut ab (idempotent), lädt nicht ein zweites Mal hoch.
    const uploadCountBefore = uploadCount;
    const stuckAgain = await call(to, 'POST', `/music-hub/items/${item2.id}/lautcast-transfer`, { station: 'main' });
    assert.equal(stuckAgain.status, 200);
    assert.equal(stuckAgain.body.reason, 'processing');
    assert.equal(uploadCount, uploadCountBefore, 'kein erneuter Upload für einen bereits laufenden, noch nicht abgeschlossenen Transfer');

    // Dritter Titel: Übertragung MIT Playlist-Wiring - erfolgreiches Hinzufuegen zur laut.fm-Playlist 7.
    // nextUploadId zuruecksetzen (der vorige Testfall hat sie dauerhaft auf den Never-never-Sonderfall gesetzt).
    nextUploadId = -701;
    app.svc.media.addMedia('main', { id: 'song3', title: 'Morgenmagazin', artist: 'Test', category: 'music', file: 'song3.mp3', durationMs: 3000, addedAt: Date.now() });
    writeFileSync(join(app.mediaDir, 'main', 'song3.mp3'), Buffer.from('dritter-inhalt'));
    const item3 = (await call(to, 'POST', '/music-hub/items', { stationId: 'main', mediaId: 'song3' })).body as { id: string };
    const withPlaylist = await call(to, 'POST', `/music-hub/items/${item3.id}/lautcast-transfer`, { station: 'main', playlistId: 7 });
    assert.equal(withPlaylist.status, 200);
    assert.equal(withPlaylist.body.ok, true);
    assert.equal(withPlaylist.body.playlistId, 7);
    assert.equal(withPlaylist.body.playlistOk, true);
    assert.ok(withPlaylist.body.trackId > 0);

    // Erneuter Aufruf mit derselben Playlist: laut.fm lehnt bereits enthaltene Tracks ohne Fehler ab
    // (Mock antwortet unveraendert mit 200) - bleibt idempotent, kein zweiter Upload.
    const uploadCountBeforePlaylist = uploadCount;
    const withPlaylistAgain = await call(to, 'POST', `/music-hub/items/${item3.id}/lautcast-transfer`, { station: 'main', playlistId: 7 });
    assert.equal(withPlaylistAgain.status, 200);
    assert.equal(withPlaylistAgain.body.playlistOk, true);
    assert.equal(uploadCount, uploadCountBeforePlaylist, 'kein erneuter Upload beim erneuten Playlist-Hinzufuegen');

    // Playlist-Fehler (Mock: Playlist 8 lehnt ab) maskiert den erfolgreichen Upload NICHT als Fehlschlag.
    const withBadPlaylist = await call(to, 'POST', `/music-hub/items/${item3.id}/lautcast-transfer`, { station: 'main', playlistId: 8 });
    assert.equal(withBadPlaylist.status, 200);
    assert.equal(withBadPlaylist.body.ok, true, 'Upload selbst bleibt erfolgreich');
    assert.equal(withBadPlaylist.body.playlistOk, false);
    assert.equal(withBadPlaylist.body.playlistReason, 'playlist_add_failed');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => new Promise<void>((r) => mock.close(() => r())));
