import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('encoder activation is independent from output.enabled', () => {
  const app = readFileSync('src/server/app.ts', 'utf8');
  assert.match(app, /list\.filter\(\(sp\) => sp\.enabled !== false\)/);
  assert.doesNotMatch(app, /o\.cfg\.enabled && o\.cfg\.profileId/);
});

test('studio exposes an independent encoder switch', () => {
  const ui = readFileSync('studio/js/app.js', 'utf8');
  assert.match(ui, /name: 'enabled', label: 'Encoder aktiv'/);
});
