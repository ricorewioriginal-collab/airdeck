# Mitwirken an AnMaCha Cast

Danke für dein Interesse an **AnMaCha Cast – Radio Automation & Live Broadcast**.

AnMaCha Cast wird aktiv weiterentwickelt. Beiträge sollen sich in die bestehende Architektur einfügen, reale Funktionen erweitern und durch Tests abgesichert sein. Bitte keine parallelen Ersatzsysteme, Mock-Funktionen oder erfundenen Betriebsdaten als fertige Features einreichen.

> **Vor dem Start:** Lies die [`README.md`](README.md) für Projektstatus und Funktionsüberblick. Die verbindlichen technischen Grundlagen liegen unter [`docs/architecture/`](docs/architecture/). Das GitHub Wiki ist für Benutzerhandbuch und Bedienungsdokumentation vorgesehen. `AI_HANDOVER.md` dient ausschließlich der Koordination von Coding-Agents und ist keine technische Spezifikation.

## Lizenz zuerst lesen

AnMaCha Cast steht unter der projektspezifischen [`AnMaCha Cast Source Available License`](LICENSE).

Kurz gesagt:

- normale AnMaCha Cast-Nutzung und eigener Betrieb sind unter den Lizenzbedingungen kostenlos;
- AnMaCha Cast darf studiert, geklont, geforkt und verändert werden;
- eigene Radioeinnahmen lösen nicht allein deshalb eine Umsatzbeteiligung aus;
- kostenpflichtiges AnMaCha Cast-Hosting, AnMaCha Cast-SaaS, AnMaCha Cast-Abos, Reselling oder White Label für Dritte benötigen vorab eine gesonderte Commercial Hosting License;
- bei Weitergabe gelten die vorgeschriebenen Urheber- und Lizenzhinweise;
- inoffizielle Forks dürfen nicht als offizielle AnMaCha Cast-Releases dargestellt werden.

Siehe auch [`COMMERCIAL.md`](COMMERCIAL.md) und [`BRANDING.md`](BRANDING.md).

## Eigenständig entwickeln – offizielle Freigabe durch den Maintainer

Entwickler können das Projekt klonen oder forken und Änderungen eigenständig auf einem eigenen Branch entwickeln und testen.

Empfohlener Ablauf:

```text
Fork / Clone
   ↓
eigener Feature-Branch
   ↓
entwickeln + testen
   ↓
Pull Request an AnMaCha Cast
   ↓
CI + Review
   ↓
Freigabe durch den Maintainer
   ↓
Merge
   ↓
offizieller Build / versioniertes Release
```

Ein Fork, Commit oder Pull Request wird **nicht automatisch** Bestandteil des offiziellen AnMaCha Cast-Projekts. Die Aufnahme in einen offiziellen Build oder ein versioniertes Release erfolgt erst nach ausdrücklicher Prüfung und Freigabe durch den AnMaCha Cast-Maintainer.

Community-Entwickler können ihre Arbeit unabhängig weiterführen; solange sie nicht offiziell freigegeben wurde, muss eine mögliche Verwechslungsgefahr mit einem offiziellen AnMaCha Cast-Build vermieden werden.

## Entwicklungsbranch

Die laufende AnMaCha Cast-Entwicklung findet derzeit auf folgendem Branch statt:

```text
AnMaCha Cast-Radio-Automation-&-Broadcast
```

Vor Änderungen immer den aktuellen Remote-Stand holen und sicherstellen, dass keine fremden Änderungen überschrieben werden.

## Entwicklungsumgebung

```bash
git clone https://github.com/ricorewioriginal-collab/anmacha_cast.git
cd airdeck
git checkout 'AnMaCha Cast-Radio-Automation-&-Broadcast'
npm ci
npm run check
npm start
```

Die tatsächlich benötigte Node.js-Version und weitere Laufzeitvoraussetzungen ergeben sich aus dem aktuellen Repository, insbesondere `package.json`, CI-Workflows und der technischen Installationsdokumentation. Bitte Versionsangaben nicht aus älteren Dokumenten übernehmen.

Für Broadcast-/Playout-Tests kann zusätzlich FFmpeg erforderlich sein.

## Architektur

