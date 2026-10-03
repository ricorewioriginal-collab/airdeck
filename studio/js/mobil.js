// @ts-check
// AnMaCha Cast Mobil – die Android-Betriebsarten (Go Live, Studio, Radioadmin) als installierbare Web-App
// (PWA, u. a. für iPhone/iPad). Sie steuert einen AnMaCha-Cast-Server; das Mikrofon geht als Live-Quelle dorthin.

import { Api, ApiError, readToken, saveServer, saveToken, serverBase } from './api.js';
import { lsGet, lsSet } from './legacy-storage.js';
import { h, fmt } from './ui.js';
import { keepAwake, micHint, registerWorker, showInstallHint } from './pwa.js';
import { openMic, recordStream } from './audio.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const TABS = /** @type {const} */ (['live', 'studio', 'radioadmin']);
const DECKS = ['A', 'B', 'C', 'D'];
const LIVE_TYPES = ['mobile', 'live_studio', 'remote_studio'];

/** @type {Api|null} */ let api = null;
/** @type {any[]} */ let stations = [];
let sid = '';
let tab = TABS.includes(/** @type {any} */ (lsGet('mobilTab'))) ? /** @type {typeof TABS[number]} */ (lsGet('mobilTab')) : 'live';
/** @type {{ rec: MediaRecorder, stream: MediaStream, sourceId: string, ctx: AudioContext|null, an: AnalyserNode|null }|null} */
let mic = null;
let pttMode = false;
/** @type {(() => void)|null} */ let stopTick = null;
let renderToken = 0;

const url = (/** @type {string} */ p) => `/stations/${encodeURIComponent(sid)}${p}`;
const media = () => $('main');
/** Link ins vollständige Studio des verbundenen Servers (Anmeldung per #token). */
const studioHref = () => (serverBase() ? `${serverBase()}/index.html#token=${encodeURIComponent(api?.token ?? '')}` : 'index.html');

/** @param {string} msg @param {boolean} [bad] */
function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = bad ? 'bad' : '';
  t.hidden = false;
  clearTimeout(/** @type {any} */ (toast).timer);
  /** @type {any} */ (toast).timer = setTimeout(() => (t.hidden = true), 4500);
}

/** @template T @param {() => Promise<T>} fn @returns {Promise<T|null>} */
async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      saveToken(null);
      location.reload();
    }
    toast(e instanceof Error ? e.message : String(e), true);
    return null;
  }
}

const card = (/** @type {string} */ title, /** @type {(Node|string|null|false)[]} */ ...kids) => h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...kids);
const title = (/** @type {any} */ m) => (m ? (m.artist ? `${m.artist} – ${m.title}` : m.title) : '–');

// ---------- Anmeldung ----------

function loginView() {
  $('tabs').hidden = true;
  const server = h('input', { type: 'text', placeholder: 'https://mein-server.example (leer = dieser Server)', value: serverBase(), autocapitalize: 'off' });
  const user = h('input', { type: 'text', placeholder: 'Benutzername', autocapitalize: 'off' });
  const pass = h('input', { type: 'password', placeholder: 'Passwort' });
  const token = h('input', { type: 'password', placeholder: 'oder API-Token' });
  const msg = h('div', { class: 'err muted' });
  const go = async () => {
    saveServer(/** @type {HTMLInputElement} */ (server).value);
    const base = serverBase();
    msg.textContent = '';
    try {
      if (!base && location.hostname.endsWith('.github.io')) throw new Error('Bitte die Adresse deines AnMaCha-Cast-Servers eintragen (https://…).');
      if (base.startsWith('http://') && location.protocol === 'https:') throw new Error('Diese Seite läuft über HTTPS – der Server muss ebenfalls mit https:// erreichbar sein.');
      let t = /** @type {HTMLInputElement} */ (token).value.trim();
      if (!t) {
        const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: /** @type {HTMLInputElement} */ (user).value.trim(), password: /** @type {HTMLInputElement} */ (pass).value }) });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.token) throw new Error(d?.message ?? `Anmeldung fehlgeschlagen (HTTP ${r.status})`);
        t = d.token;
      }
      saveToken(t);
      location.reload();
    } catch (e) {
      msg.textContent = e instanceof Error ? e.message : String(e);
    }
  };
  media().replaceChildren(card('Mit AnMaCha Cast verbinden',
    h('p', { class: 'muted' }, 'Server-Adresse, Benutzer und Passwort (oder ein API-Token) eingeben. Für das Mikrofon muss die Adresse mit https:// beginnen.'),
    server, h('div', { style: 'height:8px' }), user, h('div', { style: 'height:8px' }), pass, h('div', { style: 'height:8px' }), token, msg,
    h('div', { style: 'height:8px' }), h('button', { class: 'btn primary', onclick: go }, 'Verbinden')));
}

