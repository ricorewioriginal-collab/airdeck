# MusikHub Phase 0 – Codeaudit und Übergabestand

Auditdatum: 2026-09-27  
Geprüfter Branch: `AirDeck-Radio-Automation-&-Broadcast`  
Geprüfter HEAD: `2359838b4c1b7c68b19d3f70f261a215edbe7576` (`README: aktuelle UI-Screenshots [screenshots]`)  
Arbeitsbaum vor dem Audit: sauber; HEAD entsprach `origin/AirDeck-Radio-Automation-&-Broadcast`.

## Zweck und Vertrauensgrenze

Das ZIP `AirDeck_Beta1_Handover_2026-09-27_MusikHub (1).zip` wurde als Anforderungs- und Referenzmaterial gelesen. Seine inhaltlichen Vorgaben wurden mit dem Checkout abgeglichen. Referenz-HTML, Screenshots, YAML und ausführbare Inhalte wurden nicht als Programm gestartet. Die Dokumente beschreiben den MusikHub ausdrücklich als noch nicht implementiert; ihre vorgeschlagenen Klassennamen und API-Pfade sind keine Bestandsbehauptungen.

Dieses Dokument hält ausschließlich den geprüften Ausgangspunkt und die nächste sichere Arbeitsfolge fest. Es ist kein Nachweis, dass MusikHub-Funktionen, Demo-Rollout oder Live-Integration bereits existieren.

## Geprüfte Einstiegspunkte

| Bereich | Tatsächlicher Einstiegspunkt | Befund und Konsequenz |
|---|---|---|
| Mediathek | `src/server/services/media.ts`; Medien liegen als `MediaItem[]` in den Daten eines Senders | Die vorhandene Bibliothek ist senderbezogen. `addMedia`, `updateMedia` und `removeMedia` veröffentlichen `library.changed`; Metadaten und Dateipfade sind an die bestehende Sender-Laufzeit gekoppelt. Noch kein Eigentümer-, Sammlung-, Grant- oder MusikHub-Modell. |
| Medienspeicher | `src/server/app.ts`, `src/server/repo/docs.ts`, `src/server/db/schema.ts`, `src/server/repo/mappings.ts` | JSON-Dokumentmodus und DB-Dokumentmodus existieren. Schema-Migrationen sind versioniert und werden für SQLite/PostgreSQL/MySQL aus gemeinsamen Tabellenbeschreibungen erzeugt. `media` ist per `station_id` partitioniert. Eine neue globale/shared Medienrelation erfordert eine additive Migration und Prüfung der Dokument-Mappings sowie aller drei DB-Dialekte. |
| Nutzer und RBAC | `src/server/users.ts`, `src/server/model.ts`, `src/server/http.ts` | Rollen/Scopes sind vorhanden (`media:read`, `media:write`), Nutzer tragen `stationIds`; Endpunkte prüfen Scopes plus Senderzugriff. Die Aktionen sind für getrenntes Preview/Download/Export/Share-Management noch zu grob. Ein Grant darf diesen vorhandenen Prüfpfad ergänzen, nicht umgehen. |
| HTTP/API | `src/server/http.ts` | `/api/v1/stations/:sid/...` ist der bestehende Senderkontext. Nextcloud-Konfiguration (`/api/v1/nextcloud`) ist global-adminverwaltet; Listen/Import/Recording-Upload liegen an vorhandenen Media-Scopes. Neue APIs müssen den effektiven Nutzer und Zielsender bei jedem Lese- und Schreibzugriff erneut prüfen. |
| Nextcloud | `src/server/services/nextcloud.ts`, `src/server/nextcloud.ts` | Vorhanden: WebDAV-Listing, expliziter Import bis zu begrenzten Pfaden/Dateien sowie Recording-Upload; Secret liegt im Secret-Store. Import lädt synchron in die senderlokale Mediathek. Noch kein gemeinsamer Katalog, persistenter Scan-/Transferjob, Einweg-Sync-Zustand oder Konfliktmodell. Private URL/SSRF- und Redirect-Grenzen vor Ausbau gezielt testen. |
| Jobs/Planung | `src/server/services/planning.ts`, Datenbanktabelle `jobs` in `src/server/db/schema.ts` | Persistente senderbezogene Sendejobs existieren. Das ist nicht automatisch ein geeigneter langlebiger Datei-Transferjob: Zustände, Idempotenz, Retry, Quoten und Resume müssen separat bewertet werden. |
| Ereignisse | `src/server/app.ts` (`publish`), `src/server/http.ts` (`GET /api/v1/events`) | SSE ist vorhanden und verwendet Senderfilterung. MusikHub-Ereignisse dürfen erst nach serverseitiger Empfänger-/Senderprüfung veröffentlicht werden; private Titel, Trefferzahlen oder Metadaten dürfen nicht in globale Events geraten. |
| Studio | `studio/` und bestehende Mediathek-Views | Die Mediathek/Nextcloud-Navigation ist schon Teil der Oberfläche. Es wurde im Phase-0-Audit keine MusikHub-Laufzeitansicht oder Rechteoberfläche nachgewiesen. |
| Tests | `test/media-integrity.test.ts`, `test/nextcloud.test.ts`, `test/users.test.ts`, `test/db.test.ts`, `test/server.test.ts` und Studio-HTTP-/Navigationsprüfungen | Es gibt nahe Regressionstests für Medien, Nextcloud, Rollen, Multi-DB-Migrationen und echte HTTP-Verträge. Für MusikHub-Isolation, Grants, Widerruf, SSE und Job-Rechte existiert in diesem Checkout noch kein nachgewiesener Testsatz. |

