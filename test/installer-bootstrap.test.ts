import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { openSqliteSync } from '../src/server/db/index.ts';
import { DbDocStore } from '../src/server/repo/docs.ts';
import { UserStore } from '../src/server/users.ts';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('Installer-Bootstrap wird sofort importiert, entfernt und beim Repair nicht erneut angewandt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-installer-'));
  const file = join(dir, 'installer-bootstrap.json');
  const password = 'Installer-Geheimnis9';
  const run = () => spawnSync(process.execPath, ['src/server/main.ts', '--headless', '--import-installer-bootstrap'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, AIRDECK_DATA: dir, AIRDECK_DISCOVERY: 'off' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  try {
    writeFileSync(file, JSON.stringify({ username: 'owner', name: 'Senderleitung', password, localMonitoring: true }));
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(existsSync(file), false, 'Klartext-Bootstrap muss vor Installer-Ende verschwinden');
    assert.equal(first.stdout.includes(password) || first.stderr.includes(password), false, 'Passwort darf nicht im Log erscheinen');

    let db = openSqliteSync(join(dir, 'airdeck.db'));
    let docs = DbDocStore.openSync(db);
    let users = new UserStore(dir, docs);
    assert.equal(users.count, 1);
    assert.equal((await users.login('owner', password)).user.username, 'owner');
    await assert.rejects(users.login('owner', 'Falsches-Passwort2'));
    const saved = docs.get<any>('airdeck', null);
    assert.equal(saved?.data?.main?.playout?.hls?.enabled, true);
    assert.equal(saved?.data?.main?.playout?.autostart, true);
    assert.ok(docs.get<any>('setup', {}).installerWelcomeAt);
    await db.close();
    assert.equal(readFileSync(join(dir, 'config', 'anmachacast.conf'), 'utf8').includes(password), false);

    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password }) });
      assert.equal(login.status, 200);
      const token = ((await login.json()) as { token: string }).token;
      const headers = { Authorization: `Bearer ${token}` };
      const before = await fetch(`${base}/setup`, { headers }).then((r) => r.json()) as { installerWelcome: boolean; current: { automation: { localMonitoring: boolean } } };
      assert.equal(before.installerWelcome, true);
      assert.equal(before.current.automation.localMonitoring, true);
      assert.equal((await fetch(`${base}/setup/installer-welcome/ack`, { method: 'POST', headers })).status, 200);
      const after = await fetch(`${base}/setup`, { headers }).then((r) => r.json()) as { installerWelcome: boolean };
      assert.equal(after.installerWelcome, false);
    } finally {
      app.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    writeFileSync(file, JSON.stringify({ username: 'intruder', password: 'Anderes-Passwort9' }));
    const repair = run();
    assert.notEqual(repair.status, 0, 'vorhandenen Admin nicht überschreiben');
    assert.equal(existsSync(file), false, 'auch verworfene Einmaldaten löschen');
    db = openSqliteSync(join(dir, 'airdeck.db'));
    docs = DbDocStore.openSync(db);
    users = new UserStore(dir, docs);
    assert.equal(users.count, 1);
    assert.equal((await users.login('owner', password)).user.username, 'owner');
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Installer-Portprüfung erkennt einen belegten Port ohne Datenbankänderung', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-installer-port-'));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const result = spawnSync(process.execPath, ['src/server/main.ts', '--headless', '--check-port'], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, AIRDECK_DATA: dir, AIRDECK_HOST: '127.0.0.1', AIRDECK_PORT: String(port) },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Port .* bereits belegt/);
    assert.equal(existsSync(join(dir, 'airdeck.db')), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
