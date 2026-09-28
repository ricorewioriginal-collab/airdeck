# AirDeck – Radio-Automation & Live-Broadcast

<p>
  <img src="https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/assets/icons/airdeck-gesamt.png" width="96" alt="AirDeck">
  <img src="https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/assets/icons/airdeck-windows.png" width="96" alt="AirDeck Windows">
  <img src="https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/assets/icons/airdeck-android.png" width="96" alt="AirDeck Android">
  <img src="https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/assets/icons/airdeck-server.png" width="96" alt="AirDeck Server">
</p>

[![Build](https://github.com/ricorewioriginal-collab/anmacha_control/actions/workflows/build.yml/badge.svg)](https://github.com/ricorewioriginal-collab/anmacha_control/actions/workflows/build.yml)
![Version](https://img.shields.io/badge/version-0.4.0-blue)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20Android%20%7C%20Linux%20%7C%20Docker-2f8cff)
![Docker](https://img.shields.io/badge/Docker-amd64%20%7C%20arm64-2496ed)

**Ein Projekt von RicoReWi / RicoReWi Music & Media – für Broadcast, Automation, Live und laut.fm.**

AirDeck ist eine eigenständige Radio-Automation und Live-Broadcast-Plattform. Sie verbindet 24/7-Automation, Live-Studio, Sendeplanung, Medien- und Playlistverwaltung, Recorder, Streaming-Ausgänge, AirDeckCast, externe Provider und mobile Bedienung in einem System.

<p align="center">
  <a href="https://airdeck-demo.ricorewi-radio.de"><strong>🚀 Live-Demo öffnen → airdeck-demo.ricorewi-radio.de</strong></a><br>
  Login: <code>demo</code> / <code>airdeck-demo</code> · direkt im Browser
</p>

> **Dokumentationsprinzip:** Diese README ist die öffentliche Projektübersicht. Ausführliche Benutzer- und Entwicklerdokumentation gehört ins GitHub Wiki bzw. in technische `docs/`-Dateien. Die interne Übergabe zwischen Coding-Agents steht separat in [`AI_HANDOVER.md`](AI_HANDOVER.md).

## 🚦 Projektstand

Die folgende Übersicht beschreibt den bestätigten Stand des Projekts. Neue Funktionen werden erst nach Implementierung und passenden Tests als abgeschlossen geführt.

| Bereich | Status | Kurz |
|---|---|---|
| Kernbetrieb, Automation, Source-Priority, REST-API | ✅ läuft | Kernfunktionen vorhanden und getestet |
| Dashboard, Mediathek, Playlists, Live Studio, Handbuch | ✅ läuft | zentrale Arbeitsbereiche vorhanden |
| Crossfade und Audio-Pipeline | ✅ läuft | mehrere Übergangsszenarien umgesetzt |
| Failover-Ketten | ✅ läuft | mehrstufige Fallback-Logik mit Schutz vor Fehlkonfiguration |
| Playlist-Shuffle und Rotation | ✅ läuft | Interpreten-/Regel-Logik vorhanden |
| Medien-Integrität und Relink | ✅ läuft | fehlende Dateien und Duplikate behandelbar |
| Backup / Restore | ✅ läuft | Wiederherstellungsworkflow vorhanden |
| Sendeplanung, Clock-Templates, Preflight | ✅ läuft | Planungs- und Timingfunktionen vorhanden |
| AirDeckCast / HLS / mehrere Ausgänge | ✅ läuft | eigener Streaming-/Verteilpfad vorhanden |
| Geräte-Pairing und LAN-Discovery | ✅ läuft | Kopplung und Geräteverwaltung vorhanden |
| Docker amd64 / arm64 | ✅ läuft | Serverbetrieb für beide Architekturen vorgesehen |
| MusikHub / Rechte / Cloud-Quellen | 🟡 Ausbau | sichere Freigaben und Quellen werden weiterentwickelt |
| UI/UX-Neugestaltung | 🟡 Ausbau | schrittweise Umsetzung anhand der AirDeck-Zielbilder |
| Windows Installer / First-Run | 🟡 Ausbau | integrierte Ersteinrichtung wird erweitert |
| Long-Run-/Release-Härtung | ⬜ offen | Watchdog, Crash-Recovery und längere Release-Tests folgen |

**Legende:** ✅ bestätigt · 🟡 in Weiterentwicklung · ⬜ noch offen.

Für den laufenden Coding-Agent-Stand gilt ausschließlich [`AI_HANDOVER.md`](AI_HANDOVER.md); historische Progress-Markdowns werden nicht mehr als parallele Wahrheitsquelle gepflegt.

## ⬇️ Download

| Plattform | Datei | Hinweis |
|---|---|---|
| 🪟 Windows Installer | [**AirDeck-Setup.exe**](https://github.com/ricorewioriginal-collab/anmacha_control/releases/latest/download/AirDeck-Setup.exe) | reguläre Windows-Installation |
| 🪟 Windows Portable | [**AirDeck-Windows-Portable.zip**](https://github.com/ricorewioriginal-collab/anmacha_control/releases/latest/download/AirDeck-Windows-Portable.zip) | entpacken und starten |
| 🤖 Android | [**AirDeck-Android.apk**](https://github.com/ricorewioriginal-collab/anmacha_control/releases/latest/download/AirDeck-Android.apk) | mobile AirDeck-App |
| 🐧 Linux | [**AirDeck-Linux.deb**](https://github.com/ricorewioriginal-collab/anmacha_control/releases/latest/download/AirDeck-Linux.deb) | Debian/Ubuntu-Paket |
| 🐳 Docker | `docker compose up -d` | amd64 und arm64 |

[**Alle Releases und Release Notes öffnen**](https://github.com/ricorewioriginal-collab/anmacha_control/releases/latest)

## 🚀 Live-Demo

**https://airdeck-demo.ricorewi-radio.de**

- Benutzer: `demo`
- Passwort: `airdeck-demo`
- Browserbasiert, keine Installation erforderlich
- reine Testinstanz; keine produktiven oder vertraulichen Daten ablegen

## 📸 Vorschau

<p align="center">
  <img src="https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/slideshow.gif" alt="AirDeck UI Slideshow" width="820">
</p>

### Arbeitsbereiche

| Dashboard | Live Studio | Sendeplan |
|---|---|---|
| [![Dashboard](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-dashboard.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-dashboard.png) | [![Studio](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-studio.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-studio.png) | [![Sendeplan](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-planning.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-planning.png) |

| Mediathek / Musik | Playlists | Recorder |
|---|---|---|
| [![Mediathek](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-mediathek.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-mediathek.png) | [![Playlists](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-playlists.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-playlists.png) | [![Recorder](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-recorder.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-recorder.png) |

| KI-Automation | Anbindungen | Hörer |
|---|---|---|
| [![KI](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-ai.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-ai.png) | [![Bridges](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-bridges.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-bridges.png) | [![Hörer](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-listeners.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/view-listeners.png) |

### Studio-Panels

| Decks | Cardwall | Now Playing |
|---|---|---|
| [![Decks](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-decks.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-decks.png) | [![Cardwall](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-carts.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-carts.png) | [![Now Playing](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-np.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-np.png) |

| Queue | Mikrofon / Live | Stream / Encoder |
|---|---|---|
| [![Queue](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-queue.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-queue.png) | [![Live](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-live.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-live.png) | [![Stream](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-stream.png)](https://raw.githubusercontent.com/ricorewioriginal-collab/anmacha_control/AirDeck-Radio-Automation-%26-Broadcast/docs/screenshots/panel-stream.png) |

Weitere Screenshots liegen unter [`docs/screenshots/`](docs/screenshots/).

## ✨ Kernfunktionen

- 24/7 Radio-Automation mit Quellenpriorität, Failover und Crossfade
- Live Studio mit Decks, Queue, Cardwall, Mikrofon/PTT und Vorhören
- Medien-, Playlist- und Sendeplanverwaltung
- Recorder und Replay-Workflows
- AirDeckCast und mehrere Streaming-Ausgänge
- Icecast/SHOUTcast- und Provider-Integrationen
- Nextcloud-/Cloud-Quellen als Teil der Medienarchitektur
- MusikHub für freigegebene persönliche, Sender- und senderübergreifende Medien
- Benutzer, Rollen und senderbezogene Berechtigungen
- Windows-, Android-, Linux-/Server- und Docker-Betrieb
- REST-API, Live-Ereignisse und Integrationen
- KI-gestützte Automation mit konfigurierbaren Providern

## ⚡ Schnellstart

### Windows

Aktuellen Installer aus den Releases herunterladen und den Einrichtungsassistenten starten.

### Server / Docker

```bash
docker compose up -d
docker compose logs airdeck
```

Standardmäßig läuft das Studio unter `http://127.0.0.1:8750`.

### Entwicklung

```bash
npm install
npm run check
npm start
```

Vor Änderungen bitte [`CONTRIBUTING.md`](CONTRIBUTING.md) lesen.

## 📚 Dokumentation

### GitHub Wiki

Das Wiki ist für die ausführliche, leserfreundliche Produktdokumentation vorgesehen:

- Erste Schritte
- Installation Windows / Android / Linux / Docker
- Live Studio
- Automation und Sendeplanung
- Mediathek und MusikHub
- Nextcloud und externe Quellen
- AirDeckCast und Streaming
- laut.fm / lautCast
- Benutzer, Rollen und Sicherheit
- API und Integrationen
- Entwicklung und Architektur
- Troubleshooting
- Releases / Upgrade-Hinweise

**Wiki:** https://github.com/ricorewioriginal-collab/anmacha_control/wiki

### Technische Repository-Dokumentation

| Thema | Datei |
|---|---|
| In-App-Handbuch | [`studio/handbuch.html`](studio/handbuch.html) |
| Installation | [`docs/INSTALLATION.md`](docs/INSTALLATION.md) |
| Docker / Server | [`docs/DOCKER.md`](docs/DOCKER.md) |
| Streaming / Audio | [`docs/STREAMING.md`](docs/STREAMING.md) |
| Bridge / Integrationen | [`docs/BRIDGE.md`](docs/BRIDGE.md) |
| KI-Automation | [`docs/AI.md`](docs/AI.md) |
| Architektur | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Funktionsabgleich | [`docs/FEATURE_PARITY.md`](docs/FEATURE_PARITY.md) |
| Runtime-Abhängigkeiten | [`RUNTIME_DEPENDENCIES.md`](RUNTIME_DEPENDENCIES.md) |
| Drittanbieter-Komponenten | [`THIRD_PARTY_COMPONENTS.md`](THIRD_PARTY_COMPONENTS.md) |
| Agenten-Handover | [`AI_HANDOVER.md`](AI_HANDOVER.md) |

Alte Dateien wie `AIRDECK_PROGRESS.md`, `BETA_READINESS.md` und `P4_REMAINING.md` werden bewusst nicht mehr geführt. Öffentlicher Status bleibt in dieser README; Agenten-Arbeitsstand bleibt in `AI_HANDOVER.md`; ausführliche Erklärungen gehören ins Wiki bzw. in stabile technische Dokumentation.

## 🧭 Dokumentationsstruktur

```text
README.md             öffentliche Projektübersicht, Status, Demo, Downloads, Screenshots
AI_HANDOVER.md        kompakter aktueller Arbeitsstand für Coding-Agents
CONTRIBUTING.md       Regeln für Mitarbeit und Entwicklung
docs/                 technische, mit dem Code versionierte Dokumentation
GitHub Wiki           ausführliches Benutzer-/Entwicklerhandbuch
GitHub Releases       veröffentlichte Builds und Release Notes
GitHub Issues/Projects Bugs, Aufgaben und Planung
```

## 🤝 Mitmachen

Beiträge sind willkommen. Architektur, Regeln und Andockpunkte stehen in [`CONTRIBUTING.md`](CONTRIBUTING.md). Änderungen sollten bestehende AirDeck-Systeme erweitern und keine parallelen Ersatzsysteme einführen.

## ⚖️ Haftung

AirDeck ist ein privates Hobbyprojekt und wird ohne Gewähr bereitgestellt. Die Nutzung erfolgt auf eigene Verantwortung. Siehe [`HAFTUNGSAUSSCHLUSS.md`](HAFTUNGSAUSSCHLUSS.md).