AnMaCha Cast ist kein einzelnes statisches Web-Frontend. Änderungen müssen die bestehende Trennung von Core, Server, Persistenz, Diensten, Studio und Plattformpaketen respektieren.

Wichtige Bereiche:

| Bereich | Ort | Zweck |
|---|---|---|
| Core | `src/core/` | zentrale, möglichst I/O-unabhängige Radio-/Automation-Logik |
| Server | `src/server/` | Laufzeit, APIs, Streaming, Integrationen und Dienste |
| Datenhaltung | `src/server/db/`, `src/server/repo/` | Datenbanken, Migrationen und Repository-Schicht |
| Studio | `studio/` | AnMaCha Cast-Weboberfläche und Studio-Ansichten |
| Android | `apps/android/` | mobile AnMaCha Cast-Anwendung |
| Windows | `packaging/windows/` | Windows-Paketierung und Installer |
| Tests | `test/` | automatisierte Tests und Integrationsprüfungen |
| Architektur | `docs/architecture/` | verbindliche technische Spezifikationen |

Die kanonische Architektur ist [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md). Alte oder widersprüchliche Dokumente dürfen nicht als Grundlage für neue Architekturentscheidungen verwendet werden.

## Vor einer neuen Funktion

Prüfe zuerst, ob AnMaCha Cast bereits ein passendes System besitzt.

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

Die Oberfläche ist Teil des realen AnMaCha Cast-Systems und darf keine Betriebszustände vortäuschen.

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
- AnMaCha Cast-interne Berechtigungen bleiben maßgeblich.
- Nextcloud oder andere Storage-Anbieter ersetzen nicht das Benutzer-/Rechtesystem von AnMaCha Cast.

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

AnMaCha Cast trennt Dokumentation bewusst nach Zweck:

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
7. Soll die Änderung für einen offiziellen AnMaCha Cast-Build vorgeschlagen werden?

Keine unrelated Nebenänderungen in einen Feature-Commit mischen.

### Maintainer-Freigabe

Nur der Maintainer entscheidet im offiziellen Projekt über:

- Annahme/Merge eines Beitrags;
- Aufnahme in einen offiziellen AnMaCha Cast-Build;
- Versionsnummer und Release-Zuordnung;
- Kennzeichnung als offiziell unterstützt;
- Veröffentlichung über die offiziellen AnMaCha Cast-Releasekanäle.

## Beiträge und Nutzungsrechte

Beitragende behalten grundsätzlich ihre Rechte an ihren eigenen Beiträgen, soweit keine gesonderte Vereinbarung etwas anderes bestimmt.

Da AnMaCha Cast sowohl kostenlos bereitgestellt als auch künftig unter zusätzlichen kommerziellen Bedingungen angeboten werden kann, kann für bestimmte Beiträge vor der Aufnahme eine zusätzliche Contributor-Vereinbarung erforderlich werden. Reiche nur Inhalte ein, für die du die erforderlichen Rechte besitzt.

Ein Pull Request darf keine Lizenzbedingungen enthalten, die AnMaCha Cast daran hindern würden, den Beitrag innerhalb des bestehenden AnMaCha Cast-Lizenz- und Distributionsmodells zu verwenden.

## Builds und Releases

Die GitHub-Actions-Workflows prüfen mehrere AnMaCha Cast-Ziele. Änderungen an Packaging-, Installer- oder Release-Workflows benötigen besondere Sorgfalt, weil sie Windows, Linux, Docker, Android oder Demo-Builds beeinflussen können.

Ein grüner lokaler Test ersetzt nicht die CI. Umgekehrt sollten Workflows nicht auf Verdacht umgebaut werden, wenn nur ein einzelner Plattformjob fehlschlägt – zuerst den konkreten fehlgeschlagenen Job und dessen Log untersuchen.

## Lizenz und Hinweise

Beachte [`LICENSE`](LICENSE), [`COMMERCIAL.md`](COMMERCIAL.md), [`BRANDING.md`](BRANDING.md) sowie die weiteren im Repository enthaltenen Haftungs- und Rechtshinweise.

Beiträge dürfen keine fremden Zugangsdaten, proprietären Referenzdateien oder Inhalte enthalten, für die keine ausreichenden Rechte vorliegen.
