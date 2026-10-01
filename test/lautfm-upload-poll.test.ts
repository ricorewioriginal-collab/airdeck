// lautCast Phase 2: Verarbeitungs-Poll nach einem Titel-Upload (Referenz: automation.html
// waitForNewTrack() - exponentielles Backoff 800 ms → ×1,4 je Versuch, Deckel 4000 ms, max. 90 s
// Gesamtwartezeit, ab dem zweiten Versuch zusätzlich Cross-Check gegen ;queued/;incomplete).
// Reine Logikprüfung ohne echte Zeit/Netzwerk - studio/js/lautfm.js exportiert waitForNewTrackLogic()
// für genau diesen Zweck, mit injizierbaren API-Aufrufen und einer injizierbaren Uhr/Verzögerung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error – Browser-Modul ohne Typdeklaration
import { waitForNewTrackLogic } from '../studio/js/lautfm.js';

test('waitForNewTrackLogic: findet die neue Track-ID sofort, wenn sie bereits über der Schnappschuss-ID liegt', async () => {
  const sleeps: number[] = [];
  const result = await waitForNewTrackLogic(100, -501, {
    ownDesc: async () => ({ tracks: [{ id: 101 }] }),
    queuedIncomplete: async () => { throw new Error('sollte bei sofortigem Treffer nicht aufgerufen werden'); },
    sleep: async (ms: number) => { sleeps.push(ms); },
  });
  assert.equal(result, 101);
  assert.deepEqual(sleeps, [], 'kein Warten nötig, wenn der erste Abruf bereits die neue ID liefert');
});

test('waitForNewTrackLogic: exponentielles Backoff (800 → ×1,4, Deckel 4000) bis zum Treffer', async () => {
  let call = 0;
  const sleeps: number[] = [];
  const result = await waitForNewTrackLogic(100, -501, {
    ownDesc: async () => { call++; return call < 4 ? { tracks: [{ id: 100 }] } : { tracks: [{ id: 102 }] }; },
    queuedIncomplete: async () => [{ tracks: [{ id: -501 }] }, { tracks: [] }],
    sleep: async (ms: number) => { sleeps.push(ms); },
  });
  assert.equal(result, 102);
  // 800, dann 800*1.4=1120, dann 1120*1.4=1568 (vor dem vierten, erfolgreichen Abruf)
  assert.deepEqual(sleeps, [800, 1120, 1568]);
});

test('waitForNewTrackLogic: Cross-Check gegen ;queued/;incomplete erkennt Abschluss, auch wenn own=true&order=desc noch nicht aktualisiert ist', async () => {
  let call = 0;
  const result = await waitForNewTrackLogic(100, -501, {
    ownDesc: async () => {
      call++;
      // Erster Aufruf: alte ID. Zweiter Aufruf (Versuch 2, normaler Pfad): weiterhin alte ID.
      // Dritter Aufruf (innerhalb des Cross-Checks in Versuch 2): liefert jetzt die neue ID.
      return call >= 3 ? { tracks: [{ id: 103 }] } : { tracks: [{ id: 100 }] };
    },
    queuedIncomplete: async () => [{ tracks: [] }, { tracks: [] }], // negId nicht mehr gelistet -> fertig
    sleep: async () => {},
  });
  assert.equal(result, 103);
  assert.equal(call, 3, 'erster Versuch + zweiter Versuch + Cross-Check-Nachabruf');
});

test('waitForNewTrackLogic: gibt nach Ablauf von maxWaitMs ehrlich null zurück (kein erfundener Erfolg)', async () => {
  let simulatedNow = 0;
  const result = await waitForNewTrackLogic(100, -501, {
    ownDesc: async () => ({ tracks: [{ id: 100 }] }),
    queuedIncomplete: async () => [{ tracks: [{ id: -501 }] }, { tracks: [] }],
    sleep: async (ms: number) => { simulatedNow += ms; },
    now: () => simulatedNow,
    maxWaitMs: 5000,
  });
  assert.equal(result, null);
});
