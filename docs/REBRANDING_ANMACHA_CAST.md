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
2. ~~**Umgebungsvariablen**~~ – erledigt, siehe „Phase 3" unten. Offen bleiben nur die Compose-Interpolations-
   variablen in `docker-compose.yml` selbst (Teil von Punkt 6, Linux/Docker/Paketierung).
3. ~~**LocalStorage-Schlüssel**~~ – erledigt, siehe „Phase 4" unten.
4. ~~**Android-App**~~ – erledigt, siehe „Phase 5" unten. `applicationId` bleibt bewusst `app.airdeck.studio`
   (Signatur-/Update-Kompatibilität).
5. ~~**Windows-App**~~ – erledigt, siehe „Phase 6" unten. Tatsächlicher Dateiname bleibt bewusst
   `AirDeck.exe` (gleiche Begründung wie zuvor hier vermerkt).
6. ~~**Linux/Docker/Paketierung**~~ – erledigt, siehe „Phase 7" unten. Paketname/Pfade/Benutzer/
   Service-/Volume-Namen bleiben bewusst `airdeck` (gleiche Begründung wie zuvor hier vermerkt).
   `docs/INSTALLATION.md` bleibt wegen eng verwobener echter Release-Dateinamen bis Phase 8
   zurückgestellt.
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

## Phase 3: Umgebungsvariablen `ANMACHA_CAST_*` mit `AIRDECK_*`-Fallback

**Umfang:** zentraler Helfer `src/server/legacy-branding.ts` (`envVar(env, suffix)`: prüft zuerst
`ANMACHA_CAST_<suffix>`, dann das bisherige `AIRDECK_<suffix>`), angewendet auf alle dokumentierten,
von außen gesetzten Umgebungsvariablen: `*_DATA`, `*_CONFIG`, `*_MEDIA`, `*_LOGS`, `*_MODE`, `*_PORT`,
`*_HOST` (`config.ts`), `*_DB`, `*_DB_URL`, `*_DB_PASSWORD` (`db/index.ts`), `*_FFMPEG` (`ffmpeg.ts`),
`*_CORS_ORIGINS` (`http.ts`), `*_RADIOADMIN_URL`, `*_LAUTFM_API_URL` (`lautfm.ts`), `*_ROOT`,
`*_DISCOVERY`, `*_SUPERVISED` (`main.ts`), `*_SECRET_KEY` (`secrets.ts`). Kommentare und Fehlermeldungen
an diesen Stellen sowie in `app.ts` (ffmpeg-Fehlermeldung) und `studio/handbuch.html`
(Fehlerbehebungstabelle) entsprechend aktualisiert. Zusätzlich `docs/INSTALLATION.md`,
`docs/architecture/NETWORK.md`, `docs/architecture/DATABASE.md` aktualisiert (reine App-Umgebungsvariablen,
kein Docker-Compose-Bezug).

**Bewusst ohne Fallback direkt umbenannt** (rein intern, keine Kompatibilitätsfrage):
- `AIRDECK_RESTARTED` → `ANMACHA_CAST_RESTARTED` (`main.ts`): wird nur innerhalb eines Prozessbaums
  derselben laufenden Version gesetzt und sofort wieder gelesen – kein Upgrade-Szenario, in dem alte und
  neue Benennung aufeinandertreffen könnten.
- `AIRDECK_LIQ_INPUT_PASSWORD` / `AIRDECK_LIQ_OUT<n>_PASSWORD` → `ANMACHA_CAST_LIQ_*` (`liquidsoap.ts`):
  das generierte Liquidsoap-Skript und der dazugehörige Hinweistext werden bei jedem Abruf gemeinsam neu
  erzeugt, nie über eine Version hinweg gespeichert – keine Kompatibilitätsnotwendigkeit.

**Bewusst unverändert gelassen** (echte externe Protokoll-/Konfigurations-Kompatibilität):
- `lautfm.ts`s `DEFAULT_ORIGIN = 'airdeck'`: Radioadmin-Tokens bei laut.fm sind an diesen Origin-Wert
  gebunden (siehe Datei-Kommentar) – eine Änderung würde bestehende, bei laut.fm hinterlegte Zugänge
  brechen. Bleibt dauerhaft `'airdeck'`, unabhängig vom weiteren Rebranding-Fortschritt.
