// @ts-check
// Öffentliche Seiten ohne Login: Senderseite (sender.html), Sendeplan (sendeplan.html), Charts (charts.html),
// Netzwerk (netzwerk.html). Daten aus /api/v1/public/… (CORS offen), Seite per data-page im <body> gewählt.
// URL-Parameter: ?station=<id> · theme=light · accent=38bdf8 (Hex ohne #).
(() => {
  const q = new URLSearchParams(location.search);
  const station = (q.get('station') ?? 'main').replace(/[^a-z0-9-]/gi, '');
  if (q.get('theme') === 'light') document.documentElement.classList.add('light');
  const accent = (q.get('accent') ?? '').replace(/[^0-9a-f]/gi, '');
  if (accent.length === 6 || accent.length === 3) document.documentElement.style.setProperty('--accent', `#${accent}`);
  const page = document.body.dataset.page ?? 'sender';
  const root = /** @type {HTMLElement} */ (document.getElementById('app'));
  const link = (/** @type {string} */ p) => `${p}?station=${encodeURIComponent(station)}${q.get('theme') ? `&theme=${q.get('theme')}` : ''}${accent ? `&accent=${accent}` : ''}`;

  /** @param {string} tag @param {Record<string, any>} [attrs] @param {...(Node|string|null|undefined|false)} children */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else el.setAttribute(k, String(v));
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }
  const initials = (/** @type {string} */ n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const logo = (/** @type {any} */ s, /** @type {string} */ cls) => h('div', { class: cls, style: s.logo ? `background-image:url(${s.logo.replace(/^\//, '')})` : '' }, s.logo ? '' : initials(s.name));
  const foot = () => h('div', { class: 'foot' },
    h('a', { href: link('sender.html') }, 'Sender'), '·', h('a', { href: link('sendeplan.html') }, 'Sendeplan'), '·', h('a', { href: link('charts.html') }, 'Charts'), '·', h('a', { href: 'netzwerk.html' }, 'Netzwerk'), '·', h('a', { href: 'status.html' }, 'Stream-Status'),
    h('div', {}, 'Powered by AnMaCha Cast'));
  const fail = (/** @type {string} */ m) => root.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'card empty' }, m), foot()));
  // Ankündigungs-Banner / Wartungsmeldung (Admin → Ankündigung & Wartung) oben auf jeder öffentlichen Seite
  const siteBars = () => fetch('api/v1/public/site').then((r) => r.json()).then((site) => {
    const bars = [];
    if (site?.maintenance) bars.push(h('div', { class: 'site-bar maintenance', role: 'alert' }, `🛠 ${site.maintenance.text}`));
    const b = site?.banner;
    const key = b ? `site-banner:${b.text}` : '';
    if (b && !(b.dismissible && sessionStorage.getItem(key))) {
      const bar = h('div', { class: `site-bar ${b.kind}` }, h('span', {}, b.text), b.dismissible ? h('button', { class: 'site-close', title: 'Schließen', onclick: () => { sessionStorage.setItem(key, '1'); bar.remove(); } }, '✕') : null);
      bars.push(bar);
    }
    document.querySelectorAll('body > .site-bar').forEach((el) => el.remove()); // abgelaufene/zurückgezogene Meldungen verschwinden
    if (bars.length) document.body.prepend(...bars);
  }).catch(() => {});
  siteBars();
  setInterval(siteBars, 60_000);
  const LINK_LABEL = /** @type {Record<string, string>} */ ({ website: 'Webseite', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', mastodon: 'Mastodon', threads: 'Threads' });
  const LINK_HOST = /** @type {Record<string, string>} */ ({ instagram: 'https://instagram.com/', facebook: 'https://facebook.com/', youtube: 'https://youtube.com/@', tiktok: 'https://tiktok.com/@', x: 'https://x.com/', threads: 'https://threads.net/@' });
  /** „@name“ → Profil-URL des Dienstes; Mastodon „@name@instanz“ → https://instanz/@name; sonst nur https?:// */
  const linkHref = (/** @type {string} */ k, /** @type {string} */ v) => {
    if (/^https?:\/\//i.test(v)) return v;
    if (!v.startsWith('@')) return null;
    if (k === 'mastodon') { const m = v.match(/^@([^@]+)@([^@/]+)$/); return m ? `https://${m[2]}/@${m[1]}` : null; }
    return LINK_HOST[k] ? LINK_HOST[k] + v.slice(1) : null;
  };
  const teamCard = (/** @type {{ name: string, links: Record<string, string> }[]} */ team) => team?.length ? h('div', { class: 'card' }, h('h2', {}, '🎙 Team'),
    ...team.map((m) => h('div', { class: 'row team' }, h('span', {}, m.name), h('span', { class: 'links' }, ...Object.entries(m.links).map(([k, v]) => { const href = linkHref(k, v); return href ? h('a', { href, target: '_blank', rel: 'noopener me' }, LINK_LABEL[k] ?? k) : h('span', { class: 'muted small' }, `${LINK_LABEL[k] ?? k}: ${v}`); }))))) : null;
  /** @type {HTMLAudioElement|null} */ let audio = null;
  function playBtn(/** @type {string|null} */ url) {
    const b = /** @type {HTMLButtonElement} */ (h('button', { class: 'play', title: 'Abspielen', disabled: !url }, '▶'));
    b.addEventListener('click', () => {
      if (!url) return;
      if (audio && !audio.paused) { audio.pause(); audio.removeAttribute('src'); audio = null; b.textContent = '▶'; return; }
      audio = new Audio(url);
      audio.play().then(() => { b.textContent = '⏸'; }).catch(() => { b.textContent = '▶'; });
    });
    return b;
  }
  async function get(/** @type {string} */ p) {
    const r = await fetch(`api/v1/public/${p}`, { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`);
    return r.json();
  }

  async function sender() {
    const d = await get(`stations/${station}/page`);
    const src = d.status.icestats?.source?.[0];
    const now = d.status.now;
    document.title = `${d.station.name} · Senderseite`;
    root.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'hero' }, logo(d.station, 'logo'),
        h('div', {}, h('span', { class: 'kicker' }, 'Radio'), h('h1', {}, d.station.name), d.station.slogan ? h('div', { class: 'tag' }, d.station.slogan) : null, d.station.genre ? h('span', { class: 'genre' }, d.station.genre) : null),
        h('span', { class: `badge${src ? ' on' : ''}` }, h('span', { class: 'dot' }), src ? `On Air · ${d.status.icestats.source.reduce((/** @type {number} */ a, /** @type {any} */ x) => a + (x.listeners ?? 0), 0)} Hörer` : 'Offline')),
      h('div', { class: 'live' }, h('div', { class: 'cover', style: now?.cover ? `background-image:url(${String(now.cover).replace(/^\//, '')})` : '' }, now?.cover ? '' : '♪'),
        h('div', {}, h('div', { class: 'small muted' }, d.current ? `Jetzt: ${d.current.label} (${d.current.from}–${d.current.to})` : 'Jetzt läuft'), h('div', { class: 't' }, now?.title || (src ? src.title : 'Gerade offline')), h('div', { class: 'a' }, now?.artist ?? '')),
        playBtn(src?.listenurl ?? null)),
      h('div', { class: 'grid' },
        h('div', { class: 'card' }, h('h2', {}, '📅 Heute im Programm'), ...(d.today.length ? d.today.map((/** @type {any} */ s) => h('div', { class: `row${s.now ? ' now' : ''}` }, h('span', {}, s.label), h('span', { class: 'muted' }, `${s.from}–${s.to}`))) : [h('div', { class: 'empty' }, 'Durchgehend Musik – ohne feste Sendungen.')]), h('a', { class: 'btn', href: link('sendeplan.html'), style: 'display:inline-block;margin-top:10px' }, 'Ganzer Sendeplan')),
        h('div', { class: 'card' }, h('h2', {}, '🏆 Top 5 der Woche'), ...(d.charts.length ? d.charts.map((/** @type {any} */ c) => h('div', { class: 'rank' }, h('b', { class: 'n' }, String(c.rank)), h('div', { class: 'cv', style: c.cover ? `background-image:url(${c.cover.replace(/^\//, '')})` : '' }), h('div', {}, h('div', { class: 't' }, c.title), h('div', { class: 'muted small' }, c.artist)), h('span', { class: 'muted small' }, `${c.plays}×`))) : [h('div', { class: 'empty' }, 'Noch keine Charts.')]), h('a', { class: 'btn', href: link('charts.html'), style: 'display:inline-block;margin-top:10px' }, 'Alle Charts')),
        h('div', { class: 'card' }, h('h2', {}, '🎧 Hören'),
          src ? h('div', {}, h('div', { class: 'row' }, h('span', {}, 'Stream'), h('a', { href: src.listenurl, target: '_blank', rel: 'noopener' }, 'Direkt-Stream')), h('div', { class: 'row' }, h('span', {}, 'Playlist'), h('a', { href: `status/${station}.m3u` }, 'M3U'), h('a', { href: `status/${station}.xspf` }, 'XSPF'))) : h('div', { class: 'empty' }, 'Gerade kein Stream verbunden.'),
          d.podcast ? h('div', { class: 'row' }, h('span', {}, `Podcast (${d.podcast.episodes} Folgen)`), h('a', { href: d.podcast.feed.replace(/^\//, '') }, 'RSS-Feed')) : null,
          h('div', { class: 'row' }, h('span', {}, 'Letzte Titel'), h('span', { class: 'muted small' }, (d.status.last_songs ?? []).slice(1, 4).map((/** @type {any} */ x) => `${x.artist ? `${x.artist} – ` : ''}${x.title}`).join(' · ') || '–'))),
        teamCard(d.team)),
      foot()));
  }

  async function sendeplan() {
    const d = await get(`stations/${station}/schedule`);
    const today = (new Date().getDay() + 6) % 7;
    document.title = `${d.station.name} · Sendeplan`;
    root.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'hero' }, logo(d.station, 'logo'), h('div', {}, h('span', { class: 'kicker' }, 'Sendeplan'), h('h1', {}, d.station.name), h('div', { class: 'tag' }, d.current ? `Jetzt: ${d.current.label} (${d.current.from}–${d.current.to})` : 'Gerade läuft Musik ohne feste Sendung.')),
        h('a', { class: 'btn', href: link('sender.html') }, 'Zur Senderseite')),
      h('div', { class: 'week' }, ...d.days.map((/** @type {any} */ day) => h('div', { class: `day${day.day === today ? ' today' : ''}` }, h('h3', {}, day.label),
        ...(day.shows.length ? day.shows.map((/** @type {any} */ s) => h('div', { class: `show${s.now ? ' now' : ''}` }, s.label, h('span', {}, `${s.from}–${s.to}`))) : [h('div', { class: 'muted small' }, 'Musik nonstop')])))),
      foot()));
  }

  async function charts() {
    let period = q.get('period') ?? '7d';
    const draw = async () => {
      const d = await get(`stations/${station}/charts?period=${period}`);
      document.title = `${d.station.name} · Charts`;
      root.replaceChildren(h('div', { class: 'wrap' },
        h('div', { class: 'hero' }, logo(d.station, 'logo'), h('div', {}, h('span', { class: 'kicker' }, 'Charts'), h('h1', {}, `🏆 ${d.station.name}`), h('div', { class: 'tag' }, 'Die meistgespielten Titel – automatisch aus dem Programm.')), h('a', { class: 'btn', href: link('sender.html') }, 'Zur Senderseite')),
        h('div', { class: 'chips' }, ...[['today', 'Heute'], ['7d', '7 Tage'], ['30d', '30 Tage']].map(([id, l]) => h('button', { class: `chip${period === id ? ' on' : ''}`, onclick: () => { period = id; draw(); } }, l))),
        h('div', { class: 'card' }, ...(d.items.length ? d.items.map((/** @type {any} */ c) => h('div', { class: 'rank' }, h('b', { class: 'n' }, String(c.rank)), h('div', { class: 'cv', style: c.cover ? `background-image:url(${c.cover.replace(/^\//, '')})` : '' }), h('div', {}, h('div', { class: 't' }, c.title), h('div', { class: 'muted small' }, c.artist)), h('span', { class: 'muted small' }, `${c.plays}×`))) : [h('div', { class: 'empty' }, 'Noch keine Einsätze im Zeitraum.')])),
        foot()));
    };
    await draw();
  }

  async function netzwerk() {
    const d = await get('network');
    document.title = 'AnMaCha Cast · Netzwerk';
    const list = /** @type {any[]} */ (d.stations);
    const grid = h('div', { class: 'net' });
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'search', placeholder: 'Sender oder Genre suchen …' }));
    const draw = () => {
      const needle = input.value.trim().toLowerCase();
      const rows = list.filter((s) => !needle || `${s.name} ${s.genre} ${s.slogan}`.toLowerCase().includes(needle));
      grid.replaceChildren(...(rows.length ? rows.map((s) => h('div', { class: 'st' },
        h('div', { class: 'head' }, logo(s, 'logo'), h('div', {}, h('div', { class: 'name' }, s.name), h('div', { class: 'muted small' }, s.genre || s.slogan || ''))),
        h('span', { class: `badge${s.onAir ? ' on' : ''}` }, h('span', { class: 'dot' }), s.onAir ? `On Air · ${s.listeners} Hörer` : 'Offline'),
        h('div', { class: 'small' }, s.now ? `${s.now.artist ? `${s.now.artist} – ` : ''}${s.now.title}` : h('span', { class: 'muted' }, 'Kein Titel gemeldet')),
        h('div', { class: 'btns' }, h('a', { class: 'btn primary', href: `sender.html?station=${encodeURIComponent(s.id)}` }, 'Senderseite'), s.listenUrl ? h('a', { class: 'btn', href: s.listenUrl, target: '_blank', rel: 'noopener' }, '▶ Stream') : null))) : [h('div', { class: 'empty' }, 'Kein Sender gefunden.')]));
    };
    input.addEventListener('input', draw);
    draw();
    root.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'hero' }, h('div', { class: 'logo' }, '📡'), h('div', {}, h('span', { class: 'kicker' }, 'Netzwerk'), h('h1', {}, 'Alle Sender'), h('div', { class: 'tag' }, `${list.length} Sender auf dieser AnMaCha Cast-Instanz – live sortiert nach Hörern.`))),
      input, grid, foot()));
  }

  const run = { sender, sendeplan, charts, netzwerk }[page] ?? sender;
  run().catch((e) => fail(e.message || 'Seite nicht verfügbar'));
  if (page === 'sender' || page === 'netzwerk') setInterval(() => run().catch(() => {}), 20_000);
})();
