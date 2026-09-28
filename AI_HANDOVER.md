# AirDeck – AI Development Guidelines

> Leitfaden für den verantwortungsvollen Einsatz von KI-Werkzeugen bei der Entwicklung von AirDeck.

AirDeck darf mit Unterstützung von Coding-Assistenten und KI-Agenten weiterentwickelt werden. Diese Datei schreibt **keinen bestimmten Anbieter, kein bestimmtes Modell und keinen reservierten Arbeitsbereich** vor. Sie beschreibt Empfehlungen, Qualitätsanforderungen und den Umgang mit KI-generierten Änderungen.

Geeignete Werkzeuge können beispielsweise Coding-Assistenten, lokale Modelle, Cloud-Agenten, IDE-Assistenten oder andere automatisierte Entwicklungswerkzeuge sein. Welches Werkzeug verwendet wird, ist zweitrangig. Entscheidend ist die Qualität des Ergebnisses.

## Grundsatz

**KI ist ein Entwicklungswerkzeug, kein Ersatz für menschliche Prüfung.**

KI-generierter Code kann unter anderem:

- logisch falsch sein,
- nur teilweise funktionieren,
- bestehende Funktionen beschädigen,
- Sicherheitslücken erzeugen,
- Randfälle übersehen,
- APIs oder Bibliotheken falsch verwenden,
- nicht vorhandene Funktionen erfinden,
- veraltete Architekturannahmen verwenden,
- Tests bestehen und trotzdem im realen Betrieb fehlerhaft sein.

Deshalb darf eine KI-Aussage wie „fertig“, „funktioniert“, „sicher“ oder „getestet“ niemals ungeprüft als Nachweis übernommen werden.

## Vor der Arbeit

Unabhängig vom verwendeten Werkzeug zuerst den aktuellen Repository-Stand prüfen:

```bash
git fetch
git status
git branch --show-current
git log -1 --oneline
```

Danach mindestens lesen bzw. berücksichtigen:

- `README.md` für Projekt und aktuellen öffentlichen Überblick,
- `CONTRIBUTING.md` für Entwicklungsregeln,
- `docs/architecture/` für verbindliche technische Architektur,
- die für die konkrete Änderung relevanten Quell- und Testdateien.

Nicht blind auf ältere Prompts, Chatverläufe, ZIP-Handover oder KI-Zusammenfassungen vertrauen. **Der aktuelle Code und die aktuelle technische Dokumentation haben Vorrang.**

## Empfohlener Umgang mit KI

KI eignet sich besonders für:

- Analyse bestehender Komponenten,
- Vorschläge für Implementierungen,
- klar abgegrenzte Feature-Arbeiten,
- Refactoring mit Tests,
- Testfall-Erstellung,
- Dokumentationsentwürfe,
- Fehlersuche,
- Code-Review als zusätzliche Prüfebene,
- repetitive Entwicklungsaufgaben.

Große Änderungen möglichst in nachvollziehbare Teilaufgaben zerlegen. Das erleichtert Review, Tests, Fehlersuche und Rücknahme fehlerhafter Änderungen.

## Bestehende Architektur respektieren

Vor dem Erstellen neuer Komponenten prüfen, ob AirDeck bereits eine passende Implementierung besitzt.

Insbesondere nicht ohne technische Begründung ein zweites oder paralleles System für folgende Bereiche erzeugen:

- Authentifizierung,
- Benutzer und Rollen,
- Senderverwaltung,
- Persistenz/Datenbanken,
- Mediathek,
- MusikHub,
- Automation,
- Sendeplanung,
- Queue/Playout,
- Streaming,
- Secrets,
- Events/SSE/WebSockets.

KI neigt dazu, fehlenden Kontext durch neue Strukturen zu ersetzen. Bei AirDeck soll stattdessen grundsätzlich die vorhandene Architektur erweitert werden.

## Keine erfundenen Funktionen oder Daten

KI-generierte Oberflächen dürfen keinen falschen Betriebszustand vortäuschen.

Nicht als fertige Funktion akzeptieren:

- Fake-Hörerzahlen,
- statisches `ON AIR` ohne echten Serverstatus,
- erfundene Titel oder Statistiken,
- Buttons ohne funktionierende Aktion,
- Mock-APIs im produktiven Pfad,
- Platzhalterdaten, die wie echte Daten aussehen,
- simulierte Erfolgszustände nach fehlgeschlagenen Operationen.

Wenn eine Capability noch fehlt, einen ehrlichen Empty-, Disabled- oder Unavailable-State verwenden.

## Menschliche Funktionsprüfung

Nach KI-generierten Änderungen muss ein Mensch die betroffenen Kernfunktionen nachvollziehbar prüfen, bevor eine Änderung als produktionsreif oder offiziell freigegeben gilt.

