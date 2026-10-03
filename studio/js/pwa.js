// @ts-check
// PWA-Helfer (v. a. für iPhone/iPad ohne App Store): Service Worker, Installationshinweis,
// Bildschirm wachhalten während der Sendung, Hinweis bei fehlendem HTTPS.

import { lsGet, lsSet } from './legacy-storage.js';

const HINT_KEY = 'iosInstallHint';

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;

/** Service Worker registrieren (nur über HTTPS/localhost, nie in der Android-App). */
export function registerWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/** Einmaliger Hinweis „Zum Home-Bildschirm“ für iOS-Safari. */
export function showInstallHint() {
  if (!isIos() || isStandalone() || lsGet(HINT_KEY) === '1') return;
  const bar = document.createElement('div');
  bar.className = 'install-hint';
  bar.setAttribute('role', 'note');
  const text = document.createElement('span');
  text.textContent = 'Als App nutzen: in Safari auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen.';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = 'OK';
  ok.addEventListener('click', () => {
    lsSet(HINT_KEY, '1');
    bar.remove();
  });
  bar.append(text, ok);
  document.body.append(bar);
}

/** Erklärung, falls das Mikrofon mangels HTTPS gesperrt ist. */
export function micHint() {
  return window.isSecureContext ? '' : ' – Browser geben das Mikrofon nur über HTTPS frei (Adresse mit https:// öffnen)';
}

/** @type {any} */
let lock = null;

/** Hält den Bildschirm wach (iOS 16.4+/Android), solange gesendet wird. */
export async function keepAwake(on) {
  try {
    if (!on) {
      await lock?.release();
      lock = null;
    } else if (!lock && /** @type {any} */ (navigator).wakeLock) {
      lock = await /** @type {any} */ (navigator).wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    }
  } catch {
    lock = null;
  }
}
