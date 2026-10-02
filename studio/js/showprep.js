// @ts-check
// News-Zentrale (Show-Prep) - nach showprep.html im AnMaCha Control Center: Feeds links (Standard + eigene,
// nach Kategorie), Artikel in der Mitte (Auswahl per Haken für den KI-Vorschlag), rechts Leseansicht mit
// Teleprompter (Schriftgröße, Serifen, Lauf-Tempo, Pause) und Wetter-Block (Open-Meteo über den Server).

import { h, run, status } from './ui.js';

/** @typedef {{ api: import('./api.js').Api, url: (p: string) => string }} Ctx */

const LS = 'anmachacast.showprep';
/** @param {number|null} t */
const when = (t) => (t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountShowPrep(root, ctx) {
  /** @type {any[]} */ let feeds = [];
  /** @type {any[]} */ let articles = [];
  /** @type {string[]} */ let errors = [];
  /** @type {{ feedId?: string, category?: string }} */ let active = {};
  /** @type {Set<number>} */ const picked = new Set();
  /** @type {any|null} */ let reader = null; // { title, text, meta }
  /** @type {any|null} */ let weather = null;
  const prefs = (() => { try { return { size: 22, serif: false, speed: 60, city: '', ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { size: 22, serif: false, speed: 60, city: '' }; } })();
  const savePrefs = () => { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch { /* privat */ } };
  let tele = false;
  let paused = false;

  async function load() {
    feeds = (await ctx.api.get(ctx.url('/showprep/feeds'))) ?? [];
    if (!active.feedId && !active.category && feeds[0]) active = { feedId: feeds[0].id };
    await loadArticles();
  }

  async function loadArticles(force = false) {
    const q = active.feedId ? `feed=${encodeURIComponent(active.feedId)}` : `category=${encodeURIComponent(active.category ?? '')}`;
    const r = await ctx.api.get(ctx.url(`/showprep/articles?${q}${force ? '&force=1' : ''}`)).catch((/** @type {Error} */ e) => ({ items: [], errors: [e.message] }));
    articles = r.items ?? []; errors = r.errors ?? []; picked.clear();
    render();
  }

  // ---------- Teleprompter ----------
  const readerBody = h('div', { class: 'sp-reader-body' });
  function applyStyle() {
    readerBody.style.fontSize = `${prefs.size}px`;
    readerBody.classList.toggle('serif', !!prefs.serif);
    readerBody.classList.toggle('tele-run', tele);
    readerBody.classList.toggle('tele-paused', paused);
    const text = readerBody.querySelector('.sp-text');
    if (text instanceof HTMLElement) text.style.animationDuration = `${Math.max(20, Math.round((text.scrollHeight / 100) * (120 - prefs.speed) / 2))}s`;
  }
  function drawReader() {
    readerBody.replaceChildren(reader
      ? h('div', { class: 'sp-text' }, h('h2', {}, reader.title), reader.meta ? h('div', { class: 'muted small sp-meta' }, reader.meta) : null, ...String(reader.text).split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÄÖÜ])/).filter(Boolean).map((p) => h('p', {}, p)))
      : h('div', { class: 'empty' }, 'Artikel wählen – oder „KI-Vorschlag“ für fertige Moderationsnotizen.'));
    applyStyle();
  }
  function toggleTele() { tele = !tele; paused = false; if (tele) readerBody.scrollTop = 0; applyStyle(); renderBar(); }

  const bar = h('div', { class: 'sp-toolbar' });
  function renderBar() {
    bar.replaceChildren(...[
      h('button', { class: 'btn small', onclick: () => { prefs.size = Math.max(14, prefs.size - 2); savePrefs(); applyStyle(); } }, 'A−'),
      h('button', { class: 'btn small', onclick: () => { prefs.size = Math.min(48, prefs.size + 2); savePrefs(); applyStyle(); } }, 'A+'),
      h('button', { class: `btn small${prefs.serif ? ' primary' : ''}`, onclick: () => { prefs.serif = !prefs.serif; savePrefs(); applyStyle(); renderBar(); } }, 'Serif'),
      h('label', { class: 'sp-speed muted small' }, 'Tempo ', h('input', { type: 'range', min: '10', max: '110', value: String(prefs.speed), oninput: (/** @type {Event} */ e) => { prefs.speed = Number(/** @type {HTMLInputElement} */ (e.target).value); savePrefs(); applyStyle(); } })),
      h('button', { class: `btn small${tele ? ' primary' : ''}`, onclick: toggleTele }, tele ? '■ Teleprompter aus' : '▶ Teleprompter'),
      tele ? h('button', { class: 'btn small', onclick: () => { paused = !paused; applyStyle(); renderBar(); } }, paused ? '▶ Weiter' : '⏸ Pause') : null,
      reader ? h('button', { class: 'btn small', onclick: () => { navigator.clipboard?.writeText(`${reader.title}\n\n${reader.text}`); status('Text kopiert'); } }, '⎘ Kopieren') : null,
      reader?.link ? h('a', { class: 'btn small', href: reader.link, target: '_blank', rel: 'noopener' }, '↗ Quelle') : null,
    ].filter((x) => x !== null));
  }

  // ---------- KI-Vorschlag ----------
  async function aiNotes() {
    const arts = [...picked].map((i) => articles[i]).filter(Boolean);
    if (!arts.length && !weather) { status('Erst Artikel anhaken (oder Wetter laden)', true); return; }
    status('KI schreibt Moderationsnotizen …');
    const r = await run(() => ctx.api.post(ctx.url('/showprep/notes'), { articles: arts.map((a) => ({ title: a.title, text: a.text })), weather: weather?.speech ?? '', seconds: 60 }));
    if (!r) return;
    reader = { title: `Moderationsnotizen (${arts.length} Meldung${arts.length === 1 ? '' : 'en'}${weather ? ' + Wetter' : ''})`, text: r.text, meta: `KI-Vorschlag · ${r.model} · immer gegenlesen` };
    drawReader(); renderBar();
    status('Notizen fertig – gegenlesen, dann Teleprompter starten');
  }

  // ---------- Wetter ----------
  const weatherBox = h('div', { class: 'sp-weather' });
  function drawWeather() {
    const cityIn = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Stadt, z. B. Hannover', value: prefs.city, onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') loadWeather(cityIn.value); } }));
    weatherBox.replaceChildren(
      h('div', { class: 'sp-row' }, cityIn, h('button', { class: 'btn small primary', onclick: () => loadWeather(cityIn.value) }, '☀️ Wetter laden')),
      weather ? h('div', { class: 'sp-weather-now' },
        h('span', { class: 'sp-weather-icon' }, weather.now.icon),
        h('div', {}, h('b', {}, `${weather.city}${weather.country ? `, ${weather.country}` : ''}`), h('div', {}, `${Math.round(weather.now.temp)} °C · ${weather.now.text} · Wind ${Math.round(weather.now.wind)} km/h · ${weather.now.humidity} % Luftfeuchte`)),
        h('div', { class: 'sp-weather-days' }, ...weather.days.slice(0, 4).map((/** @type {any} */ d) => h('div', {}, h('span', {}, d.icon), h('b', {}, d.weekday.slice(0, 2)), h('span', { class: 'muted small' }, `${Math.round(d.max)}°/${Math.round(d.min)}°`)))),
        h('div', { class: 'sp-row' }, h('button', { class: 'btn small', onclick: () => { reader = { title: `Wetter ${weather.city}`, text: weather.speech, meta: 'Open-Meteo · sprechbarer Text' }; drawReader(); renderBar(); } }, '→ In den Teleprompter'))) : h('div', { class: 'muted small' }, 'Stadt eingeben – aktuelle Lage, 4-Tage-Trend und ein sprechbarer Wettertext für die Moderation.'));
  }
  async function loadWeather(/** @type {string} */ city) {
    if (!city.trim()) { status('Stadt angeben', true); return; }
    const w = await run(() => ctx.api.get(ctx.url(`/showprep/weather?city=${encodeURIComponent(city)}`)));
    if (!w) return;
    weather = w; prefs.city = city; savePrefs(); drawWeather();
  }

  // ---------- Feeds / Artikel ----------
  async function addFeed() {
    const name = prompt('Name des Feeds'); if (!name) return;
    const url = prompt('RSS-/Atom-URL (https://…)'); if (!url) return;
    const f = await run(() => ctx.api.post(ctx.url('/showprep/feeds'), { name, url }));
    if (f) { active = { feedId: f.id }; await load(); }
  }

  function feedList() {
    /** @type {Record<string, any[]>} */ const cats = {};
    for (const f of feeds) (cats[f.category] ??= []).push(f);
    return Object.entries(cats).flatMap(([cat, list]) => [
      h('button', { class: `sp-cat${active.category === cat ? ' on' : ''}`, title: 'Alle Quellen dieser Kategorie zusammen', onclick: () => { active = { category: cat }; run(() => loadArticles()); } }, cat, h('span', { class: 'muted' }, ` ${list.length}`)),
      ...list.map((f) => h('div', { class: `sp-feed${active.feedId === f.id ? ' on' : ''}` },
        h('button', { class: 'sp-feed-btn', onclick: () => { active = { feedId: f.id }; run(() => loadArticles()); } }, f.name),
        h('button', { class: 'sp-feed-x', title: 'Entfernen', onclick: () => { if (confirm(`„${f.name}“ entfernen?`)) run(async () => { await ctx.api.del(ctx.url(`/showprep/feeds/${f.id}`)); if (active.feedId === f.id) active = {}; await load(); }); } }, '✕'))),
    ]);
  }

  function articleList() {
    if (!articles.length) return [h('div', { class: 'empty' }, errors.length ? `Feed nicht erreichbar: ${errors.join(' · ')}` : 'Keine Artikel.')];
    return articles.map((a, i) => h('div', { class: `sp-art${picked.has(i) ? ' picked' : ''}` },
      h('input', { type: 'checkbox', checked: picked.has(i), title: 'Für den KI-Vorschlag auswählen', onchange: (/** @type {Event} */ e) => { /** @type {HTMLInputElement} */ (e.target).checked ? picked.add(i) : picked.delete(i); renderHead(); } }),
      h('button', { class: 'sp-art-btn', onclick: () => { reader = { title: a.title, text: a.text || '(Kein Text im Feed – „Quelle“ öffnet den Artikel.)', meta: `${a.feed}${a.at ? ` · ${when(a.at)}` : ''}`, link: a.link }; drawReader(); renderBar(); } },
        h('b', {}, a.title), h('span', { class: 'muted small' }, ` ${a.feed}${a.at ? ` · ${when(a.at)}` : ''}`),
        a.text ? h('div', { class: 'muted small sp-art-text' }, a.text.slice(0, 160)) : null)));
  }

  const head = h('div', { class: 'sp-list-head' });
  function renderHead() {
    const title = active.feedId ? feeds.find((f) => f.id === active.feedId)?.name : active.category;
    head.replaceChildren(h('b', {}, title ?? 'Feed wählen …'), h('span', { class: 'muted small' }, `${articles.length} Artikel${picked.size ? ` · ${picked.size} gewählt` : ''}`),
      h('button', { class: 'btn small', title: 'Neu laden', onclick: () => run(() => loadArticles(true)) }, '⟳'),
      h('button', { class: 'btn small primary', disabled: !picked.size && !weather, onclick: aiNotes }, '✨ KI-Vorschlag'));
  }

  function render() {
    renderHead(); drawReader(); renderBar(); drawWeather();
    root.replaceChildren(
      h('div', { class: 'listener-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'PROGRAMM PLANEN'), h('h1', {}, 'News-Zentrale (Show-Prep)'),
          h('p', {}, 'Feeds lesen, Meldungen auswählen, Wetter dazu – die KI macht daraus sprechbare Moderationsnotizen für den Teleprompter.')),
        h('div', { class: 'listener-hero-actions' }, h('button', { class: 'btn small', onclick: addFeed }, '＋ Feed'), h('button', { class: 'btn small', onclick: () => { if (confirm('Eigene Feeds löschen und Standardliste wiederherstellen?')) run(async () => { await ctx.api.post(ctx.url('/showprep/feeds/reset'), {}); active = {}; await load(); }); } }, 'Standard-Feeds'))),
      h('div', { class: 'sp-grid' },
        h('section', { class: 'panel sp-feeds' }, h('h3', {}, 'Quellen'), ...feedList()),
        h('section', { class: 'panel sp-list' }, head, h('div', { class: 'sp-list-body' }, ...articleList())),
        h('section', { class: 'panel sp-reader' }, bar, readerBody, h('h3', {}, '☀️ Wetter-Block'), weatherBox)));
  }

  return { show: () => run(load), onEvent: () => {} };
}
