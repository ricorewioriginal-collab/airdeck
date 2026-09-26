# Git-Prüfung vom 27.09.2026

## Ergebnis

Der geprüfte Hauptbranch `AirDeck-Radio-Automation-&-Broadcast` zeigt auf
`784474b2e440599594d5f32f0661c01251004824`. Ein Rücksetzen ist nicht erforderlich.

- 181 erreichbare Commits, davon 53 nach dem ersten hier geprüften Stand `296b799`.
- Claudes Branchspitze `b1b924e` ist ein Vorfahr des Hauptbranches (47 Commits dahinter).
- Unser veröffentlichter P4-Commit `36440b0` ist ebenfalls enthalten.
- Failover-Ketten-Tiefenschutz (`5ea680e`) und Kamera-QR (`bc6043c`) sind enthalten.
- Neuere Installer-, Linux-, Demo- und Studio-Änderungen sind enthalten.

## Frühere Historie gesichert und verglichen

Der frühere Build 286 lief auf `2a5972ce77999429c34544169af1226347d5f394`.
Dieser Commit war nicht mehr über die aktuellen Branches erreichbar, ließ sich
aber von GitHub abrufen. Er wurde als `recovery/actions-build-286` gesichert.

Seine Historie enthält 194 Commits. 15 davon sind nicht als einzelne Commits im
heutigen Hauptbranch enthalten. Ihre Änderungen wurden in `6047d55` zusammengeführt.
Der direkte Dateivergleich zwischen dem früheren Stand und `784474b` zeigt nur
acht unterschiedliche Dateien: Workflow, Demo-Queue, Browser-Smoke, Screenshots,
Studio-HTML, App-JS, CSS und Navigationstest. Die Unterschiede sind nachfolgende
Navigation-/Responsive-/Test-/CI-Anpassungen; keine komplette Funktion oder Datei
wurde gegenüber diesem Referenzstand gelöscht. Die übrigen Dateien sind identisch.

Das ist eine Git-/Codebestandsprüfung, keine vollständige Funktionsabnahme.
Nicht gepushte Änderungen auf fremden Rechnern können hier nicht überprüft werden.

## Build und Release sind verschiedene Stände

- Letztes vorgefundenes Download-Release: `build-236`, Commit `143443e`.
- Fehlgeschlagener Actions-Build: 286, Commit `2a5972c`.
- Der neuere Hauptbranch ist kein bereits vollständig gebautes Download-Release.
- Deploy auf `784474b` war erfolgreich; das beweist keinen erfolgreichen Build.

## Reproduzierbarer Build-Blocker

Im Log von Run `36275828974` scheiterte genau einer von 194 Tests:
`test/studio-http-workflows.test.ts`, beim Queue-Verschieben: `204 !== 200`.
Der Fehler besteht auch im aktuellen Hauptbranch und wurde lokal reproduziert.

Die Route liefert absichtlich keinen Body und deshalb HTTP 204. Der Test erwartet
jetzt 204 und prüft weiterhin anschließend über GET die tatsächlich geänderte
Reihenfolge. Anschließend kam eine zweite falsche Testannahme zum Vorschein:
AutoFill ergänzt nach `queue/next` weitere Titel, obwohl der Test genau einen
verbleibenden Eintrag erwartet. Für diesen manuellen Queue-Test wird AutoFill
jetzt über die echte PATCH-API ausgeschaltet. Die gesonderten AutoFill-Tests bleiben.

Validierung: 12 Tests für HTTP-Studio-Workflow, Navigation, Playlist/Sendeplan und
Ausgangs-/Profilverwaltung bestanden, keine übersprungen. Server- und
Studio-Typprüfung bestanden. Der Build-Workflow besteht actionlint; die gesamte
Release-Pipeline wurde lokal nicht ausgeführt. Die zuvor dokumentierten Windows-
Regressionsprobleme sind nicht Gegenstand dieses kleinen CI-Reparaturpakets.

## Sicherungen

Vor Änderungen wurden ein geprüftes Git-Bundle und ein Patch der lokalen, noch
nicht veröffentlichten P4-Arbeiten angelegt. Diese Arbeiten liegen zusätzlich
im lokalen Git-Stash `P4 local fixes preserved before recovery audit`.
Keine Historie wurde zurückgesetzt oder zwangsweise überschrieben.
