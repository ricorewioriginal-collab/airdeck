# AirDeck – Radio-Automation & Live-Broadcast

> **Kanonischer Einstiegspunkt:** Diese README ist die zentrale Projekt-, Status- und Entwicklungsübersicht. Coding-Agents lesen danach nur [`AI_HANDOVER.md`](AI_HANDOVER.md) und die für ihren konkreten Arbeitsblock relevanten technischen Dateien.

## Projekt

AirDeck ist eine eigenständige Radio-Automation und Live-Broadcast-Plattform für Windows, Server/Docker und Android. Ziel ist ein gemeinsamer autoritativer Kern für Automation, Livebetrieb, Sendeplanung, Medien, MusikHub, Recorder, Streaming-Ausgänge, AirDeckCast, laut.fm/lautCast, Nextcloud und KI-gestützte Workflows – ohne parallele Doppelarchitekturen.

**Repository:** `ricorewioriginal-collab/anmacha_control`  
**Entwicklungsbranch:** `AirDeck-Radio-Automation-&-Broadcast`  
**Demo:** `airdeck-demo.ricorewi-radio.de`

## Entwicklungsregeln

- Git ist die technische Wahrheit; nie auf einen älteren Handover-Stand zurückrollen.
- Bestehende Services, Datenbank, Benutzer, Sender, RBAC, Media-, Streaming- und Eventsysteme erweitern statt duplizieren.
- Kein UI-Button gilt allein als fertige Funktion. Backend, Rechteprüfung, Fehlerzustände und Tests gehören dazu.
- Status immer unterscheiden: **implementiert**, **automatisiert getestet**, **manuell getestet**, **live verifiziert**.
- Keine Secrets, echten Zugangsdaten oder sensiblen Referenz-Screenshots committen.
- Bei parallelen Coding-Agents vor und nach jedem Arbeitsblock Remote-Stand prüfen; niemals Force-Push.

## Aktueller Schwerpunkt

AirDeck besitzt bereits eine umfangreiche funktionierende Basis für Automation, Studio, Medien, Planung, Streaming, AirDeckCast, Nextcloud-Ansätze, laut.fm-Anbindung, Recorder, Benutzer/Rollen, Windows/Android/Server und Tests. Neue Arbeit muss deshalb immer zuerst den aktuellen Code prüfen.

### Parallel laufende Arbeit

- **Codex:** Windows-Installer / Inno Setup / First-Run / Bootstrap. Dieser Bereich ist für andere Agents währenddessen reserviert.
- **UI-Agent:** UI/UX schrittweise anhand der vereinbarten AirDeck-Demobilder weiterentwickeln. Kein alternatives Redesign erfinden; echte Git-Funktionen mit dem vereinbarten Zieldesign verbinden.
- **Größere Backend-Blöcke:** MusikHub sicher vervollständigen, danach Nextcloud-Quellen/Jobs, AirDeckCast-Auflösung, lautCast und vollständige Beta-Abnahme – jeweils nur soweit der aktuelle Git-Stand diese Arbeit noch offen lässt.

Die knappe Agentenübergabe steht in [`AI_HANDOVER.md`](AI_HANDOVER.md).

## UI/UX

Die im aktuellen Handover enthaltenen **AirDeck-UI/UX-Demobilder** sind die visuelle Zielvorgabe. Referenzbilder aus AzuraCast, laut.fm/Radioadmin und der separaten AnMaCha-Automation dienen dagegen ausschließlich zum Verständnis von Funktionen und Workflows.

UI-Arbeit erfolgt in kleinen Blöcken:

1. Designsystem + App Shell + Navigation + Header
2. Dashboard
3. Live Studio
4. Mediathek + MusikHub
5. Playlists + Sendeplan
6. Statistik
7. Sender + Branding + Team + Einstellungen
8. Responsive + Accessibility + Polish

Keine Mockdaten, Fake-Hörerzahlen, statischen ON-AIR-Zustände oder zweite Demo-App. Neuere reale Funktionen bleiben erhalten, auch wenn sie auf älteren Designbildern noch fehlen.

## MusikHub und Medien

MusicHub/MusikHub ist keine zweite Mediathek, sondern Teil der bestehenden AirDeck-Medienarchitektur. Ziel sind persönliche und Senderarchive, explizite Freigaben, senderübergreifende Nutzung und später externe Quellen.

