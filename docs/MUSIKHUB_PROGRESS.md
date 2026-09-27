# MusikHub – überprüfbarer Entwicklungsstand

Stand: 2026-09-28. Ausgangspunkt des Codes: `8f9839da043fb4ea574259b67f6ecfd4679e45f7`; Phase-1-Codecommit: `e88799a168a6fe1a72d306598db21f80cabfd70b`; Phase-0-Audit: `docs/MUSIKHUB_CODE_AUDIT.md`. Fachliche Anforderungen und Abnahmematrix liegen im vom Nutzer bereitgestellten Paket `AirDeck_Beta1_Handover_2026-09-27_MusikHub (1).zip`, Dateien `08`–`10`. Das ZIP ist Referenzmaterial, kein ausführbares Projekt und keine Behauptung über implementierten Code.

## Phasen

| Phase | Stand | Nachweis / Grenze |
|---|---|---|
| 0 – Bestandsaudit | Abgeschlossen | `docs/MUSIKHUB_CODE_AUDIT.md`, reale Medien-, RBAC-, Datenbank-, Nextcloud- und SSE-Einstiegspunkte. |
| 1 – Katalog, Eigentum, Grants | Erster abgeschlossener Block | Additive Migration 2 (`hub_items`, `hub_collections`, `hub_grants`); `src/server/services/musikhub.ts`; REST in `src/server/http.ts`. Sender-Medien werden ausdrücklich als Katalogreferenz registriert, nie automatisch geteilt. Sammlung, Mitgliedschaft, Nutzer-/Sendergrant, Senderkontext, Ablauf, Widerruf und Optimistic Revision sind implementiert. Das vorhandene `media:read`/`media:write`-RBAC bleibt vorgeschaltet. Stationsinhalt verlangt eine konkrete Nutzer-Senderzuordnung; das Plattform-`*` und reine API-Tokens geben keinen MusikHub-Inhaltszugriff. Negativtests in `test/musikhub.test.ts`. |
| 2 – Studio | Teilweise umgesetzt | Ein MusikHub-Reiter in der bestehenden Mediathek bietet Katalogsuche, Katalogisieren, Sender-Sammlungen sowie Katalogfreigaben und Widerruf. Es gibt noch keinen privaten Audio-Upload, autorisierten Hub-Vorhör-/Download-Endpunkt oder vollständige Mobile-Abnahme. Die UI bietet diese Aktionen deshalb nicht an. |
| 3 – Nextcloud-Quellen/Jobs | Offen | Der Legacy-Import ist weiterhin global konfiguriert und synchron. Quelle je Eigentümer, Index, Abruf, persistente Jobs, Konflikte und Quoten fehlen. |
| 4 – AirDeckCast | Offen | Hub-Referenzen werden noch nicht in Queue/Planung/Sendebus aufgelöst. Keine implizite Sendeberechtigung durch Kataloggrant. |
| 5 – lautCast | Offen | Keine neue Radioadmin-Funktion. Aktuelle offizielle API/Capabilities je Station vor Implementierung verifizieren. |
| 6 – Beta-Abnahme | Offen | Die vollständigen Szenarien MH01–MH24 sind noch nicht abgenommen. |
| 7 – zusätzliche Cloudadapter/Föderation | Später | Erst nach stabiler Beta. |

## Daten- und Sicherheitsregeln des aktuellen Blocks

- Bestehende `media`-Zeilen und Dateipfade bleiben unverändert. Nur ein explizit registrierter Sendertitel erscheint als Hub-Referenz. User-eigene Sammlungen können derzeit leer angelegt werden; private persönliche Audiodateien brauchen zuerst einen eigenen geschützten Uploadpfad.
- Neue Datensätze sind ohne Grant nur für ausdrücklich zugeordnete Nutzer des Eigentümersenders sichtbar. Der Ziel-Sender wird bei jeder Katalogabfrage und Grantprüfung neu geprüft. Fremde Trefferzahlen werden nicht mitgezählt.
- Ein Kataloggrant gibt keine alte `/stations/:sid/media/:id/file`-URL frei. `preview.play`, `file.download`, `broadcast.use` und `transfer.export` sind als getrennte Rechte modelliert, aber ihre Hub-Laufzeitaktionen bleiben gesperrt, bis die jeweiligen sicheren Endpunkte fertig sind. Es werden keine privaten Hub-Inhalte in globale SSE-Ereignisse veröffentlicht.
- Sammlungseinträge dürfen derzeit nur denselben Eigentümer haben. Künftige Mitglieder einer freigegebenen Sammlung erben den Grant. Das Studio weist im Dialog darauf hin.
- Widerruf wirkt für neue Katalogabfragen unmittelbar im Speicher und wird persistent gespeichert. Extern bereits exportierte Dateien sind nicht zurückrufbar.

