# Installation und Setup-Assistent

Ziel: **Download → Installieren → Setup → Sender → Musik → Stream → AUTO**, ohne Kommandozeile und ohne manuell installierte Abhängigkeiten.

## Windows-Installer (`AnMaCha-Cast-Setup.exe`)

Komponenten:

| Komponente | Standard |
|---|---|
| AirDeck Studio (Oberfläche) | ✔ fest |
| AirDeck Server (Core, API, Datenbank SQLite) | ✔ fest |
| Audio-Engine ffmpeg (LAME/AAC/Opus) | ✔ |
| Android-APK zum Verteilen | ✔ |
| Startmenü | ✔ |
| Desktop-Verknüpfung | optional |
| Autostart bei Anmeldung, im Hintergrund | optional |

Der Inno-Setup-Assistent (`packaging/windows/installer.iss`) verwendet `WizardStyle=modern`. Bei einer echten Erstinstallation wählt der Nutzer Standard/Lokal oder Erweitert/Server/Hybrid, AirDeck-Port, LAN-Zugriff, optionalen Administrator, lokales Monitoring und Datenspeicher. Standard ist SQLite. Optionaler MySQL-/Firebase-Abgleich verwendet den bestehenden `SyncManager` und `SecretStore`; eine externe Datenbank wird nicht installiert. Das Passwort für den Administrator wird niemals als Kommandozeilenargument übergeben. Eine lokale Einmaldatei wird im Benutzer-Datenordner geschrieben, sofort von `airdeck-engine.exe --headless --import-installer-bootstrap` übernommen und vor Installer-Ende gelöscht. Die Engine speichert den Admin als scrypt-Hash im bestehenden UserStore. Schlägt die Übernahme fehl, meldet Setup einen Fehler und entfernt die Einmaldateien. Silent-Installationen erzeugen keinen leeren Admin-Bootstrap; das Konto lässt sich danach im AirDeck-Setup-Assistenten anlegen.

Lokales Mithören ist im AirDeck-Studio bereits vorhanden. Optional bereitet der Installer AirDeckCast-HLS für den ersten Sender (`main`) vor und setzt dessen Automation auf Autostart; HLS wird über den konfigurierten AirDeck-Port und die vorhandene AirDeck-Anmeldung geschützt. Die eigentliche Audioausgabe setzt ffmpeg und laufendes Playout voraus. Weitere Sender können über das bestehende Sendermodell eigene HLS-Pfade und externe Mountpoints bekommen. Ein zusätzlicher Icecast-Windows-Dienst, ezstream, Liquidsoap, BUTT, VB-Audio Virtual Cable oder eine zweite Audioengine werden nicht installiert. Der vorhandene ffmpeg-Build enthält MP3-Encoding; ein separates `lame.exe` ist für diesen Weg nicht nötig.

Nur bei ausdrücklich gewähltem LAN-Zugriff und Installation mit Adminrechten legt der Installer eine AirDeck-eigene eingehende Firewallregel für den gewählten TCP-Port im privaten Profil an. Für `127.0.0.1` gibt es keine zusätzliche Freigabe. Eine spätere Portänderung im Studio erfordert eine manuelle Anpassung der Firewallregel; das zeigt der Setup-Assistent an. Bei der Deinstallation wird die vom Installer benannte AirDeck-Regel gelöscht. Bestehende Nutzerdaten unter `%LOCALAPPDATA%\AirDeck` bleiben erhalten.

Ein normaler Update-/Repair-Lauf erkennt eine bestehende AirDeck-Datenbank oder Konfiguration beim Start des Installers. Er überspringt die Ersteinrichtungsseiten und überschreibt weder Admin noch Sender oder Streamziele. Die lokale Engine wird nicht als Windows-Dienst installiert: Der vorhandene Autostart läuft bei Benutzeranmeldung im Hintergrund, auch wenn das Studiofenster geschlossen wird. Echter Betrieb ohne Benutzeranmeldung benötigt weiterhin die dokumentierte Server-/Headless-Installation.

Automatisiert geprüft: Einmalimport, Passwort-Login und Ablehnung eines falschen Passworts, HLS-/Autostart-Persistenz, Entfernen der Einmaldatei, Schutz vor erneutem Admin-Import beim Repair, First-Run-Hinweis und belegter Port (`test/installer-bootstrap.test.ts`). Der Windows-Workflow kompiliert den Inno-Installer und installiert, startet und deinstalliert ihn still. Eine interaktive Erstinstallation und eine echte Update-/Repair-Probe auf einem Windows-Rechner sind zusätzlich manuell zu prüfen.

