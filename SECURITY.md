# AnMaCha Cast Security Policy

Sicherheit hat bei AnMaCha Cast besondere Bedeutung, weil die Software Benutzerkonten, Sender, Medien, Streaming-Zugangsdaten, externe Integrationen und Serverdienste verwalten kann.

## Sicherheitslücke melden

Bitte veröffentliche eine noch nicht behobene Sicherheitslücke **nicht mit Exploitdetails in einem öffentlichen GitHub Issue**.

Bevorzugt soll GitHubs Funktion **Private vulnerability reporting** verwendet werden, sofern sie für dieses Repository aktiviert ist. Ist keine private Meldemöglichkeit verfügbar, verwende einen offiziell vom AnMaCha Cast-Projekt veröffentlichten direkten Kontaktweg und kennzeichne die Nachricht eindeutig als Sicherheitsmeldung.

Bitte übermittle keine Passwörter, privaten Schlüssel oder produktiven Tokens, sofern sie für die Reproduktion nicht zwingend erforderlich sind. Verwende nach Möglichkeit Testdaten.

Eine gute Meldung enthält:

- betroffene AnMaCha Cast-Version bzw. Commit;
- betroffene Plattform;
- betroffene Komponente;
- nachvollziehbare Reproduktionsschritte;
- erwartetes und tatsächliches Verhalten;
- mögliche Auswirkung;
- relevante Logs oder Screenshots ohne Secrets;
- falls bekannt: mögliche Abhilfemaßnahme.

## Besonders sensible Bereiche

Dazu zählen insbesondere:

- Authentifizierung und Sessions;
- Rollen, Rechte und Sender-/Tenant-Grenzen;
- API-Endpunkte;
- Datei-Uploads und Pfadzugriffe;
- Medien-Preview und Downloads;
- Datenbanken und Migrationen;
- WebSockets/SSE;
- XSS, CSRF, CORS und SSRF;
- Shell-/Prozessaufrufe;
- Streaming-Credentials;
- Nextcloud-/Cloud-Zugänge;
- Installer und Systemdienste;
- Secrets, Tokens und Logs;
- Dependency-/Supply-Chain-Risiken.

## Umgang mit Meldungen

Eine Sicherheitsmeldung wird zunächst technisch bewertet. Bestätigte Schwachstellen sollen entsprechend ihrer Auswirkung priorisiert, behoben und anschließend getestet werden.

Sicherheitsprüfungen dürfen nicht entfernt oder abgeschwächt werden, nur um einen anderen Codepfad funktionsfähig zu machen.

Nach Möglichkeit wird bei einem Fix zusätzlich ein Regressionstest ergänzt.

## Unterstützte Versionen

AnMaCha Cast befindet sich noch in aktiver Entwicklung. Bis ein formales Supportfenster für stabile Releases veröffentlicht wird, konzentriert sich die Sicherheitswartung auf den aktuellen Entwicklungsstand und die jeweils aktuell freigegebene Version.

Ältere Builds können Fehler enthalten, die im aktuellen Stand bereits behoben wurden. Bei einer Meldung daher bitte immer Version oder Commit angeben.

## KI-generierter Code

KI-generierter oder KI-unterstützter Code unterliegt denselben Sicherheitsanforderungen wie jeder andere Beitrag. Eine Aussage eines Coding-Agenten, dass Code „sicher“ sei, ersetzt kein Review.

Siehe [`AI_HANDOVER.md`](AI_HANDOVER.md) und [`docs/architecture/SECURITY.md`](docs/architecture/SECURITY.md).

## Veröffentlichung

Bitte gib dem Projekt angemessene Zeit zur Analyse und Behebung, bevor technische Details einer noch ungepatchten Schwachstelle veröffentlicht werden.

Eine öffentliche Dokumentation behobener Sicherheitsprobleme kann später über Release Notes, Advisories oder andere geeignete Projektkanäle erfolgen.

## Scope

Diese Richtlinie gilt für den offiziellen AnMaCha Cast-Code und die vom AnMaCha Cast-Projekt veröffentlichten Builds. Unabhängige Forks, fremde Hosting-Angebote und nicht freigegebene Community-Builds werden von ihren jeweiligen Betreibern verantwortet.