Je nach Änderung gehören dazu beispielsweise:

- Anwendung tatsächlich starten,
- betroffene Seite/Funktion öffnen,
- typische Benutzerabläufe durchführen,
- Fehlerfälle testen,
- Browser-/Serverkonsole prüfen,
- API-Antworten prüfen,
- Senderwechsel testen,
- Login/Logout und Berechtigungen prüfen,
- Streaming-/Audiofunktionen real testen,
- Persistenz nach Neustart prüfen,
- Update-/Migrationspfade prüfen,
- Desktop/mobile Darstellung prüfen.

Automatisierte Tests ergänzen diese Prüfung, ersetzen sie bei kritischen Betriebsfunktionen aber nicht vollständig.

## Bugs

Wenn durch eine KI-Änderung ein Bug entsteht oder entdeckt wird:

1. Ursache nachvollziehen,
2. nicht nur das sichtbare Symptom kaschieren,
3. betroffene angrenzende Funktionen prüfen,
4. Fix implementieren,
5. wenn sinnvoll einen Regressionstest ergänzen,
6. ursprünglichen Fehlerablauf erneut testen.

Keine Fehler einfach durch das Entfernen einer Sicherheitsprüfung, Validierung oder Fehlermeldung „lösen“.

## Sicherheit

KI-generierter Code muss genauso kritisch geprüft werden wie Code unbekannter Herkunft.

Besonders prüfen:

- Authentifizierung und Session-Handling,
- RBAC und Sender-/Tenant-Grenzen,
- Autorisierung jedes sensiblen Endpunkts,
- Datei- und Pfadzugriffe,
- Uploads,
- Download- und Preview-Rechte,
- SQL/DB-Zugriffe,
- Command-/Shell-Aufrufe,
- SSRF und externe URLs,
- XSS/HTML-Ausgabe,
- CSRF soweit relevant,
- CORS,
- WebSockets/SSE,
- Secrets und Tokens,
- Logs mit sensiblen Informationen,
- Nextcloud-/Cloud-Zugänge,
- Streaming-Credentials,
- Installer-/Service-Rechte,
- Dependency- und Supply-Chain-Risiken.

Entdeckte Sicherheitslücken sollen nicht lediglich dokumentiert und liegen gelassen werden. Sie müssen entsprechend ihrer Auswirkung priorisiert, geschlossen und anschließend getestet werden.

Sicherheitsrelevante Prüfungen dürfen nicht entfernt oder abgeschwächt werden, nur damit ein KI-generierter Codepfad funktioniert.

Siehe auch `docs/architecture/SECURITY.md`.

## Datenschutz und Secrets

Keine echten Zugangsdaten in KI-Prompts, Screenshots, Commits, Testfixtures oder Dokumentation übernehmen.

Dazu zählen insbesondere:

- Passwörter,
- API-Tokens,
- Session-Tokens,
- SSH-Schlüssel,
- Datenbankzugänge,
- Streaming-Passwörter,
- Cloud-/Nextcloud-Credentials,
- private Schlüssel.

Referenzscreenshots und Handover-Dateien können sensible Daten enthalten. Solche Inhalte vor Weitergabe an externe Systeme prüfen bzw. anonymisieren.

Wenn versehentlich ein Secret veröffentlicht wurde, reicht das Entfernen aus dem aktuellen Code nicht aus: das Secret muss grundsätzlich als kompromittiert behandelt und rotiert werden.

## Abhängigkeiten und fremder Code

KI darf nicht ungeprüft fremden Code, Bibliotheken oder Assets in AirDeck übernehmen.

Vor Aufnahme prüfen:

- Herkunft,
- Lizenz,
- Wartungszustand,
- Sicherheitsrisiken,
- technische Notwendigkeit,
- Kompatibilität mit der AirDeck-Lizenz.

Keine unbekannten Codeblöcke aus fremden Projekten übernehmen, nur weil ein KI-System sie vorgeschlagen hat.

Referenzprojekte wie AzuraCast, laut.fm-/Radioadmin-Oberflächen oder andere Systeme dienen zur Analyse von Konzepten und Workflows; ihre Implementierungen oder geschützten Assets werden nicht einfach kopiert.

## Kennzeichnung KI-unterstützter Änderungen

Transparenz ist erwünscht, ohne jeden einzelnen Codeabschnitt mit Kommentaren zu überladen.

Wenn KI einen wesentlichen Anteil an einer Änderung hatte, soll dies im Pull Request oder in der Entwicklungsübergabe angegeben werden.

Empfohlene Kennzeichnung:

```text
AI-assisted: yes
Tool/Agent: <optional>
Human-reviewed: yes/no
Automated tests: <tests>
Manual verification: <durchgeführte Prüfung>
Security review: yes/no/not applicable
```

