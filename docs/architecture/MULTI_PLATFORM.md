# Plattformen

## Windows

```
┌──────────── Windows-PC ─────────────────────────────────────────────┐
│ Dienst „AnMaCha Cast Server“ (Session 0)   AnMaChaCast.exe (natives Fenster) │
│  Core · API · SQLite · Encoder ◄─HTTP─► WPF: Sender/On-Air/Modus,   │
│  Ausgänge ins Internet                  Decks A–D, Cardwall         │
│                                         Mithören/CUE (Soundkarte)    │
│                                         Mikrofon ─► Ingest an Core   │
│ Tray-Symbol: Studio öffnen · Status · Beenden/Neustarten des Dienstes│
└─────────────────────────────────────────────────────────────────────┘
```

Das Windows-Programm (`apps/windows/`, Projekt `AnMaChaCast.csproj`, AssemblyName `AnMaChaCast`) ist **kein Browser-in-der-Box** mehr für die
Kernbedienung: Das Hauptfenster (`MainWindow`) ist natives WPF – echte Windows-Bedienelemente (Buttons,
Slider, ToggleButtons, ComboBox), kein HTML/WebView. Es deckt die primäre Sendebedienung ab:

| Bereich | Umsetzung |
|---|---|
| Senderwahl, On-Air-Anzeige, 24/7↔Manuell, Mikrofon, Sendung start/stop, Uhr | nativ (WPF) |
| Decks A–D (Play/Pause/Stopp, ±10 s, Fortschritt, Restzeit, lokale Monitor-Lautstärke) | nativ (WPF) |
| Cardwall (Kacheln auslösen) | nativ (WPF) |
| Mediathek, Playlists, Sendeplan, Einstellungen, KI-Werkzeuge, Hörer-Statistik, … | **noch WebView2** – eigener Knopf „Weitere Funktionen im Browser öffnen“ öffnet das bestehende Web-Studio in einem eingebetteten WebView2-Fenster (`BrowserForm`); kein Ersatz für die primäre Oberfläche, sondern bewusst getrennter Rest-Zugang für Ansichten, die noch nicht nativ nachgebaut sind |

Das native Fenster spricht dieselbe REST-/SSE-Schnittstelle wie das Web-Studio (`/api/v1/...`,
`/api/v1/events`) – die Engine bleibt maßgeblich, das Fenster ist Fernbedienung, genau wie bisher.
Tray-Symbol, Prozessüberwachung der Engine und Einzel-Instanz-Logik (`Program.cs`, `Engine.cs`) sind
unverändert geblieben.

**Wichtig, Session-0-Isolation:** Ein Windows-Dienst hat keinen verlässlichen Zugriff auf die Soundkarte und das Mikrofon des angemeldeten Benutzers. Daraus folgt:
- **Senden** (Dekodieren, Mischen, Kodieren, Streamen) braucht keine Soundkarte und läuft im Dienst.
- **Mithören, CUE und Mikrofon** laufen im Studio-Client beim Benutzer. Das Mikrofon geht als Live-Quelle in den Core und wird dort dekodiert und gemischt.
- Wer ausdrücklich über die Soundkarte **ausspielen** will (etwa UKW-Sender am Line-Out), nutzt den **Einfach-Modus ohne Dienst** (Hintergrundprozess mit Tray, wie heute). Der Installer bietet beide Varianten an.

## Linux

Server bzw. Core als systemd-Dienst. Ein Linux-Desktop-Client ist der Browser oder eine spätere Desktop-Hülle mit derselben Oberfläche. Es gibt keine eigene Linux-Oberfläche.

## Android

Nicht nur eine WebView. Die Oberfläche bleibt Web (dieselbe wie auf dem Desktop), dazu kommen **native Module**:

| Modul | Zweck |
|---|---|
| Serververbindung | Erkennung (UDP), QR-Kopplung, Verbindungstest, Profile, Token im Android Keystore |
| Live-Sender (Foreground-Service mit Benachrichtigung) | Mikrofon → nativer Encoder (AAC über MediaCodec) → an den AnMaCha-Cast-Ingest **oder direkt** an Icecast/laut.fm (Standalone). Läuft weiter, wenn die App im Hintergrund ist |
| Audio | Mithören über den nativen Player (weiterläuft im Hintergrund) |
| Berechtigungen | Mikrofon, Benachrichtigungen, Netzwerk, sauber abgefragt |

Android wird **kein** 24/7-Automationsserver. Das System erlaubt keinen dauerhaften Hintergrundbetrieb dieser Art verlässlich. Der Foreground-Service gilt nur für Live-Sendungen und Mithören.

## Sync (Hybrid)

Der lokale Core arbeitet immer mit seiner eigenen SQLite-Datenbank. Der Abgleich mit dem Server läuft über das Änderungsprotokoll (`sync_changes`: Tabelle, Schlüssel, Änderungszeit, Herkunft). Bei Konflikten gewinnt die neuere Änderung pro Datensatz, der Konflikt wird protokolliert und im Studio angezeigt. Das ersetzt die bisherige Komplett-Blob-Replikation.
