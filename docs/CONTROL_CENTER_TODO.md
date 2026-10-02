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
2. [P2 · M] Sendezentrale: Netzwerk-Senderkarten mit Sortierung Live (Meiste/Wenigste), Ø 24h, Ø 7 Tage, A–Z; Sync.

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
6. [P2 · L] Rundown-/Sendeablauf-Planer mit Segmenttypen, Backtiming und Live-Modus.

### KI & Automatik
7. [P2 · M] KI-Studio-Tab wie `relay-pro6`: Ansage-Typen als Knöpfe, Meldungen zusammenfassen,
   Playlist per KI erstellen/neu ordnen, geplante KI-Ansagen mit Wochentagen.
8. ~~[P2 · M] News-Zentrale (Show-Prep): Feed-/Artikelwahl, Wetter-Block, KI-Vorschlag, Teleprompter~~ - erledigt: eigene
   Ansicht (`studio/js/showprep.js`, `services/showprep.ts`): Standard-Feeds nach Kategorie + eigene, Artikel serverseitig
   geholt (Cache), Auswahl per Haken → KI-Moderationsnotizen, Wetter-Block (Open-Meteo, sprechbarer Text), Leseansicht mit
   Teleprompter (Größe, Serif, Tempo, Pause).
9. ~~[P2 · M] Sendeablauf-Planer als Maske mit Drag-&-Drop-Tabelle und Export~~ - erledigt (KI-Werkstatt → Sendeablauf-Planer:
   Zeilen per Drag & Drop, Zeile hinzufügen, CSV-Export, Drucken).

### Musik & Inhalte
10. ~~[P1 · M] Cardwall → Soundboard~~ - erledigt: Tags (Filter-Chips) + Suche, Favoriten, Zuletzt gespielt,
    Tastenkürzel je Cart (eindeutig je Sender), Show-Modus (Vollbild mit großen Carts), Esc/„Alle stoppen“
    blendet alle Carts aus (`POST /playout/carts-stop`, auch Browser-Wiedergabe).
11. [P2 · M] Track-TÜV: Tonart-Analyse, Online-Tag-/Cover-Suche, Vorher/Nachher-Export (LUFS-Messung existiert).
12. [P2 · M] Podcasts: Auto-Veröffentlichung nach Aufnahme mit Titel-/Beschreibungs-Vorlagen; [P3 · M] Podcast-Hörer (Suche, Charts, Abos).
13. [P3 · M] Media & Jingle Exchange: Netzwerk-Sichtbarkeit, Dokumente/Logos (an MusikHub andocken).
14. [P3 · L] Voice Studio: Wellenform-Schnitt, Musikbett-Mischer, Rauschentfernung; Stimm-Klonen nur mit lokaler Engine.
15. [P3 · L] Transkription (Whisper lokal, Export TXT/SRT/VTT/JSON); Musik-Studio (Suno) nur mit gewünschtem Anbieter.

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
19. [P2 · L] Verbreitung: bis zu 2 eigene Mount-Streams mit Bitrate, SFTP-Eingang, Video-Radiostream (Visualizer, RTMP).
20. [P3 · L] Decks erweitert: Loop, Tempo, Wellenform-Springen.

### Auswertung
21. ~~[P1 · L] Hörerstatistik~~ - erledigt: Ansicht `studio/js/stats.js` + `services/stats.ts` (GET `/stats?period=`):
    Chips Heute/24 h/7 Tage/30 Tage/3 Monate, 8 Kacheln (Gespielt, Hörer jetzt, Ø Hörer/Song, Peak, Live-Plays,
    einz. Songs, Std. mit Hörern, Top Song), Untertabs Gespielt / Top-Songs / Hörer-Verlauf (SVG, Ø + Spitze,
    nach Tageszeit) / Genre-Mix / Live-Plays. Backend: Play-Log trägt Hörerzahl + Live-Kennung (Kappe 5000),
    Stunden-Aggregat `listenerHours` über 100 Tage. Bewusst weggelassen: Rang (laut.fm-spezifisch) und
    DB-Abgleich (externe laut.fm-Datenbank).
22. [P2 · L] Deep Stats: Heatmap Wochentag×Uhrzeit, Top/Flop, Artist-Anteile, Song-Verlauf, Excel/PDF/Mail.
23. ~~[P2 · S] Berichte: Meistgespielt-Ranking; Protokoll-Filter~~ - erledigt: Sendungs-Rückblick mit Top-10 (JSON, CSV,
    E-Mail), Verlauf mit Suche und Art-Filter (CSV-Export folgt dem Filter).
24. [P3 · M] Aktivitäts-Log (Admin), Stream-Status als M3U/XSPF/XML.

### Verknüpfungen / öffentliche Seiten
25. [P2 · M] Öffentliche Sender-/Sendeplan-Seite, Netzwerk-Liste, Charts-Seite, Widget-Konfigurator (Layout/Theme/Akzent).
26. [P3 · M] Umfragen, Formulare, Auslosung (Normal/Multi/Elimination, Gewinner-Log, CSV).
27. [P3 · M] Profilseite (Social Links, API-Keys), In-App-API-Doku mit "Live ausprobieren", Admin-Banner/Wartungsmeldung.
28. [P3 · S] Handbuch: Suchfeld, Drucken/PDF, Rezepte.
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
