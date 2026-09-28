# Mitwirken an AirDeck

Danke für dein Interesse an **AirDeck – Radio Automation & Live Broadcast**.

AirDeck wird aktiv weiterentwickelt. Beiträge sollen sich in die bestehende Architektur einfügen, reale Funktionen erweitern und durch Tests abgesichert sein. Bitte keine parallelen Ersatzsysteme, Mock-Funktionen oder erfundenen Betriebsdaten als fertige Features einreichen.

> **Vor dem Start:** Lies die [`README.md`](README.md) für Projektstatus und Funktionsüberblick. Die verbindlichen technischen Grundlagen liegen unter [`docs/architecture/`](docs/architecture/). Das GitHub Wiki ist für Benutzerhandbuch und Bedienungsdokumentation vorgesehen. `AI_HANDOVER.md` dient ausschließlich der Koordination von Coding-Agents und ist keine technische Spezifikation.

## Entwicklungsbranch

Die laufende AirDeck-Entwicklung findet derzeit auf folgendem Branch statt:

```text
AirDeck-Radio-Automation-&-Broadcast
```

Vor Änderungen immer den aktuellen Remote-Stand holen und sicherstellen, dass keine fremden Änderungen überschrieben werden.

## Entwicklungsumgebung

```bash
git clone https://github.com/ricorewioriginal-collab/anmacha_control.git
cd anmacha_control
git checkout 'AirDeck-Radio-Automation-&-Broadcast'
npm ci
npm run check
npm start
```

Die tatsächlich benötigte Node.js-Version und weitere Laufzeitvoraussetzungen ergeben sich aus dem aktuellen Repository, insbesondere `package.json`, CI-Workflows und der technischen Installationsdokumentation. Bitte Versionsangaben nicht aus älteren Dokumenten übernehmen.

Für Broadcast-/Playout-Tests kann zusätzlich FFmpeg erforderlich sein.

## Architektur

AirDeck ist kein einzelnes statisches Web-Frontend. Änderungen müssen die bestehende Trennung von Core, Server, Persistenz, Diensten, Studio und Plattformpaketen respektieren.

Wichtige Bereiche:

| Bereich | Ort | Zweck |
|---|---|---|
| Core | `src/core/` | zentrale, möglichst I/O-unabhängige Radio-/Automation-Logik |
| Server | `src/server/` | Laufzeit, APIs, Streaming, Integrationen und Dienste |
| Datenhaltung | `src/server/db/`, `src/server/repo/` | Datenbanken, Migrationen und Repository-Schicht |
| Studio | `studio/` | AirDeck-Weboberfläche und Studio-Ansichten |
| Android | `apps/android/` | mobile AirDeck-Anwendung |
| Windows | `packaging/windows/` | Windows-Paketierung und Installer |
| Tests | `test/` | automatisierte Tests und Integrationsprüfungen |
| Architektur | `docs/architecture/` | verbindliche technische Spezifikationen |

Die kanonische Architektur ist [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md). Alte oder widersprüchliche Dokumente dürfen nicht als Grundlage für neue Architekturentscheidungen verwendet werden.

## Vor einer neuen Funktion

Prüfe zuerst, ob AirDeck bereits ein passendes System besitzt.

Insbesondere keine zweite oder parallele Implementierung für:

- Authentifizierung und Benutzer,
- Rollen und Berechtigungen,
- Senderverwaltung,
- Mediathek oder MusikHub,
- Automation und Planung,
- Queue/Playout,
- Streaming-Ausgänge,
- Persistenz oder Datenbanken,
- Secrets,
- Events/SSE.

Bestehende Komponenten werden erweitert statt ersetzt, sofern keine ausdrücklich dokumentierte Migration vorgesehen ist.

## Studio / UI

Die Oberfläche ist Teil des realen AirDeck-Systems und darf keine Betriebszustände vortäuschen.

Daher:

- keine Fake-Hörerzahlen,
- kein statisches `ON AIR`, wenn der Serverzustand etwas anderes meldet,
- keine funktionslosen Buttons als vermeintlich fertige Features,
- keine Mock-Titel oder Mock-Statistiken im produktiven UI,
- keine zweite unabhängige Studio-Oberfläche neben der bestehenden Anwendung.

Wenn eine Backend-Fähigkeit noch fehlt, muss die Oberfläche einen ehrlichen Empty-/Unavailable-State anzeigen.

Bei UI-Änderungen bestehende Event-Listener, IDs, API-Aufrufe, SSE/WebSocket-Verbindungen, Player, Dialoge, Formulare und Senderkontext mitprüfen.

## Sicherheit