## Validierung und Rollout

Vor dieser Änderung: Server- und Studio-Typechecks erfolgreich; lokale Windows-Testbaseline 159 bestanden, 7 fehlgeschlagen, 29 übersprungen. Die sieben Ausgangsfehler stehen im Audit. Nach Phase 1: beide Typechecks erfolgreich; gezielter Testlauf `test/musikhub.test.ts`, `test/db.test.ts`, `test/users.test.ts`: 8 bestanden, 0 fehlgeschlagen, 4 übersprungen (externe DB nicht konfiguriert). Vollständige lokale Suite: 162 bestanden, 6 fehlgeschlagen, 29 übersprungen (197 Tests). Die sechs Fehlschläge sind dieselben vier Windows-/Linux-Pfadtests, ein `ECONNRESET` im Hörer-Test und ein `EPERM` bei der Nextcloud-Testverzeichnisbereinigung. Der zuvor fehlgeschlagene UDP-Discovery-Test bestand im zweiten Lauf.

Der Build-Lauf [36353494094](https://github.com/ricorewioriginal-collab/anmacha_control/actions/runs/36353494094) bestand vollständig: Test, Docker, Linux, Demo, Android, ARM64, Screenshots und Windows-Installer. Der erste automatische Deploy meldete fälschlich Erfolg, weil ein Docker-Befehl das SSH-Skript über stdin vorzeitig verbrauchte; der neue Checkout wurde nicht ausgeführt. Der korrigierte Rollout prüft nun Commit und MusikHub-Endpunkt. Ein weiterer Versuch zeigte `EACCES` beim Containerstart: `umask 077` hatte neue Quelldateien nur für den Besitzer lesbar gemacht. Der [erfolgreiche Wiederherstellungs-Rollout 36355075391](https://github.com/ricorewioriginal-collab/anmacha_control/actions/runs/36355075391) trennt Backup-Rechte vom Checkout, setzt die Leserechte im Docker-Build-Kontext und sichert das Datenvolume auch dann, wenn der App-Container neu startet.

Öffentliche Demo nach dem Rollout: `https://airdeck-demo.ricorewi-radio.de/api/v1/health` antwortet `200` mit `database`, `storage`, `audio` und `stream` auf `ok`/`connected`; Demo-Login `200`; authentifizierte MusikHub-Katalog- und Sammlungsabfrage jeweils `200` mit einem Demo-Titel und einer Demo-Sammlung; anonyme Katalogabfrage `401`; Studio-Asset `/js/musikhub.js` `200`. Das belegt Phase 1 live, keine Abnahme der offenen Phasen 2–6.

Der Deploy-Workflow wartet nun auf einen erfolgreichen Build-Lauf. Er legt vor dem Update unter `~/airdeck-backups/<UTC-Zeitstempel>/` eine PostgreSQL- und `/data`-Sicherung an, verweigert einen schmutzigen Server-Checkout und aktualisiert Git nur per Fast-Forward. Danach werden die bestehende Server- und Demo-Compose-Installation aktualisiert; die Demo wird über ihren vorhandenen Reset mit einem Beispiel-Katalogeintrag gefüllt. Keine zweite Demo-Instanz.

Wichtige Rücknahmegrenze: Ein alter AirDeck-Build kennt Schema 2 nicht und startet gegen eine migrierte Datenbank nicht. Für Rollback zuerst die vor dem Rollout angelegte Datenbanksicherung und `/data` passend zum in `previous-commit.txt` genannten Quellstand wiederherstellen. Niemals nur das alte Image über die neue Datenbank starten.

## Nächste konkrete Arbeit

1. UI im Browser mit Demo-Nutzer auf Desktop/Handy prüfen; keine Produktionstitel als Testdaten verwenden.
2. Phase 2 fertigstellen: private Speicherung persönlicher Medien, Quell-/Versionsmodell, authentifiziertes Vorhören (ohne Voll-Download für reine Preview-Grants), separate Download- und Senderechte, klare Quell-/Verfügbarkeitsanzeige und Rechte-/Widerrufstests einschließlich Range-Requests, Cover und SSE.
3. Erst dann Phase 3 gemäß Paket 09: pro Eigentümer getrennte Nextcloud-Quelle und Secret, sichere URL-/Redirect-Prüfung, begrenzter Katalogscan und persistente Einweg-Importjobs mit Restart/Offline/Conflict/Quota-Tests.
4. Danach AirDeckCast-Preflight und lautCast-Capabilities in dieser Reihenfolge. Jede Phase nach Tests committen, Build abwarten, auf der bestehenden Demo prüfen und den Rücknahmeweg dokumentieren.
