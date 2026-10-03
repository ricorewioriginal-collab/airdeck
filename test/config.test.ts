import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseConf, resolveConfig, type ResolveInput } from '../src/server/config.ts';

function fsOf(files: Record<string, string>): Pick<ResolveInput, 'exists' | 'read'> {
  return { exists: (p) => p in files, read: (p) => files[p] ?? '' };
}
const base = { root: '/opt/ad', packaged: true, desktop: true, platform: 'linux' as const, home: '/home/u' };

test('parseConf: Abschnitte, Kommentare, Anführungszeichen, BOM', () => {
  const c = parseConf('\uFEFF# x\nmode = hybrid\n[network]\nport=9000\n; y\n[paths]\ndata = "D:\\\\AnMaChaCast data"\nkaputt\n');
  assert.deepEqual(c, { mode: 'hybrid', 'network.port': '9000', 'paths.data': 'D:\\\\AnMaChaCast data' });
});

test('ohne Konfigurationsdatei: neue Orte (.anmachacast), Verhalten bleibt', () => {
  const desk = resolveConfig({ ...base, env: {}, ...fsOf({}) });
  assert.equal(desk.mode, 'local');
  assert.equal(desk.paths.data, '/home/u/.anmachacast/data');
  assert.equal(desk.paths.media, '/home/u/.anmachacast/data/media');
  assert.equal(desk.configFile, '/home/u/.anmachacast/data/config/anmachacast.conf');
  assert.equal(desk.host, '127.0.0.1');
  assert.equal(desk.port, 8750);
  assert.equal(desk.system, false);
  const dev = resolveConfig({ ...base, packaged: false, desktop: false, env: {}, ...fsOf({}) });
  assert.equal(dev.mode, 'server');
  assert.equal(dev.paths.data, '/opt/ad/data');
  // LAN-Einstellung aus dem Studio gilt weiter
  const lan = resolveConfig({ ...base, env: {}, ...fsOf({ '/home/u/.anmachacast/data/network.json': '{"lan":true}' }) });
  assert.equal(lan.host, '0.0.0.0');
});

test('systemweite Installation (Linux-Paket) wird an /etc/anmachacast erkannt', () => {
  const c = resolveConfig({ ...base, desktop: false, env: {}, ...fsOf({ '/etc/anmachacast/anmachacast.conf': 'mode = server\n[network]\nbind = lan\nport = 8800\n' }) });
  assert.equal(c.system, true);
  assert.equal(c.paths.data, '/var/lib/anmachacast');
  assert.equal(c.paths.logs, '/var/log/anmachacast');
  assert.equal(c.host, '0.0.0.0');
  assert.equal(c.port, 8800);
});

test('bisherige Orte (AirDeck-Zeit) bleiben erhalten, solange nichts Neues angelegt ist', () => {
  // Linux-Paket vor der Umbenennung: /etc/airdeck/airdeck.conf → altes Layout weiter benutzen
  const sys = resolveConfig({ ...base, desktop: false, env: {}, ...fsOf({ '/etc/airdeck/airdeck.conf': 'mode = server\n' }) });
  assert.equal(sys.system, true);
  assert.equal(sys.configFile, '/etc/airdeck/airdeck.conf');
  assert.equal(sys.paths.data, '/var/lib/airdeck');
  // nach der Migration (neuer Ordner, alter Dateiname) wird die Datei trotzdem gefunden
  const mig = resolveConfig({ ...base, desktop: false, env: {}, ...fsOf({ '/etc/anmachacast/airdeck.conf': 'mode = server\n' }) });
  assert.equal(mig.configFile, '/etc/anmachacast/airdeck.conf');
  assert.equal(mig.paths.data, '/var/lib/anmachacast');
  // neues Layout hat Vorrang, wenn beide Konfigurationen vorhanden sind
  const both = resolveConfig({ ...base, desktop: false, env: {}, ...fsOf({ '/etc/airdeck/airdeck.conf': '[network]\nport = 1111\n', '/etc/anmachacast/anmachacast.conf': '[network]\nport = 2222\n' }) });
  assert.equal(both.port, 2222);
  // Benutzerinstallation: vorhandener Datenordner ".airdeck" wird weiterverwendet, neue Installationen bekommen ".anmachacast"
  const oldHome = resolveConfig({ ...base, env: {}, ...fsOf({ '/home/u/.airdeck/data': '', '/home/u/.airdeck/data/config/airdeck.conf': 'mode = hybrid\n' }) });
  assert.equal(oldHome.paths.data, '/home/u/.airdeck/data');
  assert.equal(oldHome.configFile, '/home/u/.airdeck/data/config/airdeck.conf');
  assert.equal(oldHome.mode, 'hybrid');
  const bothHome = resolveConfig({ ...base, env: {}, ...fsOf({ '/home/u/.airdeck/data': '', '/home/u/.anmachacast/data': '' }) });
  assert.equal(bothHome.paths.data, '/home/u/.anmachacast/data');
  // Windows: %LOCALAPPDATA%\AirDeck\data bleibt in Gebrauch, sonst AnMaChaCast
  const la = '/Local';
  const winOld = resolveConfig({ ...base, platform: 'win32', env: { LOCALAPPDATA: la }, ...fsOf({ [join(la, 'AirDeck', 'data')]: '' }) });
  assert.equal(winOld.paths.data, join(la, 'AirDeck', 'data'));
  const winNew = resolveConfig({ ...base, platform: 'win32', env: { LOCALAPPDATA: la }, ...fsOf({}) });
  assert.equal(winNew.paths.data, join(la, 'AnMaChaCast', 'data'));
});

