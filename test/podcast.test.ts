// Eigener Podcast-Feed aus den eigenen Mitschnitten (inspiriert vom Podcast-Bereich von
// anmacha_control_center, aber eigenständig: kein externer Dienst wie Castopod, kein Konsum
// fremder Feeds - nur die eigenen Sendungen als RSS/iTunes-Feed veröffentlichen).
// Prüft den vollständigen Weg: Mitschnitt -> Episode -> Veröffentlichung -> echter, gültiger
// RSS-Feed mit funktionierendem Enclosure-Download, öffentlich ohne Authentifizierung erreichbar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirDeckApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { newId } from '../src/server/model.ts';
import type { Recording } from '../src/server/model.ts';

test('Podcast: Episode aus Mitschnitt, Entwurf vs. veröffentlicht, Feed + Enclosure öffentlich erreichbar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-podcast-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    // Fertigen Mitschnitt simulieren: Recorder-Infrastruktur (relay.ts) ist bereits getestet,
    // hier geht es um die Podcast-Schicht, die auf einem fertigen Recording aufsetzt.
    const recDir = join(dir, 'recordings', 'main');
    mkdirSync(recDir, { recursive: true });
    const rec: Recording = { id: newId('rec'), label: 'Testsendung', startedAt: Date.now() - 60_000, endedAt: Date.now(), bytes: 0, contentType: 'audio/mpeg', file: 'rec1.mp3' };
    const audioBytes = Buffer.from('fake-mp3-data');
    writeFileSync(join(recDir, rec.file), audioBytes);
    rec.bytes = audioBytes.length;
    (app.rt('main').data.recordings ??= []).push(rec);

    // Episode aus dem Mitschnitt anlegen: zunächst Entwurf, taucht nicht im Feed auf
    const ep = app.svc.podcast.createEpisode('main', rec.id, { title: 'Folge 1: Der Anfang', description: 'Shownotes hier.' });
    assert.equal(ep.publishedAt, undefined);
    let feedDraft = await (await fetch(`${base}/api/v1/public/stations/main/podcast.xml`)).text();
    assert.ok(!feedDraft.includes('Folge 1'), 'Entwurf erscheint nicht im öffentlichen Feed');

    // Podcast-Stammdaten setzen
    app.svc.podcast.saveConfig('main', { title: 'Mein Radio-Podcast', description: 'Die besten Sendungen zum Nachhören', author: 'Studio-Team', language: 'de-de', explicit: false });

    // Veröffentlichen
    app.svc.podcast.updateEpisode('main', ep.id, { published: true, season: 1, episodeNumber: 1 });
    const feedRes = await fetch(`${base}/api/v1/public/stations/main/podcast.xml`);
    assert.equal(feedRes.status, 200);
    assert.equal(feedRes.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
    const feed = await feedRes.text();
    assert.match(feed, /<title>Mein Radio-Podcast<\/title>/);
    assert.match(feed, /<title>Folge 1: Der Anfang<\/title>/);
    assert.match(feed, /<itunes:season>1<\/itunes:season>/);
    assert.match(feed, /<itunes:episode>1<\/itunes:episode>/);
    const enclosureMatch = /<enclosure url="([^"]+)" length="(\d+)" type="audio\/mpeg"\/>/.exec(feed);
    assert.ok(enclosureMatch, 'Enclosure-Tag mit echter URL/Länge/Typ vorhanden');

    // Die Enclosure-URL liefert tatsächlich die Audiodatei zurück - öffentlich, ohne Token
    const audioRes = await fetch(enclosureMatch![1]!);
    assert.equal(audioRes.status, 200);
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    assert.equal(audioBuf.toString('utf8'), 'fake-mp3-data');
    assert.equal(Number(enclosureMatch![2]), audioBuf.length);

    // Zurückziehen: verschwindet wieder aus dem Feed
    app.svc.podcast.updateEpisode('main', ep.id, { published: false });
    feedDraft = await (await fetch(`${base}/api/v1/public/stations/main/podcast.xml`)).text();
    assert.ok(!feedDraft.includes('Folge 1'));

    // Gesperrte Audiodatei für eine nicht veröffentlichte Episode: kein Zugriff über die öffentliche Route
    const blockedAudio = await fetch(enclosureMatch![1]!);
    assert.equal(blockedAudio.status, 404);

    // Verwaltungs-API verlangt Authentifizierung
    const unauth = await fetch(`${base}/api/v1/stations/main/podcast`);
    assert.equal(unauth.status, 401);

    // Löschen einer Episode entfernt sie endgültig, der Mitschnitt selbst bleibt unangetastet
    app.svc.podcast.deleteEpisode('main', ep.id);
    assert.equal(app.svc.podcast.episodes('main').length, 0);
    assert.equal(app.svc.recorder.recordings('main') ? (app.svc.recorder.recordings('main') as { recordings: unknown[] }).recordings.length : 0, 1);
  } finally {
    server.close();
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Podcast: ungültiges Cover wird abgelehnt, gültiges Cover ist öffentlich abrufbar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'airdeck-podcast-cover-'));
  const app = new AirDeckApp(dir, { stableMs: 0, ffmpeg: null });
  try {
    assert.throws(() => app.svc.podcast.setCover('main', 'image/png', Buffer.from('nicht-wirklich-ein-bild')), /gültiges Bild/);
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    app.svc.podcast.setCover('main', 'image/png', pngSig);
    const cover = app.svc.podcast.cover('main');
    assert.ok(cover);
    assert.equal(cover!.type, 'image/png');
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