- Keine Passwörter, Tokens, API-Keys oder anderen Secrets committen.
- Keine Zugangsdaten aus Screenshots oder Referenzmaterial übernehmen.
- Eingaben und Pfade serverseitig validieren.
- Neue Endpunkte müssen in das bestehende Auth-/RBAC-/Scope-Modell integriert werden.
- Private Medien und Metadaten dürfen nicht über Suche, Counts, Cover, Collections, Events oder Downloads an unberechtigte Benutzer leaken.
- Berechtigungen wie Preview, Download und Broadcast nicht automatisch gleichsetzen.

Siehe auch [`docs/architecture/SECURITY.md`](docs/architecture/SECURITY.md).

## Datenbank und Persistenz

Keine neue Persistenz neben der bestehenden Datenbankschicht einführen, nur weil sie für einen einzelnen Feature-Block einfacher erscheint.

Neue persistente Daten gehören in die vorhandene DB-/Repository-Architektur einschließlich sauberer Migrationen und Tests.

Siehe [`docs/architecture/DATABASE.md`](docs/architecture/DATABASE.md).

## Integrationen

Externe Dienste wie Nextcloud, Icecast oder Provider-/Radio-Plattformen werden als klar abgegrenzte Integrationen behandelt.

- Keine API-Funktion allein aus Screenshots erraten.
- Externe Providerdaten validieren.
- Fehler und Nichtverfügbarkeit sauber behandeln.
- AirDeck-interne Berechtigungen bleiben maßgeblich.
- Nextcloud oder andere Storage-Anbieter ersetzen nicht AirDecks Benutzer-/Rechtesystem.

## Tests

Vor einem Commit mindestens:

```bash
npm run check
```

Zusätzlich die für den geänderten Bereich relevanten Tests ausführen.

Eine Änderung gilt nicht allein deshalb als fertig, weil der Code kompiliert. In Dokumentation und Pull Requests sauber unterscheiden zwischen:

- implementiert,
- automatisiert getestet,
- manuell getestet,
- live verifiziert.

Bei UI-Änderungen zusätzlich die betroffenen Ansichten tatsächlich öffnen und auf Browserfehler prüfen.

## Dokumentation

AirDeck trennt Dokumentation bewusst nach Zweck:

- `README.md` – öffentliche Projektübersicht, Status, Screenshots, Demo und Downloads
- GitHub Wiki – Benutzerhandbuch und ausführliche Bedienungsdokumentation
- `docs/architecture/` – verbindliche technische Architektur
- weitere `docs/` – code-nahe technische Spezifikationen und vorübergehend notwendige Entwicklungsnachweise
- `AI_HANDOVER.md` – kurze Übergabe zwischen Coding-Agents
- GitHub Releases – veröffentlichte Builds und Release Notes
- Issues/Projects – Bugs, Aufgaben und Planung

Bitte keine neue `*_PROGRESS.md`, `*_REMAINING.md` oder ähnliche parallele Statusdatei anlegen, wenn dieselbe Information sinnvoll in Issues/Projects, `AI_HANDOVER.md`, einer vorhandenen Spezifikation oder einem Release gepflegt werden kann.

## Parallel arbeitende Agents

Am Repository können gleichzeitig Menschen und Coding-Agents arbeiten.

Vor Beginn und vor dem Push daher mindestens:

```bash
git fetch
git status
git log --oneline -5
```

Kein Force-Push auf gemeinsam genutzte Entwicklungsbranches. Keine fremden Änderungen zurücksetzen. Wenn ein Bereich in `AI_HANDOVER.md` ausdrücklich für einen anderen Agent reserviert ist, dort nicht parallel umbauen.

## Commits und Pull Requests

Bevorzugt kleine, nachvollziehbare Commits mit klarer Aufgabe.

Ein Pull Request bzw. eine Übergabe sollte kurz angeben:

1. Was wurde geändert?
2. Warum war die Änderung notwendig?
3. Welche Hauptdateien wurden geändert?
4. Welche Tests wurden ausgeführt?
5. Was wurde nur implementiert und was tatsächlich manuell/live verifiziert?
6. Gibt es bekannte Einschränkungen oder Folgearbeiten?

Keine unrelated Nebenänderungen in einen Feature-Commit mischen.

## Builds und Releases

Die GitHub-Actions-Workflows prüfen mehrere AirDeck-Ziele. Änderungen an Packaging-, Installer- oder Release-Workflows benötigen besondere Sorgfalt, weil sie Windows, Linux, Docker, Android oder Demo-Builds beeinflussen können.

Ein grüner lokaler Test ersetzt nicht die CI. Umgekehrt sollten Workflows nicht auf Verdacht umgebaut werden, wenn nur ein einzelner Plattformjob fehlschlägt – zuerst den konkreten fehlgeschlagenen Job und dessen Log untersuchen.

## Lizenz und Hinweise

Beachte die im Repository enthaltenen Lizenz-, Haftungs- und Rechtshinweise. Beiträge dürfen keine fremden Zugangsdaten, proprietären Referenzdateien oder Inhalte enthalten, für die keine ausreichenden Rechte vorliegen.