- `docker-compose.yml` und die darauf aufbauende Dokumentation (`docs/DEPLOY.md`, `docs/DOCKER.md`):
  nutzen weiterhin ausschließlich `AIRDECK_DB*` als Compose-Interpolationsvariablen (`${AIRDECK_DB_PASSWORD}`
  in der YAML-Datei selbst, nicht nur im Node-Prozess). Eine Umbenennung hier betrifft bestehende `.env`-
  Dateien produktiver Installationen und braucht eine eigene, sorgfältige Migration – Teil des separaten
  Linux/Docker/Paketierungs-Blocks (siehe „Noch offen" Punkt 6), nicht dieses Blocks.
- `globalThis.__AIRDECK_VERSION` / `__AIRDECK_ROOT` / `__AIRDECK_PACKAGED` / `__AIRDECK_BUILD`: Build-Zeit-
  Banner-Variablen, die `scripts/build.mjs` beim Bundling setzt – kein vom Nutzer gesetzter Umgebungswert,
  gehört inhaltlich zum Build-/Paketierungs-Block.
- `AIRDECK_TEST_PG` / `AIRDECK_TEST_MYSQL*`: reine CI-/Test-Infrastruktur-Variablen (Service-Container-
  Adressen in den Testdateien), kein Produkt-Konfigurationswert – gehört ggf. zum CI/CD-Block.

**Tests:** `test/liquidsoap.test.ts` an die neuen (ohne Fallback direkt umbenannten) Variablennamen
angepasst; `test/config.test.ts` um einen neuen Test ergänzt, der sowohl „nur `ANMACHA_CAST_*` gesetzt"
als auch „beide gesetzt, `ANMACHA_CAST_*` gewinnt" prüft. Alle bestehenden Tests, die noch `AIRDECK_*`
setzen (z. B. `test/setup.test.ts`, `test/installer-bootstrap.test.ts`, `test/automation-source.test.ts`),
bleiben unverändert grün – sie beweisen live die Rückwärtskompatibilität über den Fallback-Pfad.
`npm run typecheck` und die volle Testsuite grün (230 bestanden, 0 fehlgeschlagen, 6 übersprungen).

## Phase 4: LocalStorage-Schlüssel `airdeck.*` → `anmacha_cast.*`

**Umfang:** neuer Browser-seitiger Helfer `studio/js/legacy-storage.js` (`lsGet(key)`/`lsSet(key, value)`):
`lsGet` liest zuerst `anmacha_cast.<key>`; ist der leer, wird `airdeck.<key>` übernommen, in den neuen
Schlüssel geschrieben und zurückgegeben – der alte Schlüssel bleibt dabei bestehen (kein Rollback-Risiko).
`lsSet` schreibt bei einem Wert nur den neuen Schlüssel; bei `null`/`undefined` (echtes Entfernen, z. B.
Logout) werden **beide** Schlüssel gelöscht, damit ein gelöschter Wert nicht über den alten Schlüssel wieder
auftaucht und ein Logout tatsächlich wirkt.

Angewendet auf alle gefundenen `airdeck.*`-LocalStorage-Schlüssel: `token`, `server` (`api.js`), `profiles`
(`connect.js`), `layout.v1` (`layout.js`), `station`, `mobileMode`, `progSink`, `pflSink`, `autoListen`
(`app.js`). `handy.js` ist ein eigenständiges `<script>` ohne ES-Module (kann `legacy-storage.js` nicht
importieren) und schreibt `mobileMode` deshalb direkt unter beiden Schlüsselnamen parallel. Der
`sessionStorage`-Schlüssel `airdeck.lautfm.pending` (`api.js`) wurde ohne Migration direkt zu
`anmacha_cast.lautfm.pending` umbenannt – er wird innerhalb desselben Seitenaufrufs sofort wieder gelesen
und gelöscht (laut.fm-OAuth-Rückkehr), es gibt keinen Zustand, der über ein Upgrade hinweg bestehen müsste.

**Tests:** `test/legacy-storage.test.ts` (neu, mit einer In-Memory-`localStorage`-Attrappe, da Node ohne
Browser-Umgebung kein globales `localStorage` kennt) deckt alle vier Fälle ab: nur alter Schlüssel gesetzt
(Übernahme + Schreiben des neuen, alter bleibt), nur neuer gesetzt, keiner gesetzt, und Entfernen löscht
beide. Zusätzlich echte Browser-Verifikation per Playwright (Chromium) gegen einen laufenden
`AirDeckApp`-Server: alter `airdeck.token` im LocalStorage gesetzt → nach Neuladen der Seite ist
`anmacha_cast.token` mit demselben Wert gefüllt und `airdeck.token` weiterhin vorhanden (kein Logout).
`npm run typecheck` und die volle Testsuite grün (235 bestanden, 0 fehlgeschlagen, 6 übersprungen).

## Phase 5: Android-App sichtbares Rebranding

**Investigation zuerst** (wie vom Auftrag gefordert, kein blindes Umbenennen): `apps/android/android/`
existiert nicht im Repository – das native Android-Projekt wird von `prepare.mjs` per
`npx cap add android` zur Build-Zeit erzeugt. Quelle der Wahrheit sind `capacitor.config.json`
(`appId`, `appName`), `apps/android/engine/` (reines Java, kein Android-Bezug) und
`apps/android/native/` (Android-Schicht inkl. Capacitor-Plugin).

**Bewusst unverändert** (signatur-/update-kritisch, siehe Auftrag Abschnitt 6):
- `capacitor.config.json`s `appId: "app.airdeck.studio"` – das ist Androids `applicationId`. Ein
  Update einer bestehenden Installation (ohne Deinstallation) verlangt identischen `applicationId`
  **und** identisches Signatur-Zertifikat (`ANDROID_KEYSTORE_B64`-Secret, siehe `build.yml`). Eine
  Änderung hier würde alle bestehenden Installationen von künftigen Updates abschneiden. Bleibt
  unverändert.
- Java-Pakete `app.airdeck.engine` (`engine/src/`) und `app.airdeck.engine.android` (`native/`) sowie
  die Java-Klasse `AirDeckEnginePlugin`: rein interne Bezeichner ohne Nutzersichtbarkeit, unabhängig
  vom `appId`. Eine Umbenennung wäre eine reine Verschiebe-/Umbenennungsaktion über 7 Dateien plus
  Anpassung der in `prepare.mjs` generierten `AndroidManifest.xml`-Dienstreferenz – ohne jeden
  Nutzerwert. Bleibt unverändert (wie die übrigen internen lowercase-Bezeichner dieser Umbenennung).
- Notification-Channel-ID `"airdeck-live"` (`EngineService.java`): von Android pro App+Kanal-ID
  persistiert (Stummschaltung/Priorität, die der Nutzer selbst gesetzt haben könnte). Eine Änderung
  würde diese Einstellung für bestehende Nutzer zurücksetzen, ohne jeden funktionalen Vorteil.
- Artefaktname `AirDeck-Android` in `README.md`: beschreibt den tatsächlichen, noch nicht umbenannten
  CI-Artefaktnamen (Teil von Phase 8) – absichtlich nicht vorgezogen, damit die Dokumentation nicht auf
  einen noch nicht existierenden Dateinamen verweist (gleiches Vorgehen wie in Phase 2 bei README.md).

**Geändert** (rein sichtbar/kosmetisch, kein Einfluss auf `applicationId`/Signatur):
- `capacitor.config.json`s `appName` → „AnMaCha Cast" (steuert den von Capacitor generierten
  `app_name`-String-Ressourcenwert – reine Anzeige, keine Kennung).
