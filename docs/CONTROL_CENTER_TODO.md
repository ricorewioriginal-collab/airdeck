# Was aus dem AnMaCha Control Center noch in AnMaCha Cast fehlt

Stand: 2026-10-02. Grundlage: seitenweise Auswertung aller 51 HTML-Seiten des Repos
`anmacha_control_center` (live: control.ricorewi-radio.de) gegen den tatsächlichen Cast-Code
(`studio/js/*.js`, `studio/index.html`, `src/server/services/*.ts`) - nicht gegen `FEATURE_PARITY.md`,
das an mehreren Stellen hinterherhängt (Lifehacks, 16 Algorithmen, Stille-Alarm, Voicetrack,
Podcast-Feed und Motion-Mix sind längst vorhanden).

Diese Datei ist die **einzige offene Arbeitsliste** für die Angleichung an das Control Center.
Erledigtes wird hier gestrichen, nicht umkopiert.

## Bewusst nicht übernommen

- **ViewPush** (`viewpush/index.php`, `cron.php`): erzeugt künstliche Hörerzahlen (IP-Spoofing,
  Proxys, User-Agent-Rotation). Statistik-Manipulation - wird nicht portiert.
- Castopod-/Owncast-/OIDC-SSO-Plumbing, `golive-relay`-Serverteile, `login.html`-Infrastruktur.
- `airdeck.html`: Cast **ist** die AirDeck-Anbindung, die Brücke ist bereits ersetzt.

## Bereits deckungsgleich (keine Arbeit)

