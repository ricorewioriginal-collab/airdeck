// @ts-check
// Hörerstatistik - nach dem Statistik-Tab des AnMaCha Control Centers: Zeitraum-Chips, Kennzahl-Kacheln und
// Untertabs Gespielt / Top-Songs / Hörer-Verlauf / Genre-Mix / Live-Plays. Daten: GET /stats?period=…
// Diagramme als leichtes Inline-SVG (keine Bibliothek).

import { fmt, h, mediaTitle, run } from './ui.js';

const PERIODS = /** @type {[string,string][]} */ ([['today', 'Heute'], ['24h', '24 h'], ['7d', '7 Tage'], ['30d', '30 Tage'], ['3m', '3 Monate']]);
const TABS = /** @type {[string,string][]} */ ([['played', '▶ Gespielt'], ['top', '🏆 Top-Songs'], ['series', '📈 Hörer-Verlauf'], ['genres', '🏷 Genre-Mix'], ['live', '🔴 Live-Plays']]);
const CAT_LABEL = /** @type {Record<string,string>} */ ({ music: 'Musik', jingle: 'Jingle', sweeper: 'Sweeper', station_id: 'Sender-ID', ad: 'Werbung', news: 'Nachrichten', voice_track: 'Voice Track', tts: 'KI-Ansage', drop: 'Drop', bed: 'Bett', stream: 'Stream' });