// ---------- Go Live ----------

async function liveView(/** @type {number} */ token) {
  const [sources, np, queue] = await Promise.all([api.get(url('/sources')), api.get(url('/now-playing')), api.get(url('/queue'))]);
  if (token !== renderToken) return;
  const live = /** @type {any[]} */ (sources).filter((s) => LIVE_TYPES.includes(s.type));
  const pick = /** @type {HTMLSelectElement} */ (h('select', {}, ...live.map((s) => h('option', { value: s.id, selected: mic?.sourceId === s.id }, `P${s.priority} · ${s.name}`))));
  const air = h('button', { class: `air${mic ? ' on' : ''}`, onclick: () => void toggleMic(pick.value) }, mic ? 'ON AIR – beenden' : 'ON AIR gehen');
  const meter = h('i');
  const ptt = h('button', { class: 'ptt', hidden: !mic || !pttMode }, '🎙 Zum Sprechen halten');
  const setTalk = (/** @type {boolean} */ on) => {
    if (!mic) return;
    for (const t of mic.stream.getAudioTracks()) t.enabled = on;
    ptt.classList.toggle('talk', on);
  };
  for (const [ev, on] of /** @type {const} */ ([['pointerdown', true], ['pointerup', false], ['pointercancel', false], ['pointerleave', false]])) ptt.addEventListener(ev, (e) => { e.preventDefault(); setTalk(on); });
  const pttBox = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: pttMode, onchange: () => { pttMode = pttBox.checked; ptt.hidden = !mic || !pttMode; if (mic) setTalk(!pttMode); } }));

  const fileIn = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true, onchange: () => void uploadFiles(fileIn.files) }));
  const q = /** @type {any[]} */ (queue.items ?? []);
  media().replaceChildren(
    card('Mikrofon live senden',
      live.length ? h('div', {}, pick, h('div', { style: 'height:10px' }), air, ptt, h('div', { class: 'meter' }, meter),
        h('label', { class: 'muted' }, pttBox, ' Push-to-Talk (Mikrofon nur beim Halten offen)'),
        !window.isSecureContext ? h('p', { class: 'err muted' }, `Mikrofon gesperrt${micHint()}`) : null)
        : h('p', { class: 'muted' }, 'Keine Live-Quelle konfiguriert – im Studio unter „Quellen“ anlegen.')),
    card('Läuft gerade', h('div', {}, title(np.media)), h('div', { class: 'muted' }, `Danach: ${title(np.next)}`),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => void run(async () => { await api.post(url('/playout/skip')); toast('Weiter'); }) }, '⏭ Weiter'),
        h('button', { class: 'btn', onclick: () => void run(async () => { await api.post(url('/queue/fill')); toast('Warteschlange aufgefüllt'); void render(); }) }, 'Auffüllen'))),
    card('Musik vom Handy', h('p', { class: 'muted' }, 'Titel vom Gerät hochladen und hinten an die Warteschlange hängen.'),
      h('label', { class: 'btn primary', style: 'display:inline-flex;align-items:center' }, '＋ Titel wählen', fileIn)),
    card(`Warteschlange (${q.length})`, ...(q.length ? q.slice(0, 30).map((/** @type {any} */ it) => h('div', { class: 'item' }, h('span', {}, title(it.media)),
      h('button', { class: 'btn small', onclick: () => void run(async () => { await api.del(url(`/queue/${encodeURIComponent(it.uid)}`)); void render(); }) }, '✕'))) : [h('p', { class: 'muted' }, 'Leer.')])));

  stopTick?.();
  if (mic?.an) {
    const an = mic.an;
    const buf = new Uint8Array(an.fftSize);
    const id = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
      meter.style.width = `${Math.min(100, Math.round(peak * 140))}%`;
    }, 80);
    stopTick = () => clearInterval(id);
  }
}

