// Mein Profil (Social Links, eigene API-Schlüssel) und Ankündigung/Wartung (Admin-Banner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('Profil: Links, eigene API-Keys ohne Rechteausweitung; Banner und Wartung für alle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-profile-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (method: string, path: string, tok?: string, body?: unknown) => {
    const r = await fetch(base + '/api/v1' + path, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  try {
    await app.users.create({ username: 'dj', name: 'DJ Dana', password: 'Start-Passwort1', roles: ['dj'], stationIds: ['main'], mustChangePassword: false });
    const dj = (await call('POST', '/auth/login', undefined, { username: 'dj', password: 'Start-Passwort1' })).body.token as string;
    const apiTok = app.svc.auth.createToken({ name: 't', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;

    // Profil nur mit Sitzung
    assert.equal((await call('GET', '/me/profile', apiTok)).status, 404);
    assert.equal((await call('GET', '/me/profile', dj)).body.username, 'dj');
    const p = await call('PATCH', '/me/profile', dj, { name: 'Dana', links: { website: 'https://dana.example', instagram: '@dana', bogus: 'x', facebook: '' } });
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.links, { website: 'https://dana.example', instagram: '@dana' }, 'nur bekannte, gefüllte Felder');
    assert.equal((await call('PATCH', '/me/profile', dj, { links: { website: 'javascript:alert(1)' } })).status, 400);

    // Eigene API-Keys: Scopes werden auf die eigenen gekürzt, Fremde sehen sie nicht, Widerruf nur eigene
    const k = await call('POST', '/me/tokens', dj, { name: 'Overlay', scopes: ['now_playing:read', 'users:write', 'tokens:write'] });
    assert.equal(k.status, 200);
    assert.match(k.body.token, /^ad_/);
    assert.deepEqual(k.body.info.scopes, ['now_playing:read']);
    assert.deepEqual(k.body.info.stationIds, ['main']);
    assert.equal((await call('GET', '/stations/main/now-playing', k.body.token)).status, 200);
    assert.equal((await call('GET', '/stations/main/media', k.body.token)).status, 403, 'kein media:read vergeben');
    assert.equal((await call('POST', '/me/tokens', dj, { name: 'x', scopes: ['users:write'] })).status, 400, 'nur fremde Rechte → leer');
    assert.equal((await call('GET', '/me/tokens', dj)).body.length, 1);
    assert.equal((await call('GET', '/me/tokens', apiTok)).status, 404);
    assert.equal((await call('DELETE', `/me/tokens/${k.body.info.id}`, dj)).status, 200);
    assert.equal((await call('GET', '/stations/main/now-playing', k.body.token)).status, 401, 'widerrufener Schlüssel');

    // Banner/Wartung: setzen nur Admin, lesen alle, öffentlich ohne Login; abgelaufener Banner fällt weg
    assert.equal((await call('PUT', '/site', dj, { banner: { enabled: true, text: 'x' } })).status, 403);
    const set = await call('PUT', '/site', apiTok, { banner: { enabled: true, text: 'Heute 20 Uhr Sondersendung', kind: 'success', dismissible: false }, maintenance: { enabled: true, text: 'Umzug Freitag' } });
    assert.equal(set.status, 200);
    const mine = (await call('GET', '/site', dj)).body;
    assert.equal(mine.banner.text, 'Heute 20 Uhr Sondersendung');
    assert.equal(mine.banner.kind, 'success');
    assert.equal(mine.maintenance.text, 'Umzug Freitag');
    assert.equal(mine.settings, undefined, 'Rohdaten nur für Admin');
    const pub = await fetch(`${base}/api/v1/public/site`);
    assert.equal(pub.headers.get('access-control-allow-origin'), '*');
    assert.equal(((await pub.json()) as { banner: { text: string } }).banner.text, 'Heute 20 Uhr Sondersendung');
    await call('PUT', '/site', apiTok, { banner: { until: new Date(Date.now() - 60_000).toISOString() } });
    assert.equal((await call('GET', '/site', dj)).body.banner, null, 'abgelaufen');
    assert.equal((await call('PUT', '/site', apiTok, { banner: { until: 'morgen' } })).status, 400);
  } finally {
    app.shutdown();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