test('Windows-Dienst: ProgramData', () => {
  const pd = '/ProgramData'; // Pfadlogik des Testsystems; unter Windows C:\ProgramData
  const file = join(pd, 'AnMaChaCast', 'config', 'anmachacast.conf');
  const c = resolveConfig({ ...base, platform: 'win32', env: { ProgramData: pd }, ...fsOf({ [file]: 'mode=local' }) });
  assert.equal(c.system, true);
  assert.equal(c.paths.data, join(pd, 'AnMaChaCast', 'data'));
  const oldFile = join(pd, 'AirDeck', 'config', 'airdeck.conf');
  const old = resolveConfig({ ...base, platform: 'win32', env: { ProgramData: pd }, ...fsOf({ [oldFile]: 'mode=local' }) });
  assert.equal(old.paths.data, join(pd, 'AirDeck', 'data'), 'bisheriger Dienst-Ordner bleibt in Gebrauch');
});

test('relative Pfade ab Konfigurationsordner, Umgebung hat Vorrang, ungültige Werte fallen zurück', () => {
  const env = { AIRDECK_CONFIG: '/srv/ad/airdeck.conf', AIRDECK_PORT: '9100' };
  const files = { '/srv/ad/airdeck.conf': 'mode = quatsch\n[paths]\ndata = ./d\nmedia = /mnt/musik\n[network]\nport = 70000\nbind = 192.168.1.5\n' };
  const c = resolveConfig({ ...base, env, ...fsOf(files) });
  assert.equal(c.paths.data, '/srv/ad/d');
  assert.equal(c.paths.media, '/mnt/musik');
  assert.equal(c.paths.backups, '/srv/ad/d/backups');
  assert.equal(c.mode, 'local');
  assert.equal(c.port, 9100);
  assert.equal(c.host, '192.168.1.5');
  const bad = resolveConfig({ ...base, env: { AIRDECK_CONFIG: '/srv/ad/airdeck.conf', AIRDECK_MODE: 'HYBRID' }, ...fsOf(files) });
  assert.equal(bad.port, 8750);
  assert.equal(bad.mode, 'hybrid');
});

test('neue ANMACHA_CAST_*-Umgebungsvariablen haben Vorrang vor den bisherigen AIRDECK_*-Namen', () => {
  const files = { '/srv/ad/airdeck.conf': 'mode = local\n' };
  // nur die neuen Namen gesetzt: funktioniert genauso wie bisher mit AIRDECK_*
  const neu = resolveConfig({ ...base, env: { ANMACHA_CAST_CONFIG: '/srv/ad/airdeck.conf', ANMACHA_CAST_PORT: '9200' }, ...fsOf(files) });
  assert.equal(neu.configFile, '/srv/ad/airdeck.conf');
  assert.equal(neu.port, 9200);
  // beide gesetzt: der neue Name gewinnt
  const beide = resolveConfig({
    ...base,
    env: { ANMACHA_CAST_CONFIG: '/srv/ad/airdeck.conf', AIRDECK_CONFIG: '/anderer/ort/airdeck.conf', ANMACHA_CAST_PORT: '9300', AIRDECK_PORT: '9100' },
    ...fsOf(files),
  });
  assert.equal(beide.configFile, '/srv/ad/airdeck.conf');
  assert.equal(beide.port, 9300);
});
