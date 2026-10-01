# Umbenennung AirDeck → AnMaCha Cast – überprüfbarer Stand

Stand: 2026-10-01. Markenkonflikt mit einem bestehenden Produkt „AirDeck Pro" erfordert eine vollständige
Umbenennung. Neuer, ausschließlicher Produktname: **AnMaCha Cast** (nicht „AnMaChaCast", nicht „AnMaCha Deck",
nicht „AirDeckCast"). „AirDeck" soll in der normalen Benutzeroberfläche nirgendwo mehr sichtbar sein.

**Leitplanken** (vom Auftrag direkt übernommen, gelten für jeden Block dieser Umbenennung):
- Kein blindes Search & Replace - jede Änderung unterscheidet sichtbares Branding, interne Bezeichner,
  Persistenzpfade, API-/Protokoll-Kompatibilität, Paketnamen und Build-Artefakte.
- Bestehende Installationen, Logins, Datenpfade, gespeicherte Profile/Tokens müssen nach einem Update
  weiterfunktionieren - keine kaputten Upgrade-Pfade.
- Interne technische Identifier (Klassenname `AirDeckApp`, `this.docs.bind('airdeck', …)`, lowercase
  LocalStorage-Schlüssel `airdeck.token`/`airdeck.server`, Umgebungsvariablen `AIRDECK_*`) bleiben vorerst
  unverändert bestehen, wo eine Änderung reines Umbau-Risiko ohne Nutzerwert wäre oder noch eine eigene,
  sorgfältige Migration braucht (siehe „Noch offen" unten) - **nicht** blind mitgezogen.
- Jeder echte Protokoll-/API-Kompatibilitätspunkt (Health-Endpunkt, LAN-Erkennung, Download-Pfade) bekommt
  einen Legacy-Alias statt eines harten Cutovers.

## Phase 1 (dieser Block): sichtbares Studio-Branding + kritische Protokoll-Kompatibilität

**Umfang:** `studio/` (alle HTML-Seiten, `manifest.webmanifest`, alle `js/*.js`-Dateien), plus die serverseitigen
Stellen, die dadurch direkt betroffen sind (Health-Endpunkt-Name, Geräte-Pairing-Antwort, APK-Download-Pfad/
-Dateiname, LAN-Erkennungsprotokoll) sowie die Umbenennung der bisherigen Zusatzfunktion „AirDeckCast"
(Zusatz-Stream-Profile/HLS) zu **„Zusatz-Streams"** (nicht „AnMaCha Cast Cast") in Kommentaren und sichtbaren
Texten quer durchs Backend (`app.ts`, `http.ts`, `icecast.ts`, `model.ts`, `playout.ts`, `ffmpeg.ts`,
`services/musikhub.ts`).

### Sichtbares Branding (studio/)

- `index.html`: `<title>`, Sidebar-Logo (`AIRDECK` → `ANMACHA CAST`), „AirDeck beenden"-Knopf, Zusatz-Streams-
  Tooltips.
- `manifest.webmanifest`: `name`/`short_name`.
- `handbuch.html`, `handy.html`, `hoerer.html`, `status.html`, `widget.html`: Titel, Fließtext, „Powered by"-
  Fußzeilen. Dateinamen-Erwähnungen konsistent mit Bindestrich geschrieben (`AnMaCha-Cast-Setup.exe`,
  `AnMaCha-Cast-Windows-Portable.zip`, `AnMaCha-Cast-Android.apk`, `X-AnMaCha-Cast-Signature`,
  `AnMaCha-Cast-Mitschnitte`), Fließtext-Komposita mit Leerzeichen+Bindestrich (`AnMaCha Cast-Server`,
  `AnMaCha Cast-PC` usw.) - deutsche Typografie für mehrteilige Eigennamen vor einem angehängten Substantiv.
- `js/*.js` (alle 18 Dateien): Kommentare und sämtliche nutzersichtbaren Strings (Dialogtitel, Hinweistexte,
  Status-/Fehlermeldungen, Button-Beschriftungen) umbenannt. `AIRDECK_FFMPEG` in `handbuch.html`s
  Fehlerbehebungstabelle bewusst unverändert gelassen (siehe „Noch offen" - Umgebungsvariablen folgen in
  einem eigenen Block).

### Protokoll-/API-Kompatibilität (echte Funktionsänderungen, nicht nur Text)

Beim Testen dieses Blocks fiel auf: ein reines Text-Rename hätte die **echte Verbindungsprüfung gebrochen**
(Client verglich `health.name` exakt gegen `'AirDeck'`/`'AnMaCha Cast'` - ein Fund, der den Live-Betrieb
beeinträchtigt hätte, siehe „Fehler und Behebungen" unten). Entsprechend wurden folgende Stellen mit
**Legacy-Alias statt hartem Cutover** umgesetzt:

1. **Health-Endpunkt** (`src/server/app.ts` → `HealthManager`): `name` jetzt `'AnMaCha Cast'`.
   `studio/js/connect.js` akzeptiert beim Verbindungstest weiterhin auch `'AirDeck'` (Server vor der
   Umbenennung) - kein „kein AnMaCha Cast erkannt" bei einem alten, noch nicht aktualisierten Server.
2. **Geräte-Pairing-Antwort** (`src/server/services/devices.ts`): `server.name` jetzt `'AnMaCha Cast'`
   (rein informativ, keine bekannte strikte Prüfung dagegen gefunden).
3. **APK-Download**: neuer primärer Pfad/Dateiname `/download/AnMaCha-Cast-Android.apk`, alter Pfad
   `/download/AirDeck-Android.apk` bleibt als funktionierender Alias bestehen (`src/server/http.ts`).
   `SystemService.localApk()` (`src/server/services/system.ts`) erkennt eine mitgelieferte APK unter beiden
   Dateinamen (neue zuerst). Der tatsächliche Android-Build, der diese Datei erzeugt, heißt noch nicht
   `AnMaCha-Cast-Android.apk` - das ist Teil des separaten Android-/CI-Blocks (siehe „Noch offen").
4. **LAN-Erkennung** (`src/server/discovery.ts`, UDP Port 8751): neue Anfrage `ANMACHACAST?1` / Antwort
   `ANMACHACAST!` als Standard. Der Responder beantwortet weiterhin auch die alte Anfrage `AIRDECK?1` (mit
   der alten Antwort `AIRDECK!`), und `discover()` fragt vorsorglich mit beiden Varianten - ein noch nicht
   aktualisierter Server im selben Netz wird weiterhin gefunden, ein neuer Client findet auch alte Server.
5. **„AirDeckCast" → „Zusatz-Streams"** (Funktionsname, nicht Produktname): Routen blieben bereits neutral
   (`/stream-profiles`, kein `/airdeckcast/*`-Präfix) - nur ein Endpunkt hieß wörtlich
   `/api/v1/stations/:sid/airdeckcast-test`; da Client und Server gemeinsam in diesem Repository ausgeliefert
   werden (kein externer Aufrufer dieser internen Test-Auslösung denkbar), wurde er ohne Alias direkt zu
   `/stream-profiles-test` umbenannt und der Client (`studio/js/app.js`) entsprechend angepasst.

### Tests

- `test/app-download.test.ts`: bestehender Test umbenannt/erweitert (prüft jetzt zusätzlich, dass der
  Legacy-Pfad `AnMaCha-Cast-Android.apk` als `Content-Disposition`-Dateinamen liefert), neuer zweiter Test
  für den neuen primären Pfad/Dateinamen.
- `test/connect.test.ts`: bestehender Fall (Server meldet sich mit `'AirDeck'`) bleibt grün (beweist die
  Rückwärtskompatibilität), neuer Fall für `'AnMaCha Cast'` ergänzt.
- `test/server.test.ts`, `test/health.test.ts`: Health-Namen-Erwartung aktualisiert.
- `test/discover.test.ts`, `test/devices.test.ts`, `test/airdeckcast-test.test.ts`: unverändert grün (nutzen
  Funktionsimporte, keine hartcodierten Protokoll-Strings).
- `npm run typecheck` grün (Server + Studio), vollständige Testsuite grün (225 bestanden, 0 fehlgeschlagen,
  6 übersprungen - unabhängig von diesem Block, umgebungsbedingt).
- Keine Live-Verifikation im echten Browser für diesen Block (Umfang zu groß für eine einzelne
  Playwright-Sitzung in dieser Sandbox) - textuelle/strukturelle Änderungen, durch die Testsuite und
  `git diff`-Review pro Datei geprüft, nicht zusätzlich per Screenshot.

## Noch offen (bewusst nicht in diesem Block, nächste Blöcke)

Gemäß Auftrag priorisiert, jeweils als eigener, kleiner PR mit eigenen Tests:

1. **README.md + Root-Dokumente** (SUPPORT.md, SECURITY.md, CONTRIBUTING.md, COMMERCIAL.md, BRANDING.md,
   CODE_OF_CONDUCT.md, CHANGELOG.md-Kopfzeile, HAFTUNGSAUSSCHLUSS.md, THIRD_PARTY_COMPONENTS.md,
   AI_HANDOVER.md, LICENSE-nahe Hinweise) sowie `docs/*.md` (20 Dateien) - historische Changelog-Einträge
   bleiben unverändert (keine Geschichtsfälschung), nur aktuelle Produkttexte ändern sich.
2. **Umgebungsvariablen** (21 Stück, `AIRDECK_*`): neue `ANMACHA_CAST_*`-Namen einführen, alte als Fallback
   behalten (`ANMACHA_CAST_HOST ?? AIRDECK_HOST ?? Default`), als deprecated dokumentieren. Danach
   `handbuch.html`s Fehlerbehebungstabelle (`AIRDECK_FFMPEG`) aktualisieren.
3. **LocalStorage-Schlüssel** (`airdeck.token`, `airdeck.server`, `airdeck.mobileMode` in `studio/js/api.js`
   u. a.): Migration auf neue Schlüssel beim ersten Start (neuen Schlüssel prüfen → wenn leer, alten lesen →
   übernehmen → neuen schreiben), alte vorerst nicht löschen. Bewusst nicht blind umbenannt in diesem Block,
   da ein reines Rename bestehende Logins/Einstellungen gelöscht hätte.
4. **Android-App** (`apps/android/`): App-Label, Notification-Channel-Namen, Splash/Icons, String-Ressourcen.
   Package-Identifier **nicht** blind ändern (Signing/Update-Kompatibilität prüfen, siehe Auftrag Abschnitt 6).
   Capacitor-Plugin-Name `'AirDeckEngine'` (`studio/js/handy.js` + natives Android-Pendant) muss koordiniert
   auf beiden Seiten zugleich geändert werden - in diesem Block unverändert gelassen, um die Bridge nicht zu
   brechen.
5. **Windows-App** (`apps/windows/AirDeck.csproj`, Installer unter `packaging/windows/installer/`):
   Assembly-Metadaten (ProductName/Company/Description), Tray-Text, Installer-/Setup-Dateiname,
   Autostart/Registry/Firewall-Regeln, Update-Erkennung des laufenden `.exe`-Namens (`src/server/main.ts`/
   `update.ts` referenzieren `AirDeck.exe` an mehreren Stellen - erst ändern, wenn der tatsächliche Build
   das neue `.exe` auch wirklich erzeugt, sonst bricht die „vor einem Update sauber beenden"-Logik).
6. **Linux/Docker/Paketierung** (`Dockerfile`, `docker-compose.yml`, `packaging/linux/`, `packaging/demo/`):
   systemd-Beschreibungen, Image-/Paketnamen, Installationsskripte. Bestehende Pfade
   (`/var/lib/airdeck`, `/etc/airdeck`, `/opt/airdeck`, Benutzer `airdeck`) **nicht** blind ändern -
   Legacy-Pfad-Erkennung/Migration statt Datenverlust.
7. **CI/CD** (`.github/workflows/*.yml`, 15 Dateien): Workflow-Anzeigenamen, Artefakt-/Release-Dateinamen
   (`AnMaCha-Cast-Setup.exe`, `AnMaCha-Cast-Windows-Portable.zip`, `AnMaCha-Cast-Android.apk`,
   `AnMaCha-Cast-Linux.deb`). `src/server/update.ts`s Asset-Erkennung arbeitet bereits mit Mustern
   (`/Setup.*\.exe$/i`, `/Portable.*\.zip$/i`, `/\.apk$/i`), nicht mit exakten Namen - die neuen
   Artefaktnamen werden dort automatisch erkannt, sobald CI sie tatsächlich so benennt. Kein Code-Update in
   `update.ts` nötig, nur der Workflow selbst.
8. **GitHub-Pages-Projektseite** (`site/index.html`, `site/docs.html`).
9. **Repository-/Branch-Name**: nicht automatisch geändert (siehe Auftrag Abschnitt 20/21) - am Ende dieser
   Umbenennung eine Liste der manuell auf GitHub vorzunehmenden Schritte liefern (Repository umbenennen,
   Pages-URL, Beschreibung, Topics, ggf. Default-Branch).

## Fehler und Behebungen (dieser Block)

- **Health-Namen-Vergleich hätte Verbindungen gebrochen**: `studio/js/connect.js` verglich `health.name`
  exakt gegen den Produktnamen, um zu erkennen, ob der Server überhaupt „ein AnMaCha Cast/AirDeck" ist. Das
  reine Text-Rename (Server sendet jetzt `'AnMaCha Cast'`, Client erwartete noch `'AirDeck'` bzw. umgekehrt,
  je nach Reihenfolge der Änderung) hätte dazu geführt, dass der eigene Server als „nicht erkannt" gemeldet
  wird - ein durch `npm test` aufgedeckter, nicht offensichtlicher Fund (nicht durch bloßes Lesen des Diffs
  erkennbar). Behoben durch den oben beschriebenen beidseitigen Kompatibilitäts-Alias; durch die volle
  Testsuite verifiziert (vorher 1 Fehlschlag, danach 0).
- **APK-Download-Pfad/-Dateiname** war ebenfalls hart verdrahtet zwischen Client-Hinweistext und
  Server-Routenmatch - derselbe Mechanismus (Alias) angewendet, bevor es zu einem echten 404 hätte kommen
  können.
- **„AirDeckCast" fälschlich als „Zusatz-Streams" in einem MusikHub-Preflight-Kontext übersetzt**: ein erster
  Durchlauf ersetzte „AirDeckCast-Preflight" in `musikhub.ts`/`musikhub.js` mit „Zusatz-Streams-Preflight" -
  beim Gegenprüfen stellte sich heraus, dass dieser Preflight (`broadcastPreflight()`) nichts mit der
  Zusatz-Stream-Profile-Funktion zu tun hat, sondern die allgemeine Sendefähigkeit eines MusikHub-Titels
  prüft. Korrigiert zu „Sendefähigkeits-Preflight".
