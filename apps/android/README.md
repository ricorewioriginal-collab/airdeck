# AnMaCha Cast für Android

Native App (Kotlin + Jetpack Compose + Material 3) - kein WebView, kein PWA-Wrapper. Zwei
Betriebsarten, die sich ohne erneute Anmeldung umschalten lassen:

**Studio / Fernsteuerung:** Einen laufenden AnMaCha-Cast-Server fernsteuern (Programm, Warteschlange,
Quellen übernehmen/freigeben), über dieselbe REST-/SSE-API (`/api/v1/...`), die auch das Web-Studio nutzt.

**Go Live:** Das Handy wird selbst zum Sendestudio, mit der bestehenden reinen Java-Engine (`engine/`).
Läuft als Vordergrund-Dienst mit dauerhafter Benachrichtigung weiter, auch bei ausgeschaltetem Bildschirm.
- Mikrofon und Musik vom Handy, Musik unter dem Mikrofon wird leiser (Ducking)
- MP3-Encoder: LAME als reines Java (jump3r, LGPL 2.1+), keine nativen Bibliotheken
- Sendet an laut.fm, Icecast oder AzuraCast (Icecast-Quellprotokoll PUT, bei älteren Servern SOURCE).
  Bei Abbruch verbindet sich die App selbst neu.
- Titelliste mit automatischem Weiterspielen, Mithören über Kopfhörer, Pegelanzeigen

**Noch nicht nativ angebunden** (als solches in der App gekennzeichnet, nicht vorgetäuscht):
MusicHub, Cardwall, Playlisten-Verwaltung, Podcasts, QR-Code-Kopplung (Kopplungscode wird manuell
eingegeben). Diese Bereiche laufen bis dahin über das Web-Studio im Browser.

## Aufbau

- `engine/src`: Engine ohne Android-Bezug (Mischpult, Encoder, Icecast-Quelle, Takt). Wird mit
  `engine/test.sh` gegen einen echten Icecast getestet.
- `native/`: Android-Audio-Schicht (Mikrofon, Decoder, Vordergrund-Dienst `EngineService`,
  `EngineHub` als Fassade für die Oberfläche)
- `app/src/main/kotlin/app/anmachacast/studio/`: die native Oberfläche (Paket `app.anmachacast.studio`)
  - `data/`: REST-Client, SSE-Client (Realtime), verschlüsselte Token-Ablage
  - `connect/`, `home/`, `studio/`, `golive/`, `more/`, `common/`: Bildschirme je Bereich
  - `nav/AppNav.kt`: Startbildschirm mit zwei Betriebsarten und dauerhaftem Umschalter oben (`nav/ModeHeader.kt`).
    Go Live (Live, Musik, Sender) funktioniert ohne Server; Server / Studio koppelt erst, wenn man es öffnet.
  - `golive/`: Push-to-Talk (Drücken öffnet das Mikro in ca. 12 ms), Mikrofonquelle, Pegel, Encoder.
  - `live/`: laut.fm (Anmeldung per WebView, Token im Adress-Anker, Stationen, Live-Zugangsdaten automatisch)
    und Nextcloud (Login Flow v2, WebDAV, Titel in den Zwischenspeicher). Zugangsdaten liegen verschlüsselt (`LiveStore`).

Ein einziges Gradle-Projekt (keine generierte `android/`-Unterordner mehr wie zu Capacitor-Zeiten) -
`engine/src` und `native/` werden direkt als zusätzliche Quellverzeichnisse eingebunden, nicht kopiert.

## Bauen

Voraussetzungen: JDK 17 und Android SDK (`ANDROID_HOME`) - lokal, oder automatisch über GitHub Actions
(Workflow „Build“, Job `android`, Artefakt `AnMaCha-Cast-Android`, die Runner bringen den Android SDK
bereits mit).

```bash
cd apps/android
./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
```

## Verbinden

1. AnMaCha Cast auf dem PC mit Netzwerkfreigabe starten: `ANMACHA_CAST_HOST=0.0.0.0`
2. Im Studio-Dashboard einen Kopplungscode erzeugen (`POST /api/v1/pair`, 6 Ziffern, 5 Minuten gültig).
3. In der App die Server-Adresse (z. B. `https://dein-server:8750`) und den Code eingeben.
