/**
 * KI-Studio (nach relay-pro6): Ansage-Typen (Text-KI gemockt) mit Kontext aus Queue/Verlauf, Meldungen zusammenfassen,
 * KI-Playlist erstellen / neu ordnen – nur IDs aus der Bibliothek, Antwort wird geprüft.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { STUDIO_KINDS, parseIdList } from '../src/server/services/ai.ts';

test('parseIdList: nur erlaubte IDs, keine Dubletten, Prosa drumherum egal', () => {
  const allowed = new Set(['a', 'b', 'c']);
  assert.deepEqual(parseIdList('Hier: ["b","x","a","b","c"] fertig', allowed), ['b', 'a', 'c']);
  assert.deepEqual(parseIdList('kein json', allowed), []);
  assert.deepEqual(parseIdList('[1, 2', allowed), []);
});

test('KI-Studio: Ansage-Typen, Kontext aus Queue, Meldungen, KI-Playlist erstellen und neu ordnen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-kistudio-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const prompts: string[] = [];
    (app.ai as any).text = async (_s: string, _p: string, _t: unknown, system: string, prompt: string) => {
      prompts.push(prompt);
      if (/Musikredakteur/.test(system)) return { text: 'Vorschlag: ["s3","s1","s2","nope"]', providerId: 'p', model: 'mock', cost: 0 };
      return { text: '„Hallo und herzlich willkommen bei uns.“', providerId: 'p', model: 'mock', cost: 0 };
    };
    const ai = app.svc.ai;
    for (const [i, id] of ['s1', 's2', 's3', 's4'].entries()) {
      app.svc.media.addMedia('main', { id, title: `Song ${i + 1}`, artist: `Artist ${i % 2}`, category: 'music', file: `${id}.mp3`, durationMs: 180_000, addedAt: 0, folder: i === 3 ? 'Oldies' : '' });
    }
    app.svc.media.addMedia('main', { id: 'j1', title: 'Jingle', artist: '', category: 'jingle', file: 'j1.mp3', durationMs: 5000, addedAt: 0 });

    assert.equal(Object.keys(STUDIO_KINDS).length, 8);
    await assert.rejects(ai.studioWrite('main', { kind: 'bogus' }), /Art:/);
    await assert.rejects(ai.studioWrite('main', { kind: 'tip' }), /Stichpunkte/);
    await assert.rejects(ai.studioWrite('main', { kind: 'an' }), /Warteschlange/);

    const mod = await ai.studioWrite('main', { kind: 'mod', tone: 'humorvoll', seconds: 20 });
    assert.equal(mod.text, 'Hallo und herzlich willkommen bei uns.', 'Anführungszeichen entfernt');
    assert.equal(mod.words, 6);
    assert.match(prompts.at(-1)!, /Ton: humorvoll/);
    assert.match(prompts.at(-1)!, /etwa 48 Wörter/);

    app.queueAdd('main', 's2');
    await ai.studioWrite('main', { kind: 'an' });
    assert.match(prompts.at(-1)!, /Nächster Titel: Artist 1 – Song 2/);

    await ai.studioWrite('main', { kind: 'news', topic: 'Meldung A. Meldung B.' });
    assert.match(prompts.at(-1)!, /<<<\nMeldung A\. Meldung B\.\n>>>/);

    // KI-Playlist: nur Musik, Antwort geprüft (nope fällt raus), Reihenfolge der KI
    await assert.rejects(ai.studioPlaylist('main', { prompt: 'kurz' }), /beschreiben/);
    const pl = await ai.studioPlaylist('main', { prompt: 'Sonntags-Oldies mit Schwung', minutes: 30 });
    assert.deepEqual(pl.items.map((i) => i.id), ['s3', 's1', 's2']);
    assert.equal(pl.totalMs, 540_000);
    assert.equal(pl.name, 'Sonntags-Oldies mit Schwung');
    assert.match(prompts.at(-1)!, /s1\|Artist 0\|Song 1/);
    assert.ok(!/j1\|/.test(prompts.at(-1)!), 'Jingles sind keine Kandidaten');
    assert.match(prompts.at(-1)!, /Ziel: ca\. 10 Titel/);

    // Ordner-Filter: nur s4 → zu wenig Kandidaten in der Antwort
    await assert.rejects(ai.studioPlaylist('main', { prompt: 'nur Oldies bitte', folder: 'Oldies' }), /zu wenige/);

    // Bestehende neu ordnen: Kandidaten beginnen mit den vorhandenen Titeln, Name mit (KI)
    const ex = app.svc.planning.savePlaylist('main', null, { name: 'Abend', items: ['s1', 's2'] });
    const fix = await ai.studioPlaylist('main', { playlistId: ex.id });
    assert.equal(fix.name, 'Abend (KI)');
    assert.equal(fix.playlistId, ex.id);
    assert.match(prompts.at(-1)!, /Verbessere die bestehende Playlist „Abend“/);
    await assert.rejects(ai.studioPlaylist('main', { playlistId: 'nope' }), /nicht gefunden/);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
