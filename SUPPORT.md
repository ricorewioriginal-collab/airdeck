# AnMaCha Cast Support

Diese Seite erklärt, welcher GitHub-Kanal für welches Anliegen gedacht ist.

## Bug gefunden?

Nutze den strukturierten **Bug Report** unter GitHub Issues.

Bitte gib mindestens AnMaCha Cast-Version bzw. Commit, Plattform, betroffenen Bereich, Reproduktionsschritte sowie erwartetes und tatsächliches Verhalten an.

Vor dem Absenden bitte prüfen, ob bereits ein passendes Issue existiert.

## Feature oder Verbesserung vorschlagen?

Nutze das **Feature Request**-Template. Beschreibe möglichst zuerst den konkreten Anwendungsfall und danach die gewünschte Lösung.

Ein Feature-Vorschlag ist keine Zusage für Implementierung, Zeitpunkt oder Aufnahme in ein offizielles Release.

## Sicherheitsproblem?

Sicherheitslücken mit noch nicht behobenen Exploitdetails gehören **nicht in öffentliche Issues**.

Bitte [`SECURITY.md`](SECURITY.md) beachten und nach Möglichkeit GitHubs private Vulnerability-Reporting-Funktion verwenden.

## Fragen zur Bedienung

Das GitHub Wiki ist für Benutzerhandbuch, Installation und Bedienung vorgesehen:

https://github.com/ricorewioriginal-collab/anmacha_cast/wiki

Wenn die Dokumentation eine Frage nicht beantwortet und tatsächlich ein Softwarefehler vorliegt, kann anschließend ein Bug Report erstellt werden.

## Entwicklungsfragen

Vor Änderungen bitte lesen:

- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`AI_HANDOVER.md`](AI_HANDOVER.md) bei KI-unterstützter Entwicklung
- [`docs/architecture/`](docs/architecture/) für die verbindliche technische Architektur

Pull Requests sollen das vorhandene System erweitern und keine unnötigen parallelen Implementierungen erzeugen.

## Forks und Community-Builds

Der offizielle AnMaCha Cast-Support bezieht sich auf den offiziellen Projektcode und die vom Maintainer freigegebenen Releases.

Für veränderte Forks, Community-Builds oder fremde Hosting-Angebote ist grundsätzlich deren jeweiliger Anbieter bzw. Entwickler verantwortlich.

Wenn ein Fehler auch im unveränderten offiziellen AnMaCha Cast reproduzierbar ist, kann er selbstverständlich im offiziellen Repository gemeldet werden.

## Kommerzielle Nutzung

Informationen zu AnMaCha Cast-Hosting, SaaS, Abos, Reseller- und White-Label-Modellen stehen in [`COMMERCIAL.md`](COMMERCIAL.md).

Die normale AnMaCha Cast-Nutzung und der eigene Sendebetrieb sind davon zu unterscheiden.

## Keine Secrets veröffentlichen

Unabhängig vom Anliegen niemals öffentlich posten:

- Passwörter;
- API-Tokens;
- Session-Tokens;
- SSH-Schlüssel;
- Streaming-Passwörter;
- Datenbankzugänge;
- Nextcloud-/Cloud-Credentials;
- private Schlüssel.

Logs und Screenshots vor dem Hochladen entsprechend prüfen.

## Offizielle Releases

Nur vom Maintainer freigegebene Versionen gelten als offizielle AnMaCha Cast-Releases. Downloads sollen über die offiziellen GitHub-Releases bzw. die in der README genannten offiziellen Projektkanäle erfolgen.