- Capacitor-Plugin-Name „AirDeckEngine" → „AnMaChaCastEngine": als **eine atomare** Änderung in
  `AirDeckEnginePlugin.java`s `@CapacitorPlugin(name = …)` und `studio/js/handy.js`s
  `registerPlugin(…)`-Aufruf zusammen geändert – beide Seiten werden immer gemeinsam in derselben
  App-Version gebaut und ausgeliefert, es gibt keinen Versionsversatz zwischen Client und nativer
  Schicht, der eine Fallback-Kompatibilität nötig gemacht hätte.
- Sichtbare Benachrichtigungstexte in `EngineService.java`: Titel „AirDeck sendet live" →
  „AnMaCha Cast sendet live", Kanalbeschreibung entsprechend; WakeLock-/WifiLock-Tags „AirDeck:live" →
  „AnMaChaCast:live" (nur per `adb shell dumpsys power` sichtbar, keine Persistenz-/Kompatibilitätsfrage).
- Standard-Sendername („AirDeck" als Vorbelegung, falls der Nutzer keinen eigenen Namen einträgt) in
  `EngineHub.java`, `AirDeckEnginePlugin.java` (zwei Stellen) und `IcecastSource.java` → „AnMaCha Cast".
- HTTP-`User-Agent`-Header beim Icecast-Quellanschluss (`IcecastSource.java`) „AirDeck-Android" →
  „AnMaCha-Cast-Android" (reine Kennzeichnung, kein Icecast-Server verlangt ein bestimmtes Format –
  gleiches Vorgehen wie bei `remote-link.ts`s `User-Agent` in Phase 2).
