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
3. **[P1 · M] Nachrichten & Wetter (laut.fm)**: Stunden-Chip-Raster 00–23 (Presets 6–22 / alle / keine),
   Typ Kombi/Nachrichten/Wetter, Anhören/Herunterladen, "Jetzt senden", Zeitplan-Liste, Option
   "Automatisch verbinden, wenn der Relay gerade nicht sendet".
4. **[P1 · L] Smart Blocks & Rotation**: Regel-Editor ("Es müssen passen …", Reihenfolge, Begrenzen auf
   N/Einheit), Vorschau, dynamische Playlist vs. Momentaufnahme, "Allgemeine Rotation".
5. [P2 · S] Ereignisse: Typen KI-Ansage und Nachrichten-/Werbe-Trigger, "Jetzt beenden".
6. [P2 · L] Rundown-/Sendeablauf-Planer mit Segmenttypen, Backtiming und Live-Modus.

### KI & Automatik
7. [P2 · M] KI-Studio-Tab wie `relay-pro6`: Ansage-Typen als Knöpfe, Meldungen zusammenfassen,
   Playlist per KI erstellen/neu ordnen, geplante KI-Ansagen mit Wochentagen.
8. [P2 · M] News-Zentrale (Show-Prep): Feed-/Artikelwahl, Wetter-Block, KI-Vorschlag, Teleprompter.
9. [P2 · M] Sendeablauf-Planer als Maske mit Drag-&-Drop-Tabelle und Export.

### Musik & Inhalte
10. **[P1 · M] Cardwall → Soundboard**: Tags/Suche, Favoriten, Zuletzt gespielt, Show-Modus (Vollbild), Esc = alle stoppen.
11. [P2 · M] Track-TÜV: Tonart-Analyse, Online-Tag-/Cover-Suche, Vorher/Nachher-Export (LUFS-Messung existiert).
12. [P2 · M] Podcasts: Auto-Veröffentlichung nach Aufnahme mit Titel-/Beschreibungs-Vorlagen; [P3 · M] Podcast-Hörer (Suche, Charts, Abos).
13. [P3 · M] Media & Jingle Exchange: Netzwerk-Sichtbarkeit, Dokumente/Logos (an MusikHub andocken).
14. [P3 · L] Voice Studio: Wellenform-Schnitt, Musikbett-Mischer, Rauschentfernung; Stimm-Klonen nur mit lokaler Engine.
15. [P3 · L] Transkription (Whisper lokal, Export TXT/SRT/VTT/JSON); Musik-Studio (Suno) nur mit gewünschtem Anbieter.

### Sender & Ausspielung
16. **[P1 · M] Sendereinstellungen**: Überblend-Profile (Standard, weich, knackig, Club, Talk & News, Ambient,
    Nahtlos), Kurve (linear / Equal-Power / S), Fade-Out beim Stoppen, Sendungsende-Fade, Kurvenvorschau.
17. **[P1 · M] Regeln & Sicherung**: Einschübe-Liste "nach N Songs aus Ordner" im Rotation-Panel.
18. [P2 · M] Sound & Stimme: Presets Radio/Warm/Hell/Laut/Sprache, Stereo-Breite, Bass/Höhen, Mikro-Gate/De-Esser.
19. [P2 · L] Verbreitung: bis zu 2 eigene Mount-Streams mit Bitrate, SFTP-Eingang, Video-Radiostream (Visualizer, RTMP).
20. [P3 · L] Decks erweitert: Loop, Tempo, Wellenform-Springen.

### Auswertung
21. **[P1 · L] Hörerstatistik**: Chips Heute/24h/7 Tage/30 Tage/3 Monate, Stat-Kacheln (Gespielt, Hörer jetzt,
    Ø Hörer/Song, Peak, Rang, Live-Plays, einz. Songs, Top Song), Untertabs Gespielt/Top-Songs/Hörer-Verlauf/
    Genre-Mix/Live-Plays/DB-Abgleich; dafür Hörer-Zeitreihe im Backend (heute nur `recapSamples`).
22. [P2 · L] Deep Stats: Heatmap Wochentag×Uhrzeit, Top/Flop, Artist-Anteile, Song-Verlauf, Excel/PDF/Mail.
23. [P2 · S] Berichte: Meistgespielt-Ranking; Protokoll-Filter.
24. [P3 · M] Aktivitäts-Log (Admin), Stream-Status als M3U/XSPF/XML.

### Verknüpfungen / öffentliche Seiten
25. [P2 · M] Öffentliche Sender-/Sendeplan-Seite, Netzwerk-Liste, Charts-Seite, Widget-Konfigurator (Layout/Theme/Akzent).
26. [P3 · M] Umfragen, Formulare, Auslosung (Normal/Multi/Elimination, Gewinner-Log, CSV).
27. [P3 · M] Profilseite (Social Links, API-Keys), In-App-API-Doku mit "Live ausprobieren", Admin-Banner/Wartungsmeldung.
28. [P3 · S] Handbuch: Suchfeld, Drucken/PDF, Rezepte.
29. [P3 · L] Team-Hub (Feed/Chat/DM) - nur wenn Teamkommunikation gewünscht.

### KI-Studio-Werkzeuge
30. [P2 · S–M] Spot-Werkstatt: Ton-Knöpfe Kürzer/Länger/Witziger/Seriöser, RSS-Quelle, Ducking-Mix.
31. [P3 · M] KI-Assistent: Chatverlauf mit Suche, eigene Anweisung, Prompt-Verbesserer.
32. [P3 · L] Office-Studio.

## lautCast (laut.fm-Radioadmin) - Feinheiten gegenüber `automation.html`

Statistik-Zeitraumchips + 6 Untertabs; Sendeplan Export/Import CSV; Sendeplan-Zelle als Chip-Raster
statt Dialog; Upload-Metadatenfelder; Playlist-Backup JSON; gebündeltes "Speichern (N)"; Testlauf des
Algorithmus; Mail-Report.