/** @param {string} sourceId */
async function toggleMic(sourceId) {
  if (mic) {
    const m = mic;
    mic = null;
    m.rec.stop();
    for (const t of m.stream.getTracks()) t.stop();
    void m.ctx?.close();
    void keepAwake(false);
    await run(() => api.post(`/stations/${encodeURIComponent(sid)}/sources/${encodeURIComponent(m.sourceId)}/release`));
    toast('Sendung beendet – Automation übernimmt wieder');
  } else {
    let stream;
    try {
      stream = await openMic();
    } catch (e) {
      return toast(`Mikrofon nicht verfügbar: ${e instanceof Error ? e.message : e}${micHint()}`, true);
    }
    try {
      const path = `/stations/${encodeURIComponent(sid)}/sources/${encodeURIComponent(sourceId)}/chunks`;
      const rec = recordStream(stream, async (blob, first, type) => {
        await api.req('POST', `${path}${first ? '?start=1' : ''}`, blob, { 'Content-Type': type });
      });
      const AC = window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext;
      const ctx = AC ? new AC() : null;
      const an = ctx ? ctx.createAnalyser() : null;
      if (ctx && an) {
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
      }
      mic = { rec, stream, sourceId, ctx, an };
      if (pttMode) for (const t of stream.getAudioTracks()) t.enabled = false;
      void keepAwake(true);
      toast('Du bist auf Sendung');
    } catch (e) {
      for (const t of stream.getTracks()) t.stop();
      return toast(e instanceof Error ? e.message : String(e), true);
    }
  }
  void render();
}

/** @param {FileList|null} files */
async function uploadFiles(files) {
  let ok = 0;
  for (const f of Array.from(files ?? [])) {
    toast(`Lade hoch: ${f.name} …`);
    const m = await run(() => api.req('PUT', url(`/media?name=${encodeURIComponent(f.name)}&category=music`), f, { 'Content-Type': f.type || 'application/octet-stream' }));
    if (m?.id && (await run(async () => { await api.post(url('/queue'), { mediaId: m.id }); return true; }))) ok++;
  }
  toast(`${ok} Titel zur Warteschlange hinzugefügt`, !ok);
  void render();
}

// ---------- Studio ----------

