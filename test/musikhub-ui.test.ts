import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hub = readFileSync('studio/js/musikhub.js', 'utf8');
const media = readFileSync('studio/js/mediamgmt.js', 'utf8');
const css = readFileSync('studio/styles.css', 'utf8');

test('Studio mountet den MusicHub als echten Medien-Reiter', () => {
  assert.match(media, /import \{ mountMusicHub \} from '\.\/musikhub\.js'/);
  assert.match(media, /tabBtn\('musikhub', 'MusikHub'\)/);
  assert.match(media, /mountMusicHub\(musicHubPane, ctx\)/);
});

test('MusicHub-Studio deckt private Medien, Rechte und Broadcast ab', () => {
  for (const label of [
    'Meine persönliche Musik',
    '▶ Vorhören',
    '↓ Download',
    '＋ In Queue',
    '＋ Playlist',
    'Metadaten',
    'Freigeben',
    'Freigaben',
    'Löschen',
  ]) assert.ok(hub.includes(label), `UI-Aktion fehlt: ${label}`);

  assert.ok(hub.includes("url(\`/personal?station="), 'persönlicher Upload-Pfad fehlt im Studio');
  assert.match(hub, /\/items\/\$\{encodeURIComponent\(item\.id\)\}\/preview/);
  assert.match(hub, /\/items\/\$\{encodeURIComponent\(item\.id\)\}\/download/);
  assert.match(hub, /\/items\/\$\{encodeURIComponent\(item\.id\)\}\/queue/);
  assert.match(hub, /\/playlists\/\$\{encodeURIComponent\(value\.playlistId\)\}/);
});

test('MusicHub-Studio deckt Nextcloud Sync, Limits und Konflikte ab', () => {
  for (const label of [
    'Cloud-Quellen',
    '＋ Nextcloud',
    'Jetzt synchronisieren',
    'Nur scannen',
    'Index ansehen',
    'In MusicHub',
    'Cloud-Version laden',
    'Letzte Cloud-Jobs',
    'Synchronisierung',
    'Remote aktuell',
    'Remote geändert',
    'Remote gelöscht',
    'lokale Metadaten geändert',
  ]) assert.ok(hub.includes(label), `Cloud-UI fehlt: ${label}`);

  assert.match(hub, /syncIntervalMinutes/);
  assert.match(hub, /syncQuotaBytes/);
  assert.match(hub, /syncMaxFileBytes/);
  assert.match(hub, /syncUsedBytes/);
  assert.match(hub, /\/music-hub\/nextcloud\/sources\/\$\{encodeURIComponent\(source\.id\)\}\/sync/);
  assert.match(hub, /\/retrieve/);
});

test('MusicHub-Freigabedialog trennt sensible Rechte sichtbar', () => {
  for (const label of [
    'Im Katalog sichtbar',
    'Vorhören erlauben',
    'Datei herunterladen erlauben',
    'Für Sendung verwenden erlauben',
    'Export/Transfer erlauben',
    'Gültig ab (optional)',
    'Ablauf (optional)',
  ]) assert.ok(hub.includes(label), `Freigabeoption fehlt: ${label}`);
});


test('MusicHub ist für kleine Displays responsiv abgesichert', () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /\.mh-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.mh-toolbar input\[type="search"\]/);
  assert.match(css, /\.mh-actions \.btn \{ flex: 1 1 140px; \}/);
  assert.match(css, /\.mh-job-list/);
});