- `package.json`-Beschreibung, `README.md` (Titel, Fließtext, Umgebungsvariable `AIRDECK_HOST` →
  `ANMACHA_CAST_HOST` mit Hinweis auf den weiterhin funktionierenden Legacy-Fallback), Kommentare in
  `prepare.mjs`, `LiveEngine.java`, `EngineTest.java`s Test-Sendernamen.

**Tests:** `npm run typecheck` und die volle Testsuite grün (235 bestanden, 0 fehlgeschlagen,
6 übersprungen – unverändert, da keine der Android-/Java-Dateien vom Node-Test-Harness erfasst wird).
Zusätzlich die echte Engine-Testsuite (`apps/android/engine/test.sh`, reines Java gegen einen echten
lokalen Icecast-Server, dieselbe Prüfung wie im `android`-CI-Job) lokal ausgeführt: „ALLE TESTS OK" –
bestätigt, dass die umbenannten Dateien (inkl. des neuen `User-Agent`- und Sendernamen-Strings)
weiterhin syntaktisch korrekt sind und sich erfolgreich mit einem echten Icecast-Server verbinden,
senden und wieder trennen. Die Android-spezifischen Dateien unter `native/` (abhängig von
Capacitor/Android-SDK, hier nicht lokal baubar) werden vom `android`-CI-Job der jeweiligen PR geprüft
(echter `./gradlew assembleDebug`-Build).

## Phase 6: Windows-App sichtbares Rebranding

**Investigation zuerst**: `apps/windows/AirDeck.csproj` (.NET Framework 4.8, WinExe), `apps/windows/*.cs`
(Program.cs, MainForm.cs, Engine.cs – das eigenständige Windows-Fensterprogramm) und
`packaging/windows/` (Inno-Setup-Installer, Begleitskripte, Liesmich/Haftungsausschluss).

**Bewusst unverändert** (reale Dateinamen, Update-Mechanismus, von Windows persistierte Kennungen):
- `AssemblyName`/tatsächlicher Dateiname **bleibt `AirDeck.exe`**: `src/server/main.ts` hat eine
  hartkodierte Laufzeitprüfung (`basename(process.execPath).toLowerCase() !== 'airdeck.exe'`), die
  erkennt, ob das Windows-Fensterprogramm neben der Engine liegt (Tray-Symbol-Logik). Der Installer
  startet/beendet/prüft ebenfalls `AirDeck.exe` an rund einem Dutzend Stellen (`installer.iss`,
  `*.cmd`-Skripte). Eine Umbenennung des tatsächlichen Programmnamens ist eine eigene, größere
  koordinierte Änderung (Node-Seite + Installer + Skripte gemeinsam) und bewusst nicht Teil dieses
  Blocks.