Sendezentrale, Sendeplan (Wochenraster, Drag & Drop), Sendeuhr (Minuten-Events + Vorlage),
Playlisten + 9 Lifehacks, Track-Bibliothek, Bibliothek-Werkzeuge, Aufnahmen, Regeln & Sicherung
(Interpretensperre, Notfall-Programm, Ausfall-Alarm, Sicherung), Protokoll, Benutzer, Handbuch,
Musikwunsch/Wunschbox/Sprachnachricht/Voting/Studiomail (Hörer-Seite + Posteingang), On-Air-Widget,
**Jingles & IDs** (Ordnerkarten mit "alle N Songs" + Sendeuhr-Minuten - seit PR #88).

## Offen - nach Sidebar-Gruppen, P1 vor P2 vor P3, S/M/L = Aufwand

### Überblick
1. ~~[P1 · S] `data-sub`-Navigation verdrahten~~ - erledigt: Unterpunkte springen zum Abschnitt
   (data-sub-Element oder Panel-Überschrift) und heben ihn kurz hervor.
2. ~~[P2 · M] Sendezentrale: Netzwerk-Senderkarten mit Sortierung Live (Meiste/Wenigste), Ø 24h, Ø 7 Tage, A–Z; Sync~~ -
   erledigt: `GET /network` liefert je sichtbarem Sender Live/Ø 24h/Ø 7 Tage (Stichproben + Stunden-Aggregat), Karten
   zeigen die Zahlen, Sortierleiste (gemerkt), „⟳ Sync“ mit Zeitstempel.

### Programm planen
3. ~~[P1 · M] Nachrichten & Wetter (laut.fm)~~ - erledigt: eigene Ansicht (`studio/js/news.js`,
   `services/news.ts`): Zugang aus dem laut.fm-Ausgang, drei Beiträge anhören/herunterladen/„Jetzt senden“,
   Stunden-Chip-Raster 00–23 (alle / 6–22 / keine) + Tage, Schnellpresets, Zeitplan-Liste als Uhr-Events
   `kind: news` (Datei wird zur Startzeit frisch geholt). Offen: „Automatisch verbinden, wenn der Relay
   gerade nicht sendet“ (braucht laut.fm-Titelende-Abfrage; P3).
4. ~~[P1 · L] Smart Blocks & Rotation~~ - erledigt: Regel-Editor (Feld/Vergleich/Wert, alle/mindestens eine,
   Reihenfolge, Begrenzen auf N Titel/Minuten, Elemente einbeziehen), Vorschau, dynamische Playlist (⚡, bei
   jedem Durchlauf frisch) vs. Momentaufnahme; „Allgemeine Rotation“ = Playlisten nach Gewicht, wenn der
   Sendeplan nichts vorgibt (`/smart-blocks`, `/rotation-pool`, `src/core/smartblocks.ts`).
5. ~~[P2 · S] Ereignisse: Typen KI-Ansage und Nachrichten-/Werbe-Trigger, "Jetzt beenden"~~ - erledigt: Zeitplan/Stunden-Uhr
   kennen Kategorie (z. B. Werbung), laut.fm-Nachrichten und KI-Ansage (`kind: ai`, Moderation oder KI-Nachrichten über den
   Regisseur), Dialog zeigt nur die Felder der gewählten Art, „⏭ Jetzt beenden“ im Zeitplan, Preflight prüft alle Arten.

### KI & Automatik
8. ~~[P2 · M] News-Zentrale (Show-Prep): Feed-/Artikelwahl, Wetter-Block, KI-Vorschlag, Teleprompter~~ - erledigt: eigene
   Ansicht (`studio/js/showprep.js`, `services/showprep.ts`): Standard-Feeds nach Kategorie + eigene, Artikel serverseitig
   geholt (Cache), Auswahl per Haken → KI-Moderationsnotizen, Wetter-Block (Open-Meteo, sprechbarer Text), Leseansicht mit
   Teleprompter (Größe, Serif, Tempo, Pause).
9. ~~[P2 · M] Sendeablauf-Planer als Maske mit Drag-&-Drop-Tabelle und Export~~ - erledigt (KI-Werkstatt → Sendeablauf-Planer:
   Zeilen per Drag & Drop, Zeile hinzufügen, CSV-Export, Drucken).
7. ~~[P2 · M] KI-Studio-Tab wie `relay-pro6`: Ansage-Typen als Knöpfe, Meldungen zusammenfassen,
   Playlist per KI erstellen/neu ordnen, geplante KI-Ansagen mit Wochentagen~~ - erledigt: KI-Werkstatt → „KI-Studio“
   (8 Ansage-Typen, Ton, Länge, Text → Vertonen → Bibliothek → als Nächstes/sofort senden), „KI-Playlist“ (erstellen,
   neu ordnen/ergänzen, nur Bibliotheks-IDs, Liste mit ↑↓✕ und Speichern/Ersetzen), „Automatische KI-Ansagen“ (Uhr-Events
   Art „KI-Ansage“ mit Wochentagen, ▶ Jetzt).

### Musik & Inhalte
10. ~~[P1 · M] Cardwall → Soundboard~~ - erledigt: Tags (Filter-Chips) + Suche, Favoriten, Zuletzt gespielt,
    Tastenkürzel je Cart (eindeutig je Sender), Show-Modus (Vollbild mit großen Carts), Esc/„Alle stoppen“
    blendet alle Carts aus (`POST /playout/carts-stop`, auch Browser-Wiedergabe).
11. ~~[P2 · M] Track-TÜV: Tonart-Analyse, Online-Tag-/Cover-Suche, Vorher/Nachher-Export~~ - erledigt: Tonart (Krumhansl-
    Schmuckler, Camelot) im Track-Check für Musik und einzeln (♪), Online-Suche iTunes + MusicBrainz mit Cover-Download (🔎),
    Panel „Track-TÜV“ in „Tracks“ mit Vorher/Nachher-Bericht (LUFS/True Peak gemessen → nach Angleichung, Gain, Limiter,
    Tonart, Hinweise) als CSV.
12. ~~[P2 · M] Podcasts: Auto-Veröffentlichung nach Aufnahme mit Titel-/Beschreibungs-Vorlagen~~ - erledigt: Podcast-Einstellungen
    → „Automatisch veröffentlichen“ (Vorlagen mit {label} {date} {time} {weekday} {duration} {station} {n}, Mindestdauer,
    nur Zeitfenster, sofort/Entwurf, fortlaufende Nummer); offen: [P3 · M] Podcast-Hörer (Suche, Charts, Abos).
13. ~~[P3 · M] Media & Jingle Exchange: Netzwerk-Sichtbarkeit, Dokumente/Logos (an MusikHub andocken)~~ - erledigt im MusikHub: Freigabe-Empfänger „🌐 Netzwerk: alle Sender“ (Grant an `station:*`, gilt in jedem Senderkontext für ausdrücklich zugeordnete Nutzer, nur durch den Eigentümer), Uploads auch für Logos/Bilder (png, jpg, webp, gif, svg) und Dokumente (pdf, txt, md, docx, xlsx, zip) mit Art-Badge und Bildvorschau - Bilder/Dokumente lassen sich teilen und herunterladen, aber nie bereitstellen oder senden.
14. [P3 · L] Voice Studio: Wellenform-Schnitt, Musikbett-Mischer, Rauschentfernung; Stimm-Klonen nur mit lokaler Engine.
15. ~~[P3 · L] Transkription (Whisper lokal, Export TXT/SRT/VTT/JSON)~~ - erledigt: KI-Werkstatt → Transkription (lokales whisper hat Vorrang, sonst OpenAI-kompatibler Provider), Export TXT/SRT/VTT/JSON, Zusammenfassung per KI. Musik-Studio (Suno) bewusst nicht enthalten (siehe 32).

### Sender & Ausspielung
16. ~~[P1 · M] Sendereinstellungen: Überblend-Profile, Kurve, Fade-Out beim Stoppen, Sendungsende-Fade~~ - erledigt:
    7 Profile (Standard, weich, knackig, Club, Talk & News, Ambient, Nahtlos) + eigene Werte, Kurve
    linear / Equal-Power / S in der Engine, getrennte Zeiten für Deck-Stopp, Skip, Sendungsende und
    Jingles/IDs/Spots, Kurztitel-Regel; `POST /playout/stop` blendet jetzt aus statt hart zu schneiden.
    Offen bleibt nur die grafische Kurvenvorschau (P3 · S).
17. ~~[P1 · M] Regeln & Sicherung: Einschübe-Liste "nach N Songs aus Ordner"~~ - erledigt: Regel-Editor im
    Rotation-Panel (Bezeichnung, Ordner, alle N Songs, an/aus), Fülllogik in `fillFromClock` mit Zähler je Regel.
18. ~~[P2 · M] Sound & Stimme~~ - erledigt: Master-Presets Neutral/Radio/Musik/Warm/Hell/Laut & dicht/Sprache/
    Klassik, Bass/Höhen (dB), Stereo-Breite (%), Auto-Gain; Mikrofon-Kette Gate → Trittschall → Sprach-EQ
    (Klar/Warm/Radio) → De-Esser → Kompressor (`mic` in der Playout-Konfiguration, ffmpeg-Filter am Eingang).
19. [P2 · L] Verbreitung: ~~bis zu 2 eigene Mount-Streams mit Bitrate~~ (erledigt: Karte "Eigene Streams" in Streams & Anbindungen, `/own-streams`, Profil + Ausgang in einem Schritt, Link kopieren), **offen** SFTP-Eingang (braucht einen sshd-Dienst) und Video-Radiostream (Visualizer, RTMP).
20. [P3 · L] Decks erweitert: Loop, Tempo, Wellenform-Springen.

### Auswertung
21. ~~[P1 · L] Hörerstatistik~~ - erledigt: Ansicht `studio/js/stats.js` + `services/stats.ts` (GET `/stats?period=`):
    Chips Heute/24 h/7 Tage/30 Tage/3 Monate, 8 Kacheln (Gespielt, Hörer jetzt, Ø Hörer/Song, Peak, Live-Plays,
    einz. Songs, Std. mit Hörern, Top Song), Untertabs Gespielt / Top-Songs / Hörer-Verlauf (SVG, Ø + Spitze,
    nach Tageszeit) / Genre-Mix / Live-Plays. Backend: Play-Log trägt Hörerzahl + Live-Kennung (Kappe 5000),
    Stunden-Aggregat `listenerHours` über 100 Tage. Bewusst weggelassen: Rang (laut.fm-spezifisch) und
    DB-Abgleich (externe laut.fm-Datenbank).
22. ~~[P2 · L] Deep Stats: Heatmap Wochentag×Uhrzeit, Top/Flop, Artist-Anteile, Song-Verlauf, Excel/PDF/Mail~~ - erledigt:
    Hörerstatistik → Tabs Heatmap, Top/Flop (mit Vorperiode gleicher Länge), Interpreten (Donut + Anteile), Song-Verlauf
    (Top 5 je Tag); Export ⬇ Excel (CSV), 🖨 PDF (Druckansicht), ✉ Mail (`/stats/deep`, `/stats/deep.csv`, `/stats/deep/email`).
23. ~~[P2 · S] Berichte: Meistgespielt-Ranking; Protokoll-Filter~~ - erledigt: Sendungs-Rückblick mit Top-10 (JSON, CSV,
    E-Mail), Verlauf mit Suche und Art-Filter (CSV-Export folgt dem Filter).
24. ~~[P3 · M] Aktivitäts-Log (Admin), Stream-Status als M3U/XSPF/XML~~ - erledigt: Karte „Aktivitäts-Log“ unter Benutzer & Rollen (Filter Art/Sender/Suche serverseitig über `GET /api/v1/audit?kind=&station=&q=`, neueste zuerst, CSV-Export); Stream-Status gab es schon als `/status/<id>.json|xml|m3u|xspf` (Statusseite verlinkt alle Formate).

### Verknüpfungen / öffentliche Seiten
25. ~~[P2 · M] Öffentliche Sender-/Sendeplan-Seite, Netzwerk-Liste, Charts-Seite, Widget-Konfigurator (Layout/Theme/Akzent)~~ - erledigt: `sender.html`, `sendeplan.html`, `charts.html`, `netzwerk.html` (ohne Login, `?station=…&theme=light&accent=rrggbb`), API `/api/v1/public/stations/:id/{page,schedule,charts}` + `/api/v1/public/network` (CORS), Widget-Konfigurator unter „Streams & Anbindungen“ (Layout Player/Senderseite/Charts/Sendeplan, Theme, Akzent, Verlauf, Höhe → iframe-Code + Vorschau).
26. ~~[P3 · M] Umfragen, Formulare, Auslosung (Normal/Multi/Elimination, Gewinner-Log, CSV)~~ - erledigt: `services/community.ts` - Umfragen (eine aktiv, eine Stimme je Teilnehmer, Ergebnis-Balken, CSV, Widget `hoerer.html?s=…&only=polls`), Formulare (Felder text/textarea/select/email, Pflicht, Einträge mit CSV, Widget `…&only=forms&form=<id>`), Auslosung (Normal/Multi/Elimination, Teilnehmer aus Formular oder Posteingang, Gewinner-Protokoll mit CSV); Hörerseite mit Tabs „Umfrage“ und „Formular“; öffentlich `/listener/poll`, `/listener/poll/vote`, `/listener/form`, `/listener/form/submit`.
27. ~~[P3 · M] Profilseite (Social Links, API-Keys), In-App-API-Doku mit "Live ausprobieren", Admin-Banner/Wartungsmeldung~~ - erledigt: Ansicht „Mein Profil & API“ (Name, Passwort, Social Links `PATCH /me/profile`, eigene API-Schlüssel `GET/POST/DELETE /me/tokens` nie mit mehr Rechten als das Konto, Entwickler-API-Tabelle mit „Live ausprobieren“ und curl-Zeile); Admin-Karte „Ankündigung & Wartung“ (`GET/PUT /site`, Banner mit Art/Ablauf/schließbar, Wartungsbalken, SSE `site.changed`, öffentlich `GET /api/v1/public/site`).
28. ~~[P3 · S] Handbuch: Suchfeld, Drucken/PDF, Rezepte~~ - erledigt: Werkzeugleiste mit Suche, „Drucken / PDF“ (Druck-CSS: Seitenleiste/Inhaltsverzeichnis aus, Abschnitt je Seite, schwarz auf weiß) und Sprung zu den Rezepten; Rezepte 1–8 (24/7-Stream, laut.fm-Live, KI-Moderation, Replays & Podcast, Stundenuhr, Jingle-Paket, Spot-Mix, Senderseite einbetten).
29. [P3 · L] Team-Hub (Feed/Chat/DM) - nur wenn Teamkommunikation gewünscht.

### KI-Studio-Werkzeuge (Abgleich mit `ki-tools.html`, Stand 2026-10-02)
30. ~~Spot-Werkstatt~~ - erledigt: 4 Schritte (Text → Ton-Knöpfe Kürzer/Länger/Witziger/Seriöser/Radio → Stimme →
    Musikbett mit Sidechain-Ducking per ffmpeg, `POST /ai/spot-mix`). Offen: RSS-Quelle als Textbasis (P3 · S).
31. ~~KI-Assistent~~ - erledigt: Chat mit gespeichertem Verlauf je Sender, eigene Anweisung, Prompt-Verbesserer
    (`/ai/chat`, `/ai/improve`). Offen: Wikipedia-gestützte Antworten mit Quellen, Bild-/Cover-Generierung (P3 · M).
33. ~~Sendeablauf-Planer~~ - erledigt als KI-Werkstatt-Karte: JSON-Tabelle (`/ai/plan`), Zeilen bearbeiten/verschieben,
    CSV/Druck, „→ Spot“. Offen: Deezer-Abgleich (P3).
34. ~~Transkription~~ - erledigt: lokales `whisper` (ANMACHA_CAST_WHISPER) oder Whisper-API eines OpenAI(-kompatiblen)
    Providers, Export TXT/SRT/JSON, Zusammenfassung/Show-Notes per KI. Offen: Suche im Transkript (P3 · S).
35. Voice Studio: Text→Sprache in die Bibliothek vorhanden; **offen** Wellenform-Schnitt, Effekte, Stimm-Klonen (siehe 14).
32. [P3 · L] Office-Studio und Musik-Studio (Suno): bewusst nicht enthalten - externe Dienste mit eigenem Vertrag.

## lautCast (laut.fm-Radioadmin) - Feinheiten gegenüber `automation.html`

Statistik-Zeitraumchips + 6 Untertabs; Sendeplan Export/Import CSV; Sendeplan-Zelle als Chip-Raster
statt Dialog; Upload-Metadatenfelder; Playlist-Backup JSON; gebündeltes "Speichern (N)"; Testlauf des
Algorithmus; Mail-Report.