/** @param {number} t @param {'minutes'|'hours'|'days'} step */
function tickLabel(t, step) {
  const d = new Date(t);
  if (step === 'days') return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  if (step === 'hours') return `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${String(d.getHours()).padStart(2, '0')}h`;
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Linien-/Flächendiagramm als SVG. @param {{ at: number, avg: number, peak: number }[]} pts
 * @param {'minutes'|'hours'|'days'} step
 */
export function lineChart(pts, step) {
  const W = 760, H = 200, L = 36, B = 24, T = 10;
  if (pts.length < 2) return h('div', { class: 'empty' }, 'Noch keine Hörerdaten im Zeitraum – sobald ein Ausgang verbunden ist, sammelt AnMaCha Cast alle 30 s die Hörerzahl.');
  const max = Math.max(1, ...pts.map((p) => p.peak));
  const x = (/** @type {number} */ i) => L + (i / (pts.length - 1)) * (W - L - 8);
  const y = (/** @type {number} */ v) => T + (1 - v / max) * (H - T - B);
  const avg = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
  const peak = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.peak).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${y(0)} L${avg.replace(/ /g, ' L')} L${x(pts.length - 1).toFixed(1)},${y(0)} Z`;
  const ticks = [0, Math.round(max / 2), max];
  const n = Math.min(6, pts.length);
  const labels = Array.from({ length: n }, (_, k) => Math.round((k / (n - 1)) * (pts.length - 1)));
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="st-chart" preserveAspectRatio="none" role="img" aria-label="Hörer-Verlauf">
    <defs><linearGradient id="stg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8" stop-opacity=".45"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((v) => `<line x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(56,189,248,.14)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="st-tick">${v}</text>`).join('')}
    <path d="${area}" fill="url(#stg)"/>
    <polyline points="${peak}" fill="none" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/>
    <polyline points="${avg}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    ${labels.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="st-tick">${tickLabel(pts[i].at, step)}</text>`).join('')}
  </svg>`;
  const wrap = h('div', { class: 'st-chart-wrap' });
  wrap.innerHTML = svg;
  wrap.append(h('div', { class: 'muted small' }, h('span', { class: 'st-leg st-leg-avg' }), ' Ø Hörer  ', h('span', { class: 'st-leg st-leg-peak' }), ' Spitze'));
  return wrap;
}

/** Balken „Ø Hörer nach Tageszeit“. @param {(number|null)[]} byHour */
export function hourBars(byHour) {
  const max = Math.max(1, ...byHour.map((v) => v ?? 0));
  if (!byHour.some((v) => v != null)) return null;
  return h('div', { class: 'st-hours' }, ...byHour.map((v, i) => h('div', { class: 'st-hour', title: `${i}:00 – Ø ${v ?? '–'}` },
    h('div', { class: 'st-bar', style: `height:${v == null ? 2 : Math.max(2, Math.round((v / max) * 60))}px${v == null ? ';opacity:.25' : ''}` }),
    h('span', {}, i % 3 === 0 ? String(i) : ''))));
}

/** @typedef {{ api: import('./api.js').Api, url: (p: string) => string, mediaUrl?: (id: string) => string }} Ctx */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountStats(root, ctx) {
  let period = 'today';
  let tab = 'played';
  /** @type {any} */ let S = null;

  async function load() {
    S = await ctx.api.get(ctx.url(`/stats?period=${period}`));
    render();
  }

  const time = (/** @type {number} */ t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function tiles() {
    const k = S.kpis;
    /** @type {[string, string|number, string][]} */
    const list = [
      ['Gespielt', k.played, 'var(--primary)'], ['Hörer jetzt', k.listenersNow, 'var(--green)'], ['Ø Hörer/Song', k.avgPerSong ?? '–', 'var(--cyan)'],
      ['Peak Hörer', k.peak, 'var(--amber)'], ['Live-Plays', k.livePlays, 'var(--red)'], ['Einz. Songs', k.uniqueSongs, 'var(--accent)'],
      ['Std. mit Hörern', k.hoursOnAir, 'var(--primary)'], ['Top Song', k.topSong ? `${k.topSong.artist ? `${k.topSong.artist} – ` : ''}${k.topSong.title}` : '–', 'var(--accent-2)'],
    ];
    return h('div', { class: 'st-tiles' }, ...list.map(([l, v, c], i) => h('div', { class: `ov-stat${i === 7 ? ' st-small' : ''}`, style: `--c:${c}` }, h('span', {}, l), h('strong', {}, String(v)))));
  }

  function body() {
    if (tab === 'played') {
      return S.played.length
        ? h('div', { class: 'st-table' }, ...S.played.map((/** @type {any} */ e) => h('div', { class: 'st-row' },
            h('span', { class: 'muted num' }, time(e.at)), h('span', { class: 'st-title' }, mediaTitle(e)),
            h('span', { class: 'pill' }, CAT_LABEL[e.category] ?? e.category), h('span', { class: 'muted num', title: 'Hörer beim Start' }, e.listeners == null ? '' : `👥 ${e.listeners}`), e.live ? h('span', { class: 'pill failed' }, 'LIVE') : h('span'))))
        : h('div', { class: 'empty' }, 'Im Zeitraum wurde nichts gespielt.');
    }
    if (tab === 'top') {
      return h('div', { class: 'st-cols' },
        h('div', {}, h('h4', {}, 'Top-Songs'), S.topSongs.length ? h('ol', { class: 'st-ol' }, ...S.topSongs.slice(0, 25).map((/** @type {any} */ t) => h('li', {}, h('span', { class: 'st-title' }, mediaTitle(t)), h('span', { class: 'muted num' }, `${t.plays}×${t.avgListeners == null ? '' : ` · Ø ${t.avgListeners}`}`)))) : h('div', { class: 'empty' }, 'Keine Musik im Zeitraum.')),
        h('div', {}, h('h4', {}, 'Top-Interpreten'), S.topArtists.length ? h('ol', { class: 'st-ol' }, ...S.topArtists.map((/** @type {any} */ a) => h('li', {}, h('span', { class: 'st-title' }, a.artist), h('span', { class: 'muted num' }, `${a.plays}×`)))) : h('div', { class: 'empty' }, '–')));
    }
    if (tab === 'series') {
      return h('div', {}, lineChart(S.series, S.seriesStep), hourBars(S.byHour) ? h('div', {}, h('h4', {}, 'Ø Hörer nach Tageszeit'), hourBars(S.byHour)) : null);
    }
    if (tab === 'genres') {
      const max = Math.max(1, ...S.genres.map((/** @type {any} */ g) => g.plays));
      return h('div', { class: 'st-cols' },
        h('div', {}, h('h4', {}, 'Genre-Mix'), S.genres.length ? h('div', { class: 'st-hbars' }, ...S.genres.map((/** @type {any} */ g) => h('div', { class: 'st-hbar' }, h('span', { class: 'st-title' }, g.genre), h('div', { class: 'st-hfill', style: `width:${Math.round((g.plays / max) * 100)}%` }), h('span', { class: 'muted num' }, `${g.plays}×`)))) : h('div', { class: 'empty' }, 'Keine Genres hinterlegt – Genre-Tag in den Tracks pflegen.')),
        h('div', {}, h('h4', {}, 'Kategorien'), h('div', { class: 'st-hbars' }, ...S.categories.map((/** @type {any} */ c) => h('div', { class: 'st-hbar' }, h('span', { class: 'st-title' }, CAT_LABEL[c.category] ?? c.category), h('div', { class: 'st-hfill st-hfill-2', style: `width:${Math.round((c.plays / Math.max(1, S.kpis.played)) * 100)}%` }), h('span', { class: 'muted num' }, `${c.plays}×`))))));
    }
    return S.livePlays.length
      ? h('div', { class: 'st-table' }, ...S.livePlays.map((/** @type {any} */ e) => h('div', { class: 'st-row' }, h('span', { class: 'muted num' }, time(e.at)), h('span', { class: 'st-title' }, mediaTitle(e)), h('span', { class: 'pill' }, CAT_LABEL[e.category] ?? e.category), h('span', { class: 'muted num' }, e.listeners == null ? '' : `👥 ${e.listeners}`), h('span', { class: 'pill failed' }, 'LIVE'))))
      : h('div', { class: 'empty' }, 'Keine Live-Plays im gewählten Zeitraum – Titel, die während einer Live-Sendung liefen, erscheinen hier.');
  }

  function render() {
    root.replaceChildren(
      h('div', { class: 'listener-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'AUSWERTUNG'), h('h1', {}, 'Hörerstatistik'),
          h('p', {}, `Hörerzahlen über alle verbundenen Ausgänge, gespielte Titel und Live-Anteile${S ? ` · ${new Date(S.from).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} – jetzt` : ''}.`)),
        h('div', { class: 'listener-hero-actions st-periods' },
          ...PERIODS.map(([id, l]) => h('button', { class: `btn small${period === id ? ' primary' : ''}`, 'aria-pressed': String(period === id), onclick: () => { period = id; run(load); } }, l)),
          h('button', { class: 'btn small', onclick: () => run(load) }, '⟳'))),
      S ? tiles() : h('div', { class: 'muted' }, 'Lade …'),
      S ? h('section', { class: 'panel st-panel' },
        h('div', { class: 'tabs st-tabs' }, ...TABS.map(([id, l]) => h('button', { 'aria-pressed': String(tab === id), onclick: () => { tab = id; render(); } }, l))),
        body(),
        h('div', { class: 'muted small st-foot' }, 'Berichte und CSV-Export unter „Berichte“; Ausfall- und Stille-Alarme unter „Regeln & Sicherung“.')) : null);
  }

  return { show: () => run(load), onEvent: (/** @type {string} */ t) => { if (t === 'now_playing' && !root.hidden && tab === 'played') run(load); } };
}