- Installationspfad `{autopf}\AirDeck`, Build-Quellordner `dist\AirDeck\`, Startmenü-Gruppenname,
  Release-Dateiname `AirDeck-Setup-{#AppVersion}` (Phase 8), Registry-Autostart-Eintrag
  (`HKCU\...\Run`, `ValueName: "AirDeck"`), Windows-Firewall-Regelname `"AirDeck"`, geplanter Task
  `schtasks /TN "AirDeck"` (`Autostart-einrichten.cmd`) sowie die drei Verknüpfungsnamen
  (`IconStop`/`IconServer`/`IconManual` in `installer.iss`): alles von Windows bzw. dem Installer
  persistierte Kennungen. Eine Änderung würde bei einem Update entweder den Mechanismus selbst
  brechen (Registry-/Firewall-/Task-Eintrag wird beim Deinstallieren über denselben Namen entfernt)
  oder verwaiste Duplikate hinterlassen (umbenannte Verknüpfung neben der alten, die Inno Setup nicht
  automatisch löscht).
- `%LOCALAPPDATA%\AirDeck` (Fensterposition `fenster.txt`, WebView2-Nutzerdaten) sowie
  `%LOCALAPPDATA%\AirDeck\data` (echte Senderdaten, vom Installer wie von der Engine genutzt):
  bestehende Installationen haben dort bereits Daten – nicht blind verschoben (Entsprechung zu den
  Linux-Pfaden in Phase 7).
- Interne, nicht nutzersichtbare Bezeichner: `namespace AirDeck`, benannte Synchronisationsobjekte
  (`Mutex`/`EventWaitHandle`-Namen wie `"AirDeck.Studio.Window"`), `app.manifest`s
  `assemblyIdentity name="AirDeck.Studio"`.

**Geändert** (sichtbare Texte, keine Auswirkung auf Dateinamen/Update-Mechanismus):
- `AirDeck.csproj`: `Product`, `Description`, `Copyright` (sichtbar in Windows' Dateieigenschaften und
  Task-Manager) auf „AnMaCha Cast" umgestellt; `Company` war bereits korrekt.
- `Program.cs`/`MainForm.cs`/`Engine.cs`: Fenstertitel, Tray-Tooltip-Texte, Kontextmenü, alle
  MessageBox-/Balloon-Tip-Texte, Splash-Text, Kommentare.
- `packaging/windows/installer.iss`: `AppName`/`AppVerName`/`VersionInfoDescription`/
  `VersionInfoProductName`/`UninstallDisplayName` (reine Anzeigetexte, kein Dateibezug), der große
  Begrüßungs-Banner und sämtliche Assistenten-Seiten (Betriebsart, Netzwerk, Monitoring, Administrator,
  Komponentenübersicht, Datenspeicher, Bestätigung), alle Fehlermeldungen. Dabei „AirDeckCast" (altes
  Feature) konsequent zu „Zusatz-Streams" korrigiert (Phase-1-Konvention, hier übersehen). Component-
  Checkbox-Texte (`CompCore` usw.) und `RunNow` ebenfalls geändert – diese sind reine Textbeschriftungen
  ohne Dateinamenbezug. `IconStop`/`IconServer`/`IconManual` dagegen **bewusst unverändert** gelassen
  (siehe oben) und mit einem erklärenden Kommentar versehen.
- `AirDeck-Netzwerk.cmd`: `AIRDECK_HOST` → `ANMACHA_CAST_HOST` (neuer primärer Name aus Phase 3; altes
  `AIRDECK_HOST` funktioniert weiterhin als Fallback), Kommentarzeile.
- `AirDeck-Headless.cmd`, `Autostart-einrichten.cmd` (nur Kommentare, Aufgabenname bleibt), `LIESMICH.txt`,
  `installer/haftung.txt`: Prosa rebrandet, echte Dateinamen/Pfade (`AirDeck.exe`, `airdeck-engine.exe`,
  `%LOCALAPPDATA%\AirDeck\...`, Skriptnamen) unverändert gelassen.

**Tests:** `npm run typecheck` + volle Testsuite grün (235/0/6, unverändert – keine der .NET-/Installer-
Dateien wird vom Node-Test-Harness erfasst). Zusätzlich lokal mit `dotnet build
apps/windows/AirDeck.csproj -c Release` geprüft (das .NET-Framework-4.8-Ziel lässt sich dank
`EnableWindowsTargeting` auch unter Linux bauen) – **Build succeeded, 0 Warnings, 0 Errors**, bestätigt
die syntaktische Korrektheit aller C#-/csproj-Änderungen. `installer.iss` selbst kann in dieser Umgebung
nicht kompiliert werden (Inno Setup ist Windows-only); die Prüfung erfolgt über den `windows`-CI-Job der
PR.

## Phase 7: Linux/Docker/Packaging – sichtbare Texte, Legacy-Pfad-Kompatibilität

**Investigation zuerst**: `Dockerfile`, `docker-compose.yml`, `packaging/linux/` (Debian-Paket:
`control`, `*.service`, `postinst`/`prerm`/`postrm`, `copyright`), `packaging/demo/` (öffentliche
Dauer-Demo auf `airdeck-demo.ricorewi-radio.de`), sowie die in Phase 2 bewusst zurückgestellten
`docs/DOCKER.md`, `docs/DEPLOY.md`, `docs/STREAMING.md`.

