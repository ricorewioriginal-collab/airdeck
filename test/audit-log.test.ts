// Aktivitäts-Log (Admin): GET /api/v1/audit liefert neueste zuerst und filtert nach Art, Sender und Freitext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('Aktivitäts-Log: neueste zuerst, Filter kind/station/q, Limit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-audit-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = app.svc.auth.createToken({ name: 't', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const get = async (q: string) => (await (await fetch(`${base}/api/v1/audit${q}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { kind: string; event: string; stationId?: string }[];
  try {
    app.audit.write({ kind: 'playout', event: 'started', stationId: 'main' });
    app.audit.write({ kind: 'upload', event: 'done', stationId: 'main', file: 'Sommerhit.mp3' });
    app.audit.write({ kind: 'playout', event: 'stopped', stationId: 'other' });
    const all = await get('?limit=3');
    assert.deepEqual(all.map((e) => e.event), ['stopped', 'done', 'started'], 'neueste zuerst');
    assert.deepEqual((await get('?kind=playout&limit=10')).map((e) => e.event), ['stopped', 'started']);
    assert.deepEqual((await get('?station=main&limit=10')).slice(0, 2).map((e) => e.event), ['done', 'started']);
    assert.ok((await get('?station=other&limit=10')).every((e) => e.stationId === 'other'));
    assert.deepEqual((await get('?q=sommerhit&limit=10')).map((e) => e.event), ['done'], 'Freitext sucht in allen Feldern, ohne Groß/Klein');
    assert.equal((await get('?limit=1')).length, 1);
    assert.equal((await fetch(`${base}/api/v1/audit`)).status, 401, 'ohne Token kein Log');
    // Nach einem Neustart sind die Einträge aus audit.log weiterhin da
    const again = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    try {
      const tail = again.audit.tail(10) as { event: string }[];
      assert.ok(tail.some((e) => e.event === 'stopped') && tail.some((e) => e.event === 'started'), 'Log aus Datei vorgeladen');
    } finally { again.shutdown(); }
  } finally {
    app.shutdown();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