async function studioView(/** @type {number} */ token) {
  const [decks, lib, playlists] = await Promise.all([api.get(url('/decks')), api.get(url('/media')), api.get(url('/playlists')).catch(() => [])]);
  if (token !== renderToken) return;
  const items = /** @type {any[]} */ (Array.isArray(lib) ? lib : lib?.items ?? []);
  const byId = new Map(items.map((m) => [m.id, m]));
  const deck = (/** @type {string} */ id, /** @type {string} */ action, /** @type {any} */ body = {}) => run(async () => { await api.post(url(`/decks/${id}/${action}`), body); void render(); });
  const results = h('div', {});
  const search = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Mediathek durchsuchen …' }));
  const showResults = () => {
    const needle = search.value.trim().toLowerCase();
    const hits = needle ? items.filter((m) => `${m.artist ?? ''} ${m.title ?? ''}`.toLowerCase().includes(needle)).slice(0, 25) : [];
    results.replaceChildren(...hits.map((m) => h('div', { class: 'item' }, h('span', {}, title(m)),
      h('select', { onchange: (/** @type {Event} */ e) => { const s = /** @type {HTMLSelectElement} */ (e.target); const v = s.value; s.value = ''; if (v === 'q') void run(async () => { await api.post(url('/queue'), { mediaId: m.id }); toast('In der Warteschlange'); }); else if (v) void deck(v, 'load', { mediaId: m.id }); } },
        h('option', { value: '' }, '＋'), h('option', { value: 'q' }, 'Queue'), ...DECKS.map((d) => h('option', { value: d }, `Deck ${d}`))))));
  };
  search.addEventListener('input', showResults);
  const state = new Map(/** @type {any[]} */ (decks).map((d) => [d.id, d]));
  media().replaceChildren(
    card('Decks', ...DECKS.map((id) => {
      const d = state.get(id);
      const playing = d?.status === 'playing';
      return h('div', { class: `deck${playing ? ' playing' : ''}` }, h('b', {}, id), h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, d?.mediaId ? title(byId.get(d.mediaId)) : 'leer'),
        h('button', { class: 'btn small', disabled: !d?.mediaId, onclick: () => void deck(id, playing ? 'pause' : 'play') }, playing ? '⏸' : '▶'),
        h('button', { class: 'btn small', disabled: !d?.mediaId, onclick: () => void deck(id, 'stop') }, '■'));
    })),
    card('Mediathek', search, results),
    card('Playlisten', ...((/** @type {any[]} */ (playlists)).length ? (/** @type {any[]} */ (playlists)).map((p) => h('div', { class: 'item' }, h('span', {}, p.name ?? p.title ?? p.id),
      h('button', { class: 'btn small', onclick: () => void run(async () => { await api.post(url(`/playlists/${encodeURIComponent(p.id)}/play`)); toast('Playlist gestartet'); }) }, '▶'))) : [h('p', { class: 'muted' }, 'Keine Playlisten.')])));
}

// ---------- Radioadmin (laut.fm) ----------

