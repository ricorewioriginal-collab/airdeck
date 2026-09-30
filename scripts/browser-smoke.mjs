import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.AIRDECK_SCREENSHOT_URL || 'http://127.0.0.1:8751';
const token = process.env.AIRDECK_SCREENSHOT_TOKEN;
if (!token) throw new Error('AIRDECK_SCREENSHOT_TOKEN fehlt');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
await page.addInitScript((t) => {
  if (!localStorage.getItem('airdeck.token')) localStorage.setItem('airdeck.token', t);
}, token);

try {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-view="studio"]').first().click();
  await page.waitForSelector('#view-studio:not([hidden])');

  // Referenzlayout darf nicht nur CSS sein: alle vier echten Decks und Kernbereiche muessen bedienbar sein.
  assert.equal(await page.locator('#decks .deck').count(), 4, 'vier Decks erwartet');
  await page.waitForSelector('#carts .cart:not(.empty)');
  await page.waitForSelector('#lib-body tr');

  // Cardwall-CUE ist lokales Browser-Audio und darf nicht den Sendetrigger benutzen.
  const cue = page.locator('#carts .cart:not(.empty) .cart-cue').first();
  await cue.click();
  await page.waitForTimeout(250);
  assert.equal(await cue.getAttribute('aria-pressed'), 'true', 'Cardwall-CUE muss lokal starten');
  await cue.click();
  assert.equal(await cue.getAttribute('aria-pressed'), 'false', 'Cardwall-CUE muss lokal stoppbar sein');

  // Echtes HTML5-Drag&Drop: Medium aus dem Archiv auf ein Deck.
  const media = page.locator('#lib-body tr').first();
  const deckD = page.locator('.deck[data-deck="D"]');
  await media.dragTo(deckD);
  await page.waitForFunction(() => {
    const t = document.querySelector('.deck[data-deck="D"] .deck-title')?.textContent?.trim();
    return !!t && t !== '–';
  }, undefined, { timeout: 10_000 });

  // Deck-CUE/PFL muss denselben geladenen Titel lokal vorhoeren, ohne ihn auf Sendung zu schalten.
  const deckCue = deckD.locator('.deck-btn.cue');
  await deckCue.click();
  await page.waitForTimeout(250);
  assert.equal(await deckCue.getAttribute('aria-pressed'), 'true', 'Deck-CUE muss lokal starten');
  await deckCue.click();
  assert.equal(await deckCue.getAttribute('aria-pressed'), 'false', 'Deck-CUE muss lokal stoppbar sein');

  // Queue muss per Drag&Drop wirklich umsortierbar sein.
  await page.waitForSelector('#queue-body .queue-row');
  const rowsBefore = page.locator('#queue-body .queue-row');
  assert.ok(await rowsBefore.count() >= 2, 'Demo braucht mindestens zwei Queue-Eintraege');
  const firstUid = await rowsBefore.nth(0).getAttribute('data-queue-uid');
  const secondUid = await rowsBefore.nth(1).getAttribute('data-queue-uid');
  await rowsBefore.nth(1).dragTo(rowsBefore.nth(0));
  await page.waitForFunction(
    ({ expected }) => document.querySelector('#queue-body .queue-row')?.getAttribute('data-queue-uid') === expected,
    { expected: secondUid },
    { timeout: 10_000 },
  );
  assert.notEqual(firstUid, secondUid, 'Queue-Test braucht verschiedene Eintraege');

  // Kompakter Sendeplan bleibt im Studio, Vollansicht bleibt ueber denselben Workflow erreichbar.
  assert.equal(await page.locator('#studio-schedule').count(), 1);
  await page.locator('#studio-schedule [data-view="planning"]').click();
  await page.waitForSelector('#view-planning:not([hidden])');
  await page.waitForSelector('#view-planning .planning-schedule');
  assert.equal(await page.locator('#view-planning .planning-schedule').count(), 1, 'vollstaendiger Sendeplan fehlt');

  // Responsive Regression: Referenzdesign muss auch auf Laptop, Tablet und Handy ohne Seiten-Overflow funktionieren.
  const noHorizontalOverflow = async (label) => {
    const dims = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    assert.ok(dims.scroll <= dims.inner + 2, `${label}: horizontaler Seiten-Overflow ${dims.scroll}px > ${dims.inner}px`);
  };

  // MusicHub braucht eine echte Benutzeridentität mit Schreibrechten. Der öffentliche Demo-Account
  // bleibt eingeschränkt; der isolierte CI-Bootstrap legt dafür kurzlebige Testnutzer an.
  const ownerCredential = ['ui', 'owner', 'fixture', '1'].join('-');
  const recipientCredential = ['ui', 'recipient', 'fixture', '1'].join('-');
  for (const user of [
    { username: 'musikhub-owner', name: 'MusicHub Owner', credential: ownerCredential, roles: ['editor'] },
    { username: 'musikhub-recipient', name: 'MusicHub Empfänger', credential: recipientCredential, roles: ['dj'] },
  ]) {
    const created = await fetch(base + '/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: user.username, name: user.name, password: user.credential,
        roles: user.roles, stationIds: ['main'], mustChangePassword: false,
      }),
    });
    assert.equal(created.ok, true, `MusicHub: Testnutzer ${user.username} konnte nicht angelegt werden`);
  }
  const ownerLogin = await fetch(base + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'musikhub-owner', password: ownerCredential }),
  });
  assert.equal(ownerLogin.ok, true, 'MusicHub: Owner-Benutzerlogin fehlgeschlagen');
  const ownerToken = (await ownerLogin.json()).token;
  assert.ok(ownerToken, 'MusicHub: Owner-Benutzertoken fehlt');
  const ownerMe = await fetch(base + '/api/v1/me', { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(ownerMe.ok, true, 'MusicHub: Owner-Session ist serverseitig ungültig');
  const ownerIdentity = await ownerMe.json();
  assert.equal(ownerIdentity.user?.username, 'musikhub-owner', 'MusicHub: falsche Owner-Identität');
  assert.equal(ownerIdentity.scopes?.includes('*') || ownerIdentity.scopes?.includes('media:write'), true, 'MusicHub: Owner hat kein media:write');

  await page.evaluate((t) => localStorage.setItem('airdeck.token', t), ownerToken);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-nav-section="media"]').evaluate((el) => { /** @type {HTMLDetailsElement} */ (el).open = true; });
  await page.locator('[data-view="mediathek"]').first().click();
  await page.waitForSelector('#view-mediathek:not([hidden])');
  await page.getByRole('button', { name: 'MusikHub', exact: true }).click();
  await page.getByRole('heading', { name: 'Cloud-Quellen', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Meine persönliche Musik', exact: true }).waitFor();

  assert.equal(await page.getByRole('button', { name: '＋ Nextcloud', exact: true }).count(), 1, 'MusicHub: Nextcloud-Quelle anlegen fehlt');
  assert.equal(await page.getByRole('button', { name: '＋ Neu', exact: true }).count() >= 1, true, 'MusicHub: Sammlung anlegen fehlt');

  // Nextcloud-Konfiguration ist nicht nur Text im Quellcode: Dialog öffnen und alle Sync-Felder prüfen.
  await page.getByRole('button', { name: '＋ Nextcloud', exact: true }).click();
  await page.getByRole('heading', { name: 'Nextcloud-Quelle anlegen', exact: true }).waitFor();
  for (const label of [
    'Eigentum', 'Name', 'Nextcloud-Adresse', 'Nextcloud-Benutzer', 'Startordner', 'App-Passwort',
    'Privates/LAN-Netz erlauben (nur Admin)', 'Automatisch einweg in den MusicHub synchronisieren',
    'Sync-Intervall (Minuten)', 'Gesamtquote dieser Quelle (MB)', 'Max. Dateigröße (MB)',
  ]) assert.equal(await page.getByLabel(label, { exact: true }).count(), 1, `MusicHub Nextcloud-Dialog: Feld fehlt: ${label}`);

  // Testquelle absichtlich auf Loopback: Speichern muss funktionieren, der Sync selbst muss
  // anschließend durch den SSRF-Schutz sofort fehlschlagen und als Job sichtbar werden.
  await page.getByLabel('Name', { exact: true }).fill('UI Smoke Cloud');
  await page.getByLabel('Nextcloud-Adresse', { exact: true }).fill('https://127.0.0.1:9');
  await page.getByLabel('Nextcloud-Benutzer', { exact: true }).fill('smoke');
  await page.getByLabel('Startordner', { exact: true }).fill('/Radio');
  await page.getByLabel('App-Passwort', { exact: true }).fill('smoke-app-password');
  await page.getByLabel('Sync-Intervall (Minuten)', { exact: true }).fill('15');
  await page.getByLabel('Gesamtquote dieser Quelle (MB)', { exact: true }).fill('64');
  await page.getByLabel('Max. Dateigröße (MB)', { exact: true }).fill('16');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#dialog')?.hasAttribute('open'), undefined, { timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const text = document.querySelector('#status-text')?.textContent || '';
      return text.includes('Cloud-Quelle') || text.includes('Fehler') || text.includes('Nextcloud');
    },
    undefined,
    { timeout: 10_000 },
  );
  const cloudSaveStatus = await page.locator('#status-text').textContent();
  assert.match(cloudSaveStatus || '', /Cloud-Quelle .*UI Smoke Cloud.* gespeichert/, `MusicHub: Nextcloud-Quelle wurde nicht gespeichert: ${cloudSaveStatus}`);
  const cloudEntry = page.locator('.mh-entry').filter({ hasText: 'UI Smoke Cloud' }).first();
  await cloudEntry.waitFor({ state: 'visible', timeout: 10_000 });
  for (const action of ['Jetzt synchronisieren', 'Nur scannen', 'Index ansehen', 'Bearbeiten', 'Löschen']) {
    assert.equal(await cloudEntry.getByRole('button', { name: action, exact: true }).count(), 1, `MusicHub Cloud-Aktion fehlt: ${action}`);
  }
  await cloudEntry.getByRole('button', { name: 'Jetzt synchronisieren', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('Private oder lokale Nextcloud-Adresse'), undefined, { timeout: 10_000 });

  // Tab neu laden, damit der persistierte fehlgeschlagene Sync-Job sichtbar wird.
  await page.getByRole('button', { name: 'AirDeck-Bibliothek', exact: true }).click();
  await page.getByRole('button', { name: 'MusikHub', exact: true }).click();
  await page.getByRole('heading', { name: 'Letzte Cloud-Jobs', exact: true }).waitFor();
  assert.equal(await page.getByText('Synchronisierung', { exact: true }).count() >= 1, true, 'MusicHub: Sync-Job fehlt in der UI');
  assert.equal(await page.getByText(/fehlgeschlagen/).count() >= 1, true, 'MusicHub: fehlgeschlagener Jobstatus fehlt');

  // Persönlicher Upload wird wirklich durch den Browser ausgelöst.
  const personalUpload = page.getByLabel('Persönliche Musik hochladen', { exact: true });
  assert.equal(await personalUpload.count(), 1, 'MusicHub: persönlicher Upload fehlt oder ist nicht eindeutig');
  await personalUpload.setInputFiles({
    name: 'Smoke Artist - Smoke Song.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3-music-hub-browser-smoke'),
  });
  await page.getByText(/Smoke Song/).first().waitFor();

  const catalogAfterUpload = await page.evaluate(async () => {
    const token = localStorage.getItem('airdeck.token');
    const r = await fetch('/api/v1/music-hub/items?station=main&q=Smoke%20Song&offset=0&limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`MusicHub-Katalog HTTP ${r.status}`);
    return r.json();
  });
  const smokeItem = catalogAfterUpload.items.find((item) => item.title === 'Smoke Song');
  assert.ok(smokeItem, 'MusicHub: hochgeladener Titel fehlt im Katalog');
  for (const required of ['catalog.read','preview.play','file.download','broadcast.use','metadata.edit','shares.manage','media.upload','media.delete']) {
    assert.equal(smokeItem.actions.includes(required), true, `MusicHub: Backend-Recht fehlt: ${required}`);
  }
  const smokeEntry = page.locator(`[data-hub-item-id="${smokeItem.id}"]`);
  await smokeEntry.waitFor({ state: 'visible', timeout: 10_000 });
  for (const action of ['Cover', 'Vorhören', 'Download', 'In Queue', 'Playlist', 'Metadaten', 'Freigeben', 'Freigaben', 'In Sammlung', 'Löschen']) {
    assert.equal(await smokeEntry.getByRole('button', { name: new RegExp(action) }).count(), 1, `MusicHub Titel-Aktion fehlt: ${action}`);
  }

  // Metadaten-Dialog tatsächlich bearbeiten.
  await smokeEntry.getByRole('button', { name: 'Metadaten', exact: true }).click();
  await page.getByRole('heading', { name: 'MusicHub-Metadaten', exact: true }).waitFor();
  await page.getByLabel('Titel', { exact: true }).fill('Smoke Song UI');
  await page.getByLabel('Version / Mix', { exact: true }).fill('Browser Test');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByText(/Smoke Song UI \[Browser Test\]/).waitFor();

  const editedEntry = page.locator('.mh-entry').filter({ hasText: 'Smoke Song UI' }).first();

  // Remote-/Conflict-Status muss nicht nur Backend-Daten sein, sondern im MusicHub sichtbar werden.
  await page.route(/\/api\/v1\/music-hub\/items\?/, async (route) => {
    const reqUrl = new URL(route.request().url());
    if (!reqUrl.searchParams.has('station')) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 1,
        items: [{
          id: 'hub-ui-conflict',
          title: 'Cloud Conflict Song',
          artist: 'UI Artist',
          version: 'Remote Mix',
          revision: 3,
          owner: { kind: 'user', id: ownerIdentity.user.id },
          availability: { state: 'ready', sourceKind: 'nextcloud' },
          source: {
            kind: 'nextcloud',
            sourceId: 'ncsrc-ui',
            remotePath: '/Radio/Cloud Conflict Song.mp3',
            originalName: 'Cloud Conflict Song.mp3',
            contentType: 'audio/mpeg',
            size: 123456,
            modified: 'Wed, 30 Sep 2026 00:00:00 GMT',
            localMetadataDirty: true,
            remoteStatus: { state: 'remote_changed', checkedAt: Date.now(), remote: { size: 123999, modified: 'Wed, 30 Sep 2026 00:10:00 GMT', name: 'Cloud Conflict Song.mp3' } },
          },
          actions: ['catalog.read', 'preview.play', 'file.download', 'broadcast.use', 'metadata.edit', 'source.write', 'shares.manage', 'media.delete'],
        }],
      }),
    });
  });
  await page.getByRole('button', { name: 'Suchen / Aktualisieren', exact: true }).click();
  const conflictEntry = page.locator('.mh-entry').filter({ hasText: 'Cloud Conflict Song' }).first();
  await conflictEntry.waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await conflictEntry.getByText('Remote geändert', { exact: false }).count() >= 1, true, 'MusicHub: Remote-geändert-Status fehlt in der UI');
  assert.equal(await conflictEntry.getByText('lokale Metadaten geändert', { exact: false }).count() >= 1, true, 'MusicHub: lokaler Metadatenkonflikt fehlt in der UI');
  assert.equal(await conflictEntry.getByRole('button', { name: 'Cloud-Version laden', exact: true }).count(), 1, 'MusicHub: kontrollierter Cloud-Refresh fehlt in der UI');
  await page.unroute(/\/api\/v1\/music-hub\/items\?/);
  await page.getByRole('button', { name: 'Suchen / Aktualisieren', exact: true }).click();
  await page.getByText(/Smoke Song UI/).first().waitFor();

  // Broadcast- und Playlist-Aktion bis zum Backend ausführen.
  await editedEntry.getByRole('button', { name: '＋ In Queue', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('Sender-Queue gelegt'), undefined, { timeout: 10_000 });
  await editedEntry.getByRole('button', { name: '＋ Playlist', exact: true }).click();
  await page.getByRole('heading', { name: 'MusicHub-Titel zur Playlist', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('zur Playlist'), undefined, { timeout: 10_000 });

  // Zweistufigen Freigabedialog öffnen und sensible Rechte sichtbar prüfen.
  await editedEntry.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await page.getByRole('heading', { name: 'Empfänger suchen', exact: true }).waitFor();
  await page.getByLabel('Nutzer- oder Sendername (mindestens 2 Zeichen)', { exact: true }).fill('musikhub-recipient');
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await page.getByRole('heading', { name: 'MusicHub-Freigabe', exact: true }).waitFor();
  for (const label of [
    'Empfänger', 'Gültig für Sender', 'Im Katalog sichtbar', 'Vorhören erlauben',
    'Datei herunterladen erlauben', 'Für Sendung verwenden erlauben',
    'Gültig ab (optional)', 'Ablauf (optional)',
  ]) assert.equal(await page.getByLabel(label, { exact: true }).count(), 1, `MusicHub Freigabedialog: Feld fehlt: ${label}`);
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  // Cloud-Testquelle wieder entfernen.
  const cloudEntryAfter = page.locator('.mh-entry').filter({ hasText: 'UI Smoke Cloud' }).first();
  page.once('dialog', (dialog) => dialog.accept());
  await cloudEntryAfter.getByRole('button', { name: 'Löschen', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.mh-entry')].some((el) => el.textContent?.includes('UI Smoke Cloud')));

  await noHorizontalOverflow('MusicHub Desktop');

  await page.setViewportSize({ width: 520, height: 900 });
  await page.waitForTimeout(100);
  await noHorizontalOverflow('MusicHub Handy 520');
  assert.equal(await page.getByRole('heading', { name: 'Cloud-Quellen', exact: true }).isVisible(), true, 'MusicHub: Cloud-Bereich mobil nicht sichtbar');
  assert.equal(await page.getByText(/Smoke Song UI/).first().isVisible(), true, 'MusicHub: persönlicher Titel mobil nicht sichtbar');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('[data-view="studio"]').first().click();
  await page.waitForSelector('#view-studio:not([hidden])');
  assert.equal(await page.locator('#decks .deck').count(), 4, 'Laptop: vier echte Decks muessen erhalten bleiben');
  await noHorizontalOverflow('Laptop 1280');

  await page.setViewportSize({ width: 900, height: 1000 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.m-home').evaluate((el) => getComputedStyle(el).display !== 'none'), true, 'Tablet: mobile Studio-Uebersicht fehlt');
  await noHorizontalOverflow('Tablet 900');

  await page.setViewportSize({ width: 520, height: 900 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.bottom-nav').evaluate((el) => getComputedStyle(el).display !== 'none'), true, 'Handy: Bottom-Navigation fehlt');
  await noHorizontalOverflow('Handy 520');

  console.log('Browser-Smoke: Referenzlayout, CUE, DragDrop, Sendeplan und Responsive 1280/900/520 OK');
} finally {
  await browser.close();
}
