// Öffentliche Seiten (ohne Login): Senderseite, Sendeplan, Charts, Netzwerk - JSON-API mit CORS, statische Seiten
// ohne Token erreichbar, nicht-öffentliche Sender liefern 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('Öffentliche Seiten: page/schedule/charts/network ohne Login, abschaltbar, Seiten-Dateien frei', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-public-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, cors: r.headers.get('access-control-allow-origin'), body: r.status === 200 && r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
  try {
    const m = app.svc.media.addMedia('main', { id: 'm1', title: 'Believer', artist: 'Imagine Dragons', category: 'music', file: 'b.mp3', durationMs: 200_000, addedAt: 0 });
    app.setNowPlaying('main', m.id, 'A');
    const pl = app.svc.planning.savePlaylist('main', null, { name: 'Morgen', items: [m.id] });
    app.svc.planning.savePlan('main', null, { label: 'Morgenshow', from: '00:00', to: '23:59', days: [], playlistId: pl.id });

    const page = await get('/api/v1/public/stations/main/page');
    assert.equal(page.status, 200);
    assert.equal(page.cors, '*');
    const p = page.body as { station: { id: string; name: string }; current: { label: string } | null; charts: { title: string }[]; today: unknown[] };
    assert.equal(p.station.id, 'main');
    assert.equal(p.current?.label, 'Morgenshow', 'laufende Sendung aus dem Sendeplan');
    assert.equal(p.charts[0]?.title, 'Believer');
    assert.equal(p.today.length, 1);

    const sched = (await get('/api/v1/public/stations/main/schedule')).body as { days: { label: string; shows: { label: string; now: boolean }[] }[] };
    assert.equal(sched.days.length, 7);
    assert.equal(sched.days[0]!.label, 'Montag');
    assert.ok(sched.days.every((d) => d.shows[0]?.label === 'Morgenshow'), 'ohne Tagesauswahl an jedem Tag');
    assert.equal(sched.days.filter((d) => d.shows[0]?.now).length, 1, 'genau heute als „jetzt“ markiert');

    const charts = (await get('/api/v1/public/stations/main/charts?period=30d')).body as { period: string; items: { rank: number; title: string; plays: number }[] };
    assert.equal(charts.period, '30d');
    assert.deepEqual(charts.items.map((x) => [x.rank, x.title, x.plays]), [[1, 'Believer', 1]]);
    assert.equal(((await get('/api/v1/public/stations/main/charts?period=bogus')).body as { period: string }).period, '7d', 'unbekannter Zeitraum → 7 Tage');

    const net = (await get('/api/v1/public/network')).body as { stations: { id: string; now: { title: string } | null }[] };
    assert.deepEqual(net.stations.map((s) => s.id), ['main']);
    assert.equal(net.stations[0]!.now?.title, 'Believer');

    // Seiten-Dateien ohne Token
    for (const f of ['sender.html', 'sendeplan.html', 'charts.html', 'netzwerk.html', 'public.css', 'js/public-pages.js']) {
      assert.equal((await get(`/${f}`)).status, 200, f);
    }

    // Nicht öffentlich → 404 für Seite, Plan, Charts; Netzwerk ohne den Sender
    app.svc.stations.updateStation('main', { publicStatus: false });
    assert.equal((await get('/api/v1/public/stations/main/page')).status, 404);
    assert.equal((await get('/api/v1/public/stations/main/schedule')).status, 404);
    assert.equal((await get('/api/v1/public/stations/main/charts')).status, 404);
    assert.deepEqual(((await get('/api/v1/public/network')).body as { stations: unknown[] }).stations, []);
    assert.equal((await get('/api/v1/public/stations/nope/page')).status, 404);
  } finally {
    app.shutdown();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