async function radioView(/** @type {number} */ token) {
  const st = stations.find((s) => s.id === sid);
  if (!st?.lautfmConnected) {
    media().replaceChildren(card('Radioadmin', h('p', { class: 'muted' }, 'Für diesen Sender ist laut.fm nicht verbunden. Das geht einmalig im vollständigen Studio (Menü „Mehr“ → laut.fm).'), h('a', { class: 'btn primary', href: studioHref(), style: 'display:inline-flex;align-items:center;text-decoration:none' }, 'Vollständiges Studio öffnen')));
    return;
  }
  const cfg = await api.get(url('/lautfm'));
  if (token !== renderToken) return;
  const ra = (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ body = undefined) => api.req(method, url(`/lautfm/ra${path}`), body);
  const base = `/stations/${cfg.stationId}`;
  const [stats, playlists] = await Promise.all([ra('GET', `${base}/stats`).catch(() => null), ra('GET', `${base}/playlists`).catch(() => [])]);
  if (token !== renderToken) return;
  const pls = /** @type {any[]} */ (Array.isArray(playlists) ? playlists : playlists?.playlists ?? []);
  const results = h('div', {});
  const f = { artist: h('input', { placeholder: 'Interpret' }), title: h('input', { placeholder: 'Titel' }), genre: h('input', { placeholder: 'Genre' }) };
  const search = () => run(async () => {
    const qs = new URLSearchParams();
    for (const [k, el] of Object.entries(f)) if (/** @type {HTMLInputElement} */ (el).value.trim()) qs.set(k, /** @type {HTMLInputElement} */ (el).value.trim());
    const r = await ra('GET', `${base}/tracks?${qs}`);
    const tr = /** @type {any[]} */ (r?.tracks ?? []);
    results.replaceChildren(...(tr.length ? tr.slice(0, 40).map((t) => h('div', { class: 'item' }, h('span', {}, `${typeof t.artist === 'object' ? t.artist?.name ?? '' : t.artist ?? ''} – ${t.title ?? ''}`, h('div', { class: 'muted' }, `${fmt((t.duration ?? t.length ?? 0) * 1000)}${t.private ? ' · privat' : ''}`)),
      h('select', { onchange: (/** @type {Event} */ e) => { const s = /** @type {HTMLSelectElement} */ (e.target); const v = s.value; s.value = ''; if (v) void run(async () => { await ra('POST', `${base}/playlists/${v}`, { track_id: t.id }); toast('Zur Playlist hinzugefügt'); }); } },
        h('option', { value: '' }, '＋'), ...pls.map((p) => h('option', { value: String(p.id) }, p.title))))) : [h('p', { class: 'muted' }, 'Keine Treffer.')]));
  });
  media().replaceChildren(
    card('Jetzt', h('div', {}, `Hörer: ${stats?.listeners_now ?? '–'}`), h('div', { class: 'muted' }, stats?.position_now ? `Position: ${stats.position_now}` : '')),
    card('Titel suchen', f.artist, h('div', { style: 'height:8px' }), f.title, h('div', { style: 'height:8px' }), f.genre, h('div', { style: 'height:8px' }), h('button', { class: 'btn primary', onclick: () => void search() }, 'Suchen'), results),
    card(`Playlisten (${pls.length})`, ...pls.map((p) => h('div', { class: 'item' }, h('span', {}, p.title), h('span', { class: 'muted' }, `${p.size ?? 0} Titel`)))),
    card('Mehr', h('p', { class: 'muted' }, 'Hochladen mit Optionen, Tags, Automations-Algorithmen, Sendeplan und Statistik: im vollständigen Studio.'), h('a', { class: 'btn', href: studioHref(), style: 'display:inline-flex;align-items:center;text-decoration:none' }, 'Vollständiges Studio')));
}

// ---------- Rahmen ----------

async function render() {
  const token = ++renderToken;
  stopTick?.();
  stopTick = null;
  for (const b of $('tabs').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  const pill = $('pill');
  pill.textContent = mic ? 'ON AIR' : 'AUS';
  pill.className = `pill${mic ? ' on' : ''}`;
  await run(async () => {
    if (tab === 'live') await liveView(token);
    else if (tab === 'studio') await studioView(token);
    else await radioView(token);
  });
}

async function boot() {
  registerWorker();
  showInstallHint();
  const token = readToken();
  if (!token) return loginView();
  api = new Api(token);
  const list = await run(() => api.get('/stations'));
  if (!list) return loginView();
  stations = /** @type {any[]} */ (list);
  if (!stations.length) return void media().replaceChildren(card('', h('p', {}, 'Keine Sender vorhanden.')));
  sid = stations.find((s) => s.id === lsGet('station'))?.id ?? stations[0].id;
  const sel = /** @type {HTMLSelectElement} */ ($('station'));
  sel.replaceChildren(...stations.map((s) => h('option', { value: s.id, selected: s.id === sid }, s.name)));
  sel.addEventListener('change', () => {
    if (mic) {
      sel.value = sid;
      return toast('Erst die Sendung beenden', true);
    }
    sid = sel.value;
    lsSet('station', sid);
    void render();
  });
  for (const b of $('tabs').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      tab = /** @type {typeof tab} */ (b.dataset.tab);
      lsSet('mobilTab', tab);
      void render();
    });
  }
  // „Go Live“-Ansicht ohne laufende Sendung alle 5 s aktuell halten (nicht während der Sendung: Push-to-Talk darf nicht unterbrochen werden)
  setInterval(() => {
    if (document.hidden || tab !== 'live' || mic || document.activeElement?.matches('input,select')) return;
    void render();
  }, 5000);
  await render();
}

void boot();
