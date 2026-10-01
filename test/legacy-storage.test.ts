// LocalStorage-Migration airdeck.* → anmacha_cast.* (studio/js/legacy-storage.js, docs/REBRANDING_ANMACHA_CAST.md Phase 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

function fakeLocalStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() { return data.size; },
  } as unknown as Storage;
}

async function freshModule() {
  (globalThis as unknown as { localStorage: Storage }).localStorage = fakeLocalStorage();
  // Cache-Bust: jeder Test bekommt sein eigenes Modul-Binding, aber dieselbe Logik (keine interne State-Variable im Modul selbst)
  return import(`../studio/js/legacy-storage.js?t=${Math.random()}`);
}

test('neuer Schlüssel leer, alter gesetzt: alter Wert wird übernommen und in den neuen Schlüssel geschrieben, alter bleibt bestehen', async () => {
  const { lsGet } = await freshModule();
  localStorage.setItem('airdeck.token', 'ad_alt123');
  assert.equal(lsGet('token'), 'ad_alt123');
  assert.equal(localStorage.getItem('anmacha_cast.token'), 'ad_alt123');
  assert.equal(localStorage.getItem('airdeck.token'), 'ad_alt123');
});

test('neuer Schlüssel gesetzt: hat Vorrang vor dem alten', async () => {
  const { lsGet } = await freshModule();
  localStorage.setItem('anmacha_cast.token', 'neu');
  localStorage.setItem('airdeck.token', 'alt');
  assert.equal(lsGet('token'), 'neu');
});

test('weder neuer noch alter Schlüssel gesetzt: null, kein Logout-Fehlverhalten', async () => {
  const { lsGet } = await freshModule();
  assert.equal(lsGet('token'), null);
});

test('lsSet schreibt nur den neuen Schlüssel, alter bleibt für ein Rollback bestehen', async () => {
  const { lsGet, lsSet } = await freshModule();
  localStorage.setItem('airdeck.server', 'http://alt:8750');
  lsSet('server', 'http://neu:8750');
  assert.equal(localStorage.getItem('anmacha_cast.server'), 'http://neu:8750');
  assert.equal(localStorage.getItem('airdeck.server'), 'http://alt:8750');
  assert.equal(lsGet('server'), 'http://neu:8750');
});

test('lsSet mit null/undefined entfernt beide Schlüssel (echter Logout statt Wiederauftauchen über den alten Schlüssel)', async () => {
  const { lsGet, lsSet } = await freshModule();
  localStorage.setItem('anmacha_cast.token', 'neu');
  localStorage.setItem('airdeck.token', 'alt');
  lsSet('token', null);
  assert.equal(localStorage.getItem('anmacha_cast.token'), null);
  assert.equal(localStorage.getItem('airdeck.token'), null);
  assert.equal(lsGet('token'), null);
});