Bei kleinen Hilfen wie Autovervollständigung muss nicht jede einzelne Zeile als KI-generiert markiert werden.

Entscheidend ist, dass bei wesentlichen KI-generierten Features nachvollziehbar bleibt, **ob ein Mensch die Änderung tatsächlich geprüft hat**.

## Commit- und PR-Empfehlung

Eine KI sollte möglichst nicht große, thematisch unabhängige Änderungen in einen einzigen Commit mischen.

Empfohlen:

- ein klarer Zweck pro Arbeitsblock,
- verständliche Commit-Nachricht,
- relevante Tests,
- Beschreibung bekannter Einschränkungen,
- Kennzeichnung wesentlicher KI-Unterstützung,
- keine Behauptung einer manuellen Prüfung, wenn diese nicht stattgefunden hat.

Vor Push/PR erneut:

```bash
git fetch
git status
git log --oneline -5
```

Kein Force-Push auf gemeinsam genutzte Entwicklungsbranches und keine fremden Änderungen ungeprüft überschreiben.

## Qualitätsstatus

Für AirDeck werden folgende Aussagen unterschieden:

### Implementiert
Code wurde geschrieben bzw. geändert.

### Automatisiert getestet
Die relevanten automatisierten Tests wurden ausgeführt und bestanden.

### Manuell getestet
Ein Mensch hat die betroffene Funktion tatsächlich ausgeführt und den relevanten Ablauf geprüft.

### Live verifiziert
Die Funktion wurde unter einer realistischen bzw. tatsächlichen Betriebsumgebung erfolgreich geprüft.

### Security-reviewed
Die sicherheitsrelevanten Auswirkungen der Änderung wurden gezielt geprüft.

Diese Begriffe nicht gleichsetzen. Ein KI-Agent kann Code implementieren und automatisierte Tests ausführen; dadurch ist die Funktion noch nicht automatisch manuell oder live verifiziert.

## Empfehlungen für KI-Reviews

Eine zweite KI kann als zusätzliche Review-Ebene hilfreich sein, beispielsweise um:

- potenzielle Bugs zu suchen,
- fehlende Tests zu identifizieren,
- Sicherheitsprobleme zu finden,
- Architekturabweichungen aufzudecken,
- unnötige Komplexität zu erkennen.

Ein zweites KI-Modell ist jedoch ebenfalls keine menschliche Freigabe und kann denselben Fehler übersehen oder neue falsche Annahmen treffen.

## Offizielle Freigabe

KI-generierter oder KI-unterstützter Code erhält keine Sonderstellung. Für die Aufnahme in offizielle AirDeck-Builds gelten dieselben Review-, Test-, Lizenz- und Maintainer-Regeln wie für jeden anderen Beitrag.

Die Freigabe eines offiziellen Builds oder Releases erfolgt durch den Maintainer nach Prüfung des jeweiligen Entwicklungsstands.

## Dokumentation

KI darf Dokumentation erstellen und aktualisieren. Technische Aussagen müssen jedoch gegen den aktuellen Code geprüft werden.

Keine parallelen Wahrheitsquellen erzeugen:

- `README.md` – öffentliche Projektübersicht, Status, Demo, Screenshots und Downloads,
- GitHub Wiki – Benutzerhandbuch,
- `docs/architecture/` – verbindliche technische Architektur,
- weitere `docs/` – notwendige code-nahe Spezifikationen,
- Issues/Projects – Bugs und geplante Aufgaben,
- Releases – veröffentlichte Versionen und Release Notes.

Diese Datei ist ein **allgemeiner KI-Entwicklungsleitfaden** und keine laufende Aufgabenliste.

## Kurzcheck vor einer offiziellen Freigabe

- [ ] Änderung gegen aktuellen Git-Stand geprüft
- [ ] Architektur eingehalten
- [ ] keine Fake-/Mock-Funktion als produktiv ausgegeben
- [ ] automatisierte Tests ausgeführt
- [ ] relevante Funktion menschlich geprüft
- [ ] bekannte Bugs behoben oder transparent als nicht freigabefähig behandelt
- [ ] sicherheitsrelevante Auswirkungen geprüft
- [ ] bekannte Sicherheitslücken geschlossen
- [ ] keine Secrets enthalten
- [ ] neue Abhängigkeiten/Lizenzen geprüft
- [ ] Dokumentation aktualisiert
- [ ] wesentliche KI-Unterstützung im PR/Review kenntlich gemacht
- [ ] offizieller Release erst nach Maintainer-Freigabe

---

**Leitsatz:** KI kann AirDeck schneller weiterentwickeln. Verantwortung für Funktion, Sicherheit, Qualität und Veröffentlichung bleibt beim Menschen.