Sicherheitsgrundsatz: **closed by default**. Rechte wie `preview.play`, `file.download` und `broadcast.use` bleiben getrennt. Private Inhalte dürfen nicht über Suche, Cover, Trefferzahlen, Collections, Metadaten oder Events geleakt werden.

Die Entwicklungsrichtung bleibt:

1. sichere private Medien, Preview/Download und Grants vervollständigen
2. Nextcloud als Storage-/Quellenadapter mit persistenten Jobs
3. MusikHub-Inhalte sauber für AirDeckCast/Playout auflösen
4. lautCast/Radioadmin über verifizierte Provider-Capabilities anbinden
5. vollständige Beta-/Regression-/Security-Abnahme

## Streaming und Multi-Sender

AirDeck unterstützt mehrere Sender und mehrere Ausgänge. AirDeckCast ist die eigene Streaming-/Verteilschicht; externe Werkzeuge dürfen keine konkurrierende zweite Automation erzeugen. Lokales Monitoring, Icecast und zusätzliche Encoder müssen in die vorhandene Output-/Service-Architektur passen.

## Windows Installer

Der Installer wird zu einer integrierten Ersteinrichtung erweitert. Admin-Konto, Betriebsprofil, lokales Monitoring und optionale lokale Streamingkomponenten müssen die vorhandene AirDeck-Persistenz und Secret-Verwaltung verwenden. Keine Klartext-Passwörter in `Program Files`, keine zweite `config.json`-Authentifizierungswelt. Updates/Repair dürfen bestehende Benutzer, Sender und Konfigurationen nicht überschreiben.

## Plattformen

- Windows-Anwendung und Installer
- Server/Docker, inklusive Headless-Betrieb
- Android-App/Engine
- Browser-Studio/PWA

Die GUI darf nicht Voraussetzung dafür sein, dass eine laufende Automation weitersendet.

## Referenzsysteme

- **AzuraCast:** Funktionsreferenz für Stationen, Mountpoints, Streaming, Media, Playlists, History, Relays und Audio Processing.
- **laut.fm Radioadmin:** Funktionsreferenz für Track-/Playlist-/Upload-/Schedule-/Live-/Stats-Workflows; aktuelle Provider-Capabilities vor Implementierung verifizieren.
- **AnMaCha Automation:** eigene funktionierende Referenz für Live Studio, Queue, PTT, Jingles/SoundFX, Preview, Zeitplan, Cloud, Recorder/Replays, Voicetrack, Decks und Studiomail.
- **MusicBase:** Referenzidee für Musikverwaltung; keinen fremden Code ohne geklärte Nutzungsrechte übernehmen.

AirDeck bleibt in allen Fällen ein eigenständiges Produkt.

## Tests

Vor Fertigmeldung je nach betroffenem Block mindestens relevante Typechecks, Unit-/Integrationstests und negative Rechte-/Fehlerszenarien ausführen. Für UI zusätzlich echte Navigation, Senderwechsel, Reload, Dialoge, API-Aufrufe, Desktop und Mobile prüfen. Für Broadcast-/Installerblöcke echte Start-/Restart-/Upgrade-/Failure-Szenarien berücksichtigen.

## Agenten-Kurzstart

Jeder Coding-Agent beginnt mit:

```bash
git fetch
git status
git branch --show-current
git log -1 --oneline
```

Danach [`AI_HANDOVER.md`](AI_HANDOVER.md) lesen und **nur den dort genannten nächsten Arbeitsblock** bearbeiten. Das reduziert Kontextverbrauch bei Claude Code, Codex, Replit, Cursor und anderen Agents erheblich.

## Wichtige technische Bereiche

- `src/core/` – Automation/Scheduler/Source-Priority
- `src/server/` – Server, Playout, Streaming, Datenbank und Services
- `studio/` – Web-/Studio-Oberfläche
- `apps/windows/` – Windows-App
- `apps/android/` – Android-App/Engine
- `packaging/` – Installer, Server-/Demo-Paketierung
- `test/` – automatisierte Tests
- `docs/screenshots/` – automatisch erzeugte Screenshots des aktuellen Git-/Demo-Zustands; nicht mit den separaten UI/UX-Zielbildern des Handover verwechseln

---

**Grundsatz:** README = Ausgangspunkt. `AI_HANDOVER.md` = kurze aktuelle Agentenübergabe. Git/Tests = technische Wahrheit. Historische Status- und Zwischenstands-Markdowns werden nicht mehr als parallele Wahrheitsquellen gepflegt.
