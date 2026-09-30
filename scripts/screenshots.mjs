import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.AIRDECK_SCREENSHOT_URL || 'http://127.0.0.1:8751';
const token = process.env.AIRDECK_SCREENSHOT_TOKEN;
if (!token) throw new Error('AIRDECK_SCREENSHOT_TOKEN fehlt');

const out = new URL('../docs/screenshots/', import.meta.url);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 1 });
await page.addInitScript((t) => localStorage.setItem('airdeck.token', t), token);
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#view-overview:not([hidden])', { timeout: 20_000 });
await page.waitForTimeout(800);

async function view(name, file) {
  const button = page.locator(`[data-view="${name}"]`).first();
  const section = button.locator('xpath=ancestor::details[1]');
  if (await section.count() && await section.getAttribute('open') === null) {
    await section.locator('summary').first().click();
  }
  await button.click();
  await page.waitForSelector(`#view-${name}:not([hidden])`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: new URL(file, out).pathname, fullPage: false });
}
async function panel(win, file) {
  await page.locator('[data-view="studio"]').first().click();
  await page.waitForSelector('#view-studio:not([hidden])');
  const target = page.locator(`[data-win="${win}"]`).first();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await target.screenshot({ path: new URL(file, out).pathname });
}

await page.screenshot({ path: new URL('view-dashboard.png', out).pathname, fullPage: false });
for (const [name, file] of [
  ['studio','view-studio.png'],
  ['planning','view-planning.png'],
  ['mediathek','view-mediathek.png'],
  ['playlists','view-playlists.png'],
  ['recorder','view-recorder.png'],
  ['ai','view-ai.png'],
  ['bridges','view-bridges.png'],
  ['listeners','view-listeners.png'],
  ['users','view-users.png'],
  ['handbuch','view-handbuch.png'],
]) await view(name, file);

// MusicHub separat dokumentieren – mit echter Benutzeridentität, damit persönliche Uploads,
// Cloud-Quellen und die owner-gebundenen Aktionen im Screenshot tatsächlich sichtbar sind.
const screenshotCredential = ['ui', 'screenshot', 'fixture', '1'].join('-');
const screenshotUser = 'musikhub-screenshot';
const createScreenshotUser = await fetch(base + '/api/v1/users', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: screenshotUser, name: 'MusicHub Screenshot', password: screenshotCredential,
    roles: ['editor'], stationIds: ['main'], mustChangePassword: false,
  }),
});
if (!createScreenshotUser.ok && createScreenshotUser.status !== 409) {
  throw new Error(`MusicHub-Screenshot-Nutzer konnte nicht angelegt werden: HTTP ${createScreenshotUser.status}`);
}
const screenshotLogin = await fetch(base + '/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: screenshotUser, password: screenshotCredential }),
});
if (!screenshotLogin.ok) throw new Error(`MusicHub-Screenshot-Login fehlgeschlagen: HTTP ${screenshotLogin.status}`);
const screenshotToken = (await screenshotLogin.json()).token;

const existingCatalog = await fetch(base + '/api/v1/music-hub/items?station=main&q=Screenshot%20Song&offset=0&limit=50', {
  headers: { Authorization: `Bearer ${screenshotToken}` },
});
const existingItems = existingCatalog.ok ? (await existingCatalog.json()).items ?? [] : [];
if (!existingItems.some((item) => item.title === 'Screenshot Song')) {
  const upload = await fetch(base + '/api/v1/music-hub/personal?station=main&name=Screenshot%20Artist%20-%20Screenshot%20Song.mp3', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${screenshotToken}`, 'Content-Type': 'audio/mpeg' },
    body: Buffer.from('ID3-airdeck-musikhub-screenshot'),
  });
  if (!upload.ok) throw new Error(`MusicHub-Screenshot-Titel konnte nicht angelegt werden: HTTP ${upload.status}`);
}

await page.evaluate((t) => localStorage.setItem('airdeck.token', t), screenshotToken);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('[data-nav-section="media"]').evaluate((el) => { /** @type {HTMLDetailsElement} */ (el).open = true; });
await page.locator('[data-view="mediathek"]').first().click();
await page.waitForSelector('#view-mediathek:not([hidden])');
await page.getByRole('button', { name: 'MusikHub', exact: true }).click();
await page.getByRole('heading', { name: 'Cloud-Quellen', exact: true }).waitFor();
await page.getByText(/Screenshot Song/).first().waitFor();
await page.waitForTimeout(350);
await page.setViewportSize({ width: 1600, height: 1050 });
await page.screenshot({ path: new URL('view-musikhub.png', out).pathname, fullPage: false });
await page.setViewportSize({ width: 520, height: 900 });
await page.waitForTimeout(250);
await page.screenshot({ path: new URL('view-musikhub-mobile.png', out).pathname, fullPage: false });
await page.setViewportSize({ width: 1600, height: 1050 });
await page.setViewportSize({ width: 520, height: 900 });
await page.waitForTimeout(250);
await page.screenshot({ path: new URL('view-musikhub-mobile.png', out).pathname, fullPage: true });
await page.setViewportSize({ width: 1600, height: 1050 });
await page.waitForTimeout(250);

for (const [win, file] of [
  ['decks','panel-decks.png'],
  ['carts','panel-carts.png'],
  ['np','panel-np.png'],
  ['lib','panel-lib.png'],
  ['queue','panel-queue.png'],
  ['quick','panel-quick.png'],
  ['live','panel-live.png'],
  ['stream','panel-stream.png'],
  ['playout','panel-playout.png'],
  ['processing','panel-processing.png'],
  ['meters','panel-meters.png'],
  ['sources','panel-sources.png'],
  ['system','panel-system.png'],
]) {
  if (await page.locator(`[data-win="${win}"]`).count()) await panel(win, file);
}

await browser.close();
console.log('AirDeck-Screenshots aktualisiert.');