Die eingebettete Node-Laufzeit braucht keine zusätzliche VC++-Runtime; ffmpeg liegt als separate optionale Komponente bei.

## Linux

```bash
# Debian/Ubuntu
sudo apt install ./airdeck-server_<version>_amd64.deb   # Laufzeit + ffmpeg enthalten, legt Dienst und Benutzer an
sudo airdeck setup                                     # oder im Browser: http://<server>:8750/setup
```

Ohne Paket: `airdeck-server-<version>-linux-x64.tar.gz` entpacken, dann `sudo ./install.sh`. Das Skript legt Benutzer, Pfade und systemd-Dienst an.

## Docker

`docker compose up -d`. Beim ersten Aufruf von `http://<server>:8750` öffnet sich der Setup-Assistent.

## Setup-Assistent (erster Start, im Studio)

1. **Willkommen** (Sprache, Haftungsausschluss)
2. **Betriebsart:** Local · Self-Hosted · Erweitert
3. **Datenbank:** SQLite · PostgreSQL · MariaDB · MySQL (mit Verbindungstest)
4. **Speicher:** Medienverzeichnis, vorhandene Musikordner einbinden
5. **Admin-Konto:** Benutzername, Passwort
6. **Netzwerk:** Port, nur dieser PC / im LAN / Internet (HTTPS mit Domain und E-Mail über Caddy)
7. **Sender:** Name, Logo, Zeitzone
8. **Stream:** Icecast / SHOUTcast / laut.fm (mit Verbindungstest) oder später
9. **Audio:** Mithör- und CUE-Gerät, Mikrofon (am Client)
10. **Automation:** Sendeuhr-Vorlage, Notfall-Ordner, Autostart
11. **KI (optional):** keine / lokal (Piper, Ollama erkennen) / Cloud-Keys
12. **Fertig:** Zusammenfassung → „Automation starten“

Jeder Schritt lässt sich überspringen und später unter **Administration** ändern. Konfigurationsdateien muss niemand bearbeiten.

**Stand der Umsetzung** (`src/server/services/setup.ts`, `studio/js/setup.js`):
- Der Assistent öffnet sich beim ersten Start automatisch für die Administration. Bestehende Installationen mit Titeln, Ausgängen oder Konten bleiben unberührt. Erneut starten geht über „Einrichtung (Assistent)“ im Menü.
- Betriebsart, Datenbank, Netzwerk und Medienordner werden in `airdeck.conf` geschrieben, Kommentare bleiben erhalten. Sie gelten nach einem Neustart, den der Assistent selbst auslöst. Unter Docker/systemd beendet sich AirDeck dafür mit Code 75 und der Dienst-Manager startet neu.
- Datenbank-Wechsel: Die Verbindung wird getestet, der bisherige Stand in die neue Datenbank übernommen und das Passwort verschlüsselt im Secret-Store abgelegt (nicht in der Datei).
- Speicher: **Vorhandene Musikordner einbinden**. Die Titel bleiben, wo sie sind. AirDeck indiziert sie, gleicht jede Minute ab und löscht nie eine Originaldatei. Ein nicht erreichbares Laufwerk entfernt nichts aus der Bibliothek.
- KI lokal: Ollama wird unter `http://127.0.0.1:11434` gesucht und als Text-Anbieter eingetragen.
- Noch nicht im Assistenten: PostgreSQL automatisch installieren, Logo, Zeitzone, Sendeuhr-Vorlage und die Stream-Verbindungsprüfung (ein Ausgang zeigt seinen Zustand direkt im Studio).

## Systemanforderungen

Mindestwerte für Hardware werden erst veröffentlicht, wenn sie gemessen sind. Die Messung ist Teil der Installationstests. Bekannte Messwerte bisher:
- Core im Leerlauf mit laufender Automation: etwa 105–112 MB RAM und 2–4 % CPU.
- Pro Encoder zusätzlich etwa 50 MB.

Unterstützt werden:
- Windows 10/11 64 bit
- Debian 12 und Ubuntu 22.04/24.04 (x64)
- Docker (x64, arm64 geplant)
- Android ab Version 8