**Bewusst unverändert** (reale, von Paketmanager/systemd/Docker/DNS persistierte Kennungen – eine
Änderung würde bestehende Installationen/die laufende Demo brechen oder Daten verwaist zurücklassen):
- Debian-Paketname `airdeck` (`control`), systemd-Diensteinheit `airdeck-server.service`,
  Dienstkonto/-gruppe `airdeck`, Pfade `/etc/airdeck`, `/var/lib/airdeck`, `/var/log/airdeck`,
  `/opt/airdeck`, Dateinamen `airdeck.conf`/`airdeck.db`. Ein Umbenennen des Paketnamens würde aus
  einem Update eine komplette Neuinstallation machen (kein `apt upgrade`-Pfad mehr); `ReadWritePaths`
  im Service, `postinst`/`postrm`s Purge-Logik und die CI-Prüfung aus Phase 1 hängen exakt an diesen
  Namen.
- `docker-compose.yml`: Service-/Container-/Volume-Namen (`airdeck`, `airdeck-postgres`,
  `airdeck-data`, `airdeck-pg`) sowie `AIRDECK_DB`/`AIRDECK_DB_URL`/`AIRDECK_DB_PASSWORD` (bereits in
  Phase 3 aus demselben Grund zurückgestellt) – eine Volume-Umbenennung würde bei bestehenden
  Installationen neue, leere Volumes anlegen statt die vorhandene Datenbank/Mediendaten
  weiterzuverwenden.
- `Dockerfile`/`Dockerfile.demo`: `ENV AIRDECK_DATA/AIRDECK_HOST/AIRDECK_PORT` bewusst nicht auf die
  neuen Namen umgestellt – ein im Image gebackener Default unter dem neuen Namen hätte in
  `envVar()` (Phase 3) **Vorrang** vor einem vom Nutzer per `docker run -e AIRDECK_PORT=...` gesetzten
  Legacy-Override und würde diesen so stillschweigend überschreiben.
- `packaging/demo/*`: Hostname `airdeck-demo.ricorewi-radio.de`, Icecast-Mount-Pfad
  `/airdeck-demo.mp3`, Container-/Service-/Volume-Namen. Der laufende Demo-Server hat DNS und ein
  Let's-Encrypt-Zertifikat bereits auf diese exakten Namen ausgestellt; eine Code-Änderung allein
  würde die öffentlich erreichbare Demo brechen (TLS-Validierung schlägt fehl, Proxy-Regeln laufen
  ins Leere). Eine echte Umstellung bräuchte einen neuen DNS-Eintrag und ein neues Zertifikat –
  externe, manuelle Schritte außerhalb dieses Repositories.

**Geändert** (sichtbare Texte/Beschreibungen ohne Auswirkung auf die obigen Kennungen):
- `control`s `Description:`, `airdeck-server.service`s `Description=` (beide rein informativ:
  `apt show`/`systemctl status`), `copyright`s `Upstream-Name:`, GECOS-Feld des Dienstkontos
  (`adduser --gecos`) – alles reine Anzeigetexte ohne technische Bindung an den Paket-/Kontonamen.
  Kommentare in allen `packaging/linux/*`-Skripten sowie der in `/etc/airdeck/airdeck.conf`
  geschriebene Kommentarkopf (nicht geparst, siehe gleiches Vorgehen in Phase 3/6).
  „AirDeckCast" konsequent zu „Zusatz-Streams" korrigiert, wo es in Prosa vorkam
  (`start-demo.sh`, `Dockerfile.demo`, `packaging/demo/README.md`).
- `packaging/demo/reset-demo.sh`: rein kosmetische Anzeigenamen der von der Demo selbst erzeugten
  Testinhalte (Sender „AirDeck-FM" → „AnMaCha-Cast-FM", Playlist-/Cardwall-/Stream-Profile-Namen) –
  diese sind API-Nutzinhalte ohne jede technische Bindung an Hostnamen/Pfade.
- `docs/DOCKER.md`, `docs/DEPLOY.md`: Fließtext rebrandet, dabei alle echten Container-/Volume-/
  Kontonamen, Pfade und Secret-Namen unverändert gelassen (gleiches Vorgehen wie `WORKFLOWS.md` in
  Phase 2) und jeweils ein erklärender Hinweis ergänzt, warum diese bleiben.
- `docs/STREAMING.md`: vollständig rebrandet (nur vier reine Prosa-Vorkommen, keine echten Namen
  betroffen).

