// @ts-check
// Benutzer & Rollen (nur Administratoren): Konten anlegen, Rollen und Sender zuordnen, sperren, Passwort zurücksetzen.
import { clockTime, download, formDialog, h, run, status } from './ui.js';

/** Lesbare Namen der Log-Arten (kind) - alles andere erscheint roh. */
const KINDS = /** @type {Record<string,string>} */ ({
  playout: 'Playout', source: 'Quellen', mode: 'Modus', station: 'Sender', media: 'Medien', upload: 'Upload', item: 'Titel',
  schedule: 'Zeitplan', stream_profile: 'Zusatz-Streams', bridge: 'Anbindung', lautfm: 'laut.fm', nextcloud: 'Nextcloud', musikhub: 'MusikHub',
  collection: 'Sammlungen', network: 'Netzwerk', device: 'Geräte', user: 'Benutzer', setup: 'Einrichtung', system: 'System', ai: 'KI', podcast: 'Podcast',
});

/** @typedef {{ api: import('./api.js').Api, stations: () => any[], me: () => any }} Ctx */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountUsers(root, ctx) {
  /** @type {any[]} */ let roles = [];
  const logFilter = { kind: '', station: '', q: '' };
  const logBody = h('tbody', {});
  const logInfo = h('span', { class: 'muted small' }, '');
  /** @type {any[]} */ let logRows = [];

  /** Aktivitäts-Log (Audit) neu laden - Filter laufen serverseitig, damit auch ältere Einträge gefunden werden. */
  async function loadLog() {
    const p = new URLSearchParams({ limit: '300' });
    if (logFilter.kind) p.set('kind', logFilter.kind);
    if (logFilter.station) p.set('station', logFilter.station);
    if (logFilter.q) p.set('q', logFilter.q);
    logRows = /** @type {any[]} */ (await ctx.api.get(`/audit?${p}`));
    const stationName = (/** @type {string} */ id) => ctx.stations().find((s) => s.id === id)?.name ?? id;
    const details = (/** @type {any} */ e) => Object.entries(e).filter(([k]) => !['at', 'kind', 'event', 'stationId'].includes(k))
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ').slice(0, 300);
    logBody.replaceChildren(...(logRows.length ? logRows.map((e) => h('tr', {},
      h('td', { class: 'num muted' }, `${new Date(e.at).toLocaleDateString('de-DE')} ${clockTime(Date.parse(e.at))}`),
      h('td', {}, h('b', {}, KINDS[e.kind] ?? e.kind), h('div', { class: 'muted small' }, String(e.event ?? ''))),
      h('td', {}, e.stationId ? stationName(e.stationId) : '–'),
      h('td', { class: 'muted small', style: 'overflow-wrap:anywhere' }, details(e))))
      : [h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'Keine Einträge für diesen Filter.'))]));
    logInfo.textContent = `${logRows.length} Einträge${logRows.length >= 300 ? ' (die neuesten 300)' : ''}`;
  }

  function logCard() {
    const kinds = Object.entries(KINDS).sort((a, b) => a[1].localeCompare(b[1], 'de'));
    const sel = (/** @type {string} */ aria, /** @type {[string,string][]} */ opts, /** @type {string} */ val, /** @type {(v: string) => void} */ on) =>
      h('select', { 'aria-label': aria, onchange: (/** @type {Event} */ e) => { on(/** @type {HTMLSelectElement} */ (e.target).value); run(loadLog); } }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let t;
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Aktivitäts-Log'),
        h('div', { class: 'row' }, logInfo,
          h('button', { class: 'btn small', title: 'Neu laden', onclick: () => run(loadLog) }, '↻'),
          h('button', { class: 'btn small', title: 'Gefilterte Einträge als CSV', onclick: () => {
            const esc = (/** @type {unknown} */ v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const csv = ['Zeit;Art;Ereignis;Sender;Details', ...logRows.map((e) => [e.at, e.kind, e.event, e.stationId ?? '', JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['at', 'kind', 'event', 'stationId'].includes(k))))].map(esc).join(';'))].join('\r\n');
            download(new Blob(['\ufeff' + csv], { type: 'text/csv' }), `aktivitaets-log-${new Date().toISOString().slice(0, 10)}.csv`);
          } }, '⬇ CSV'))),
      h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Wer hat wann was ausgelöst: Playout, Quellen, Zeitplan, Uploads, Benutzer, KI. Wird als audit.log im Datenordner fortgeschrieben.'),
      h('div', { class: 'row', style: 'margin-bottom:8px;flex-wrap:wrap' },
        sel('Art', [['', 'Alle Arten'], ...kinds], logFilter.kind, (v) => { logFilter.kind = v; }),
        sel('Sender', [['', 'Alle Sender'], ...ctx.stations().map((s) => /** @type {[string,string]} */ ([s.id, s.name]))], logFilter.station, (v) => { logFilter.station = v; }),
        h('input', { type: 'search', style: 'min-width:260px;flex:1', placeholder: 'Suchen (Ereignis, Datei, Benutzer …)', value: logFilter.q, oninput: (/** @type {Event} */ e) => { logFilter.q = /** @type {HTMLInputElement} */ (e.target).value.trim(); clearTimeout(t); t = setTimeout(() => run(loadLog), 300); } })),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Art'), h('th', {}, 'Sender'), h('th', {}, 'Details'))), logBody)));
  }

  async function show() {
    const d = await ctx.api.get('/users');
    roles = d.roles;
    const label = (/** @type {string} */ r) => roles.find((x) => x.id === r)?.label ?? r;
    const stationName = (/** @type {string} */ id) => (id === '*' ? 'alle Sender' : ctx.stations().find((s) => s.id === id)?.name ?? id);
    root.replaceChildren(
      h('div', { class: 'admin-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'VERWALTUNG'), h('h1', {}, 'Benutzer & Rollen'), h('p', {}, 'Zugänge, Rollen und Senderrechte zentral verwalten.')),
        h('div', { class: 'admin-hero-actions' },
          h('span', { class: 'admin-count' }, `${d.users.length} Konten`),
          h('button', { class: 'btn small primary', onclick: () => edit(null) }, '＋ Benutzer'))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Rollen')),
        ...roles.map((r) => h('div', { class: 'kv' }, h('span', {}, h('b', {}, r.label)), h('span', { class: 'muted small' }, r.scopes.includes('*') ? 'alle Rechte, Benutzer, Einstellungen' : r.scopes.filter((/** @type {string} */ s) => s.endsWith(':write') || s.endsWith(':trigger')).map((/** @type {string} */ s) => s.split(':')[0]).join(', ') || 'nur lesen'))),
        h('p', { class: 'muted' }, 'laut.fm-Sender melden sich automatisch über das Radioadmin-Token an. Für die App und Integrationen gibt es zusätzlich Verbindungslinks bzw. API-Tokens.')),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Konten')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Benutzer'), h('th', {}, 'Rollen'), h('th', {}, 'Sender'), h('th', {}, 'Letzte Anmeldung'), h('th', {}))),
          h('tbody', {}, ...d.users.map((/** @type {any} */ u) => h('tr', {},
            h('td', {}, h('b', {}, u.name), h('div', { class: 'muted small' }, `@${u.username}${u.disabled ? ' · gesperrt' : ''}${u.mustChangePassword ? ' · Passwort muss geändert werden' : ''}`)),
            h('td', {}, u.roles.map(label).join(', ')),
            h('td', {}, u.stationIds.map(stationName).join(', ')),
            h('td', { class: 'num muted' }, u.lastLoginAt ? `${new Date(u.lastLoginAt).toLocaleDateString('de-DE')} ${clockTime(Date.parse(u.lastLoginAt))}` : '–'),
            h('td', { class: 'act' }, h('button', { class: 'btn small', onclick: () => edit(u) }, 'Bearbeiten')))))))),
      siteCard(await ctx.api.get('/site')),
      logCard(),
    );
    run(loadLog);
  }

  /** Ankündigungs-Banner (alle Studio-Nutzer + öffentliche Seiten) und Wartungsmeldung. @param {any} site */
  function siteCard(site) {
    const s = site.settings ?? { banner: {}, maintenance: {} };
    const KIND = /** @type {Record<string,string>} */ ({ info: 'Info (blau)', success: 'Erfolg (grün)', warning: 'Hinweis (orange)', danger: 'Wichtig (rot)' });
    const toLocal = (/** @type {string|undefined} */ iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Ankündigung & Wartung'),
        h('button', { class: 'btn small', onclick: async () => {
          const v = await formDialog('Ankündigung & Wartung', [
            { type: 'section', label: 'Ankündigungs-Banner', hint: 'Oben im Studio für alle Angemeldeten und auf den öffentlichen Seiten' },
            { name: 'bEnabled', label: 'Banner anzeigen', type: 'checkbox', value: !!s.banner.enabled },
            { name: 'bText', label: 'Text', value: s.banner.text ?? '', hint: 'bis 300 Zeichen' },
            { name: 'bKind', label: 'Art', value: s.banner.kind ?? 'info', options: Object.entries(KIND).map(([k, l]) => /** @type {[string,string]} */ ([k, l])) },
            { name: 'bUntil', label: 'Ablaufdatum (optional)', type: 'datetime-local', value: toLocal(s.banner.until), hint: 'Danach verschwindet der Banner von selbst' },
            { name: 'bDismiss', label: 'Besucher können den Banner schließen (bis zur nächsten Sitzung)', type: 'checkbox', value: s.banner.dismissible !== false },
            { type: 'section', label: 'Wartungsmeldung', hint: 'Roter Balken, nicht schließbar - z. B. vor einem Server-Umzug' },
            { name: 'mEnabled', label: 'Wartungshinweis anzeigen', type: 'checkbox', value: !!s.maintenance.enabled },
            { name: 'mText', label: 'Text', value: s.maintenance.text ?? '' },
          ], 'Speichern');
          if (!v) return;
          await run(async () => {
            await ctx.api.put('/site', { banner: { enabled: v.bEnabled, text: v.bText, kind: v.bKind, until: v.bUntil ? new Date(v.bUntil).toISOString() : '', dismissible: v.bDismiss }, maintenance: { enabled: v.mEnabled, text: v.mText } });
            status('Gespeichert - gilt sofort für alle');
            show();
          });
        } }, '✎ Bearbeiten')),
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Banner'), h('span', {}, s.banner.enabled && s.banner.text ? `${KIND[s.banner.kind] ?? s.banner.kind}: „${s.banner.text}“${s.banner.until ? ` · bis ${new Date(s.banner.until).toLocaleString('de-DE')}` : ''}` : 'aus')),
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Wartung'), h('span', {}, s.maintenance.enabled && s.maintenance.text ? `an: „${s.maintenance.text}“` : 'aus')));
  }

  /** @param {any} u */
  async function edit(u) {
    const stations = ctx.stations();
    const all = !u || u.stationIds.includes('*');
    const v = await formDialog(u ? `Benutzer: ${u.name}` : 'Neuer Benutzer', [
      ...(u ? [] : [{ name: 'username', label: 'Benutzername (Anmeldename)', value: '', required: true, hint: 'a–z, 0–9, Punkt, Minus, Unterstrich' }]),
      { name: 'name', label: 'Anzeigename', value: u?.name ?? '' },
      ...roles.map((r) => ({ name: `role_${r.id}`, label: `Rolle: ${r.label}`, type: 'checkbox', value: u ? u.roles.includes(r.id) : r.id === 'dj' })),
      { name: 'allStations', label: 'Zugriff auf alle Sender', type: 'checkbox', value: all },
      ...stations.map((s) => ({ name: `st_${s.id}`, label: `Sender: ${s.name}`, type: 'checkbox', value: !all && u?.stationIds.includes(s.id) })),
      { name: 'password', label: u ? 'Neues Passwort (leer = unverändert)' : 'Einmal-Passwort', type: 'password', value: '', required: !u, hint: 'Mind. 10 Zeichen. Bei der ersten Anmeldung wird ein eigenes Passwort verlangt.' },
      ...(u ? [
        { name: 'disabled', label: 'Konto sperren (beendet alle Sitzungen)', type: 'checkbox', value: !!u.disabled },
        ...(u.id !== ctx.me()?.user?.id ? [{ name: 'remove', label: 'Benutzer löschen', type: 'checkbox', value: false }] : []),
      ] : []),
    ], u ? 'Speichern' : 'Anlegen');
    if (!v) return;
    if (v.remove) {
      if (!confirm(`Benutzer „${u.name}“ endgültig löschen?`)) return;
      await run(() => ctx.api.del(`/users/${u.id}`));
      return run(show);
    }
    const body = {
      name: v.name,
      roles: roles.filter((r) => v[`role_${r.id}`]).map((r) => r.id),
      stationIds: v.allStations ? ['*'] : stations.filter((s) => v[`st_${s.id}`]).map((s) => s.id),
      ...(v.password ? { password: v.password, mustChangePassword: true } : {}),
      ...(u ? { disabled: v.disabled } : { username: v.username }),
    };
    if (!body.stationIds.length) return status('Mindestens einen Sender oder „alle Sender“ wählen', true);
    const r = await run(() => (u ? ctx.api.patch(`/users/${u.id}`, body) : ctx.api.post('/users', body)));
    if (r) status(u ? 'Benutzer gespeichert' : `Benutzer „${r.username}“ angelegt – Anmeldung mit dem Einmal-Passwort`);
    run(show);
  }

  return { show: () => run(show) };
}