## Baseline-Prüfung

Ausgeführt: Server- und Studio-TypeScript-Compiler sowie vollständige Node-Test-Suite vom unveränderten HEAD. Beide Typechecks waren erfolgreich. Testergebnis: **159 bestanden, 7 fehlgeschlagen, 29 übersprungen** (195 Tests; ca. 67 Sekunden).

Die sieben Fehler sind Umgebungs-/Plattformprobleme im Sandbox-Lauf und traten vor MusikHub-Codeänderungen auf:

- Vier `test/config.test.ts`-Fälle erwarten Linux-/Windows-Pfadsemantik, laufen hier jedoch unter Windows Node und erhalten entsprechend andere Pfade.
- `test/discover.test.ts` konnte den lokalen UDP-Test-Responder über den echten Discovery-Endpunkt nicht finden.
- `test/listeners.test.ts` erhielt beim HTTP-Test einen `ECONNRESET`.
- `test/nextcloud.test.ts` erreichte seine Assertions; die Bereinigung des Temp-Verzeichnisses scheiterte anschließend mit `EPERM` im Sandbox-Temp-Pfad.

29 Tests wurden erwartungsgemäß wegen fehlendem FFmpeg oder nicht konfigurierten PostgreSQL-/MySQL-Testdatenbanken übersprungen. Das ist keine grüne Gesamtsuite. Vor Feature-Abnahme sollten die sieben Umgebungsfehler in einer unterstützten Projektumgebung erneut geprüft und getrennt von neuen Regressionen ausgewiesen werden.

## Sichere Fortsetzung

1. Vor jeder Implementierung Branch/HEAD erneut aktualisieren und Änderungen anderer Clients erhalten; nie auf `2359838b` zurücksetzen, wenn neuere Commits vorliegen.
2. Phase 1 mit einem minimalen, geschlossenen Datenmodell beginnen: Eigentümer/Scope, Sammlungen, Medienzuordnung, Grants samt Empfänger/Aktionen/Zielsender/Gültigkeit/Widerruf und Audit. Additive Migration, geschlossene Defaults und JSON-Kompatibilität gemeinsam spezifizieren.
3. Erst danach serverseitige Katalogabfrage und Grant-Prüfung implementieren. Isolation mit Negativtests gegen erratene IDs, Trefferzahlen, Cover, Downloads, Range-Requests und SSE nachweisen.
4. Nextcloud-Index/Abruf/Einweg-Import als persistente, begrenzte Jobs ergänzen; keine stille Löschung bei Offline-/Teilfehlern. Vor externer Wirkung Rechte und Ziel erneut prüfen.
5. Preview-/Sendebus und AirDeckCast-Preflight getrennt halten. lautCast erst nach erneuter Prüfung der aktuellen offiziellen Radioadmin-Spezifikation und pro Station belegter Capability integrieren.
6. Studio erst an echte, abgenommene APIs anbinden. Keine Demo- oder Live-Schreibtests ohne passende Testressourcen. Erst nach erfolgreicher Regression bestehende Rollout-/Demo-Prozedur verwenden.

## Arbeitsgrenze dieses Übergabeschritts

Keine Laufzeitdatei, Migration, Medien-/Nutzerdaten, Secrets, Git-Historie, Demo oder Live-Instanz wurde geändert. Keine Demo-E2E oder Deployment wurde ausgeführt. Der nächste Client kann mit diesem Audit und den ZIP-Dokumenten `08`–`10` in Phase 1 einsteigen; nachfolgende Fortschritte müssen mit Commit, Tests, Demo-Version und Rücknahmeweg ergänzt werden.