**Bewusst noch zurückgestellt**: `docs/INSTALLATION.md` – der Großteil der verbleibenden
„AirDeck"-Vorkommen dort sind echte, aktuell noch gültige Release-Dateinamen
(`AirDeck-Setup.exe`, `AirDeck-Android.apk`, `AirDeck-Linux.deb` usw.) und reale Pfade
(`%LOCALAPPDATA%\AirDeck`), eng mit Prosa vermischt. Ein sinnvoller vollständiger Durchgang gehört
zusammen mit der tatsächlichen Artefakt-Umbenennung in Phase 8, damit die Dokumentation nie auf
einen noch nicht existierenden Dateinamen verweist (wie schon in Phase 2 bei `README.md` begründet).

**Tests:** `npm run typecheck` + volle Testsuite grün (235/0/6, unverändert – keine der geänderten
Dateien wird vom Node-Test-Harness erfasst). Alle geänderten Shell-Skripte zusätzlich mit `sh -n`
auf Syntaxfehler geprüft (alle fehlerfrei). `Dockerfile`/`docker-compose.yml`/`installer.iss`-
Äquivalente für Linux (echter `.deb`-Build, Docker-Image-Build) werden vom `linux`-/`docker`-/
`docker-arm64`-CI-Job dieser PR geprüft.

## Fehler und Behebungen (Phase 1)

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

## Phase 8: CI/CD-Workflows – Artefakt-/Release-Dateinamen

**Geändert** (`.github/workflows/build.yml`):
- `android`-Job: lokaler APK-Dateiname und `upload-artifact`-Name → `AnMaCha-Cast-Android` /
  `out/AnMaCha-Cast-Android.apk`.
- `windows`-Job: `download-artifact`-Referenz auf den Android-Job → `AnMaCha-Cast-Android`; alle drei
  `dist/AirDeck-Setup-*.exe`-Vorkommen (Build-Prüfung, Signierschleife, Installer-Test) →
  `dist/AnMaCha-Cast-Setup-*.exe`; `upload-artifact`-Namen → `AnMaCha-Cast-Windows-Installer`
  (Pfad `dist/AnMaCha-Cast-Setup-*.exe`) und `AnMaCha-Cast-Windows` (Pfad `dist/AirDeck` bewusst
  unverändert – das ist der reale, von `installer.iss`/`Program.cs` erzeugte Ordnername).
- `linux`-Job: `upload-artifact`-Name → `AnMaCha-Cast-Linux-Deb` (Pfad/Muster `dist/airdeck_*.deb`
  bewusst unverändert – realer `.deb`-Dateiname, der Paketname selbst bleibt laut Phase 7 `airdeck`).
- `release`-Job: `download-artifact`-Muster → `AnMaCha-Cast-*`; die `cp`/`mv`/`zip`-Befehle bauen die
  veröffentlichten Dateien jetzt als `AnMaCha-Cast-Setup.exe`, `AnMaCha-Cast-Windows-Portable.zip`
  (der intern gezippte Ordner heißt weiter `AirDeck`, siehe oben), `AnMaCha-Cast-Android.apk` und
  `AnMaCha-Cast-Linux.deb` (Quelle bleibt `airdeck_*.deb`); GitHub-Release-Titel →
  `AnMaCha Cast ${{ github.ref_name }}`; die Release-Notes (`body:`) nennen die vier neuen Dateinamen,
  `AirDeck.exe starten` bleibt unverändert (realer Binärname).

**Geändert** (`.github/workflows/release-health.yml`): alle vier erwarteten Release-Dateinamen,
die README-Downloadlink-Prüfungen und die rein kosmetischen Anzeigenamen in den
Health-Check-Meldungen (URLs selbst – echte DNS-Namen der Projektseite/Demo – bleiben unverändert).

**Geändert** (kosmetische Anzeigetexte in weiteren Workflows, ohne Auswirkung auf Branch-Namen,
Artefakt-Identität oder externe Endpunkte): Workflow-Titel `pages.yml` → „Deploy AnMaCha Cast Pages“,
Bot-Committer-Namen (`changelog.yml`, `release-badge.yml`, `release-screenshots.yml`,
`last-known-good.yml`) → „AnMaCha Cast CI“/„AnMaCha Cast Rollback“/„AnMaCha Cast Auto Rollback“,
PR-Beschreibungstext in `release-badge.yml`, SVG-`aria-label` des Versionsbadges, Job-Summary-Titel
in `parallel-change-guard.yml`, Prosa-Kommentar in `deploy.yml`. Die `CODENAME`-Parser-Regex in
`release-badge.yml` erkennt jetzt sowohl neue (`AnMaCha Cast …`) als auch historische
(`AirDeck …`) Release-Titel, damit ältere, bereits veröffentlichte Releases weiter korrekt geparst
werden.

**Bewusst unverändert** (in allen zehn Workflow-Dateien): der echte Git-Branchname
`AirDeck-Radio-Automation-&-Broadcast` (Branch-Trigger, `ref:`, `--base`/`--head` bei `gh pr create`,
`workflow_run.head_branch`-Vergleiche) – eine Umbenennung des Branches selbst ist ein eigener,
manueller GitHub-Schritt außerhalb dieses Rebrands (siehe Abschlussbericht) und hätte, vorzeitig im
Code vorweggenommen, alle Branch-Schutzregeln und laufenden PRs gegen diesen Branch gebrochen.

**Geändert** (Code): `src/server/update.ts` – `User-Agent: 'AirDeck-Updater'` → `'AnMaCha-Cast-Updater'`
(zwei Vorkommen), konsistent mit dem bereits in Phase 2 umbenannten `User-Agent` in
`src/server/services/remote-link.ts`. Die übrigen `User-Agent`-Strings im Projekt (`bridge.ts`,
`icecast.ts`, `icy.ts`, `lautfm.ts`, `nextcloud.ts`, `notify.ts`, `shoutcast.ts`, `stats.ts`,
`status.ts`, `ai/director.ts`) sind Kennungen, die gegenüber externen Diensten (laut.fm, Icecast/
SHOUTcast-Server, Webhook-Empfänger) gesendet werden bzw. ein dokumentiertes Webhook-Event-Header-
Präfix (`X-AirDeck-Event`) bilden – eine Umbenennung dieser deutlich breiteren Gruppe ist bewusst
nicht Teil von Phase 8 (CI/CD-Artefakte) und bräuchte eine eigene Prüfung, ob/welche dieser
Außenkontakte von einem reinen Text-Rename unberührt bleiben.

**Geändert** (`README.md`, `docs/INSTALLATION.md`): Downloadlinks/-Dateitabelle auf die neuen
`AnMaCha-Cast-*`-Namen umgestellt, nachdem die CI sie jetzt tatsächlich so erzeugt.
`docs/INSTALLATION.md` war in Phase 2 komplett zurückgestellt worden (siehe Begründung oben) und
wurde jetzt vollständig durchrebrandet: alle Fließtext-Vorkommen von „AirDeck“ als Produktname →
„AnMaCha Cast“, während alle echten, in Phase 6/7 bewusst unveränderten Kennungen (`AirDeck.exe`,
`airdeck-engine.exe`, `%LOCALAPPDATA%\AirDeck`, `airdeck.log`, Startmenü-Verknüpfung `AirDeck`,
Linux-Paketname/Dienst/Pfade `airdeck`/`airdeck-server`/`/etc/airdeck`/`/var/lib/airdeck`/
`/var/log/airdeck`) unverändert blieben und dort, wo das im Fließtext sonst missverständlich gewesen
wäre (Startmenü-Eintrag), ein erklärender Nebensatz ergänzt wurde.

**Tests:** `npm run typecheck` grün, volle Testsuite grün (235/0/6, unverändert – keine der
geänderten Dateien wird vom Node-Test-Harness erfasst). Alle zehn geänderten
`.github/workflows/*.yml`-Dateien zusätzlich mit `python3 -c "import yaml; yaml.safe_load(...)"`
auf syntaktische Gültigkeit geprüft (alle fehlerfrei). Die tatsächliche Artefakt-Kette (Android-APK
→ Windows-Download-Artefakt → Release-`cp`/`mv`/`zip`) wird erst durch einen echten CI-Lauf dieser
PR (inkl. `windows`-, `android`- und `linux`-Jobs) scharf geprüft; der `release`-Job selbst läuft nur
bei einem `v*`-Tag-Push und wird daher durch diese PR nicht ausgeführt, nur durch Lesen/Nachvollziehen
der Befehlskette verifiziert.
