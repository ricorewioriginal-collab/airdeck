# lautCast – überprüfbarer Entwicklungsstand

Stand: 2026-10-01. Auftrag: der AirDeck-Menüpunkt „laut.fm" heißt künftig **lautCast** (reine AirDeck-Funktionsbezeichnung;
„laut.fm" bleibt unverändert der Name des externen Dienstes). Zusätzlich soll die bestehende lautCast-Ansicht
(`studio/js/lautfm.js`, Radioadmin-Panel: Playlists/Titel/Algorithmen/Sendeplan/Statistik/Benutzer/Station/Live) funktional
an `automation.html` aus dem AnMaCha-Control-Projekt (`/home/user/anmacha_control_center/automation.html`, 439 KB,
„laut.fm Automation"-Tab) angeglichen werden - **1:1 als Funktionsreferenz**, nicht als visuelle Vorlage (AirDeck behält
sein eigenes Neon-Dark-Design).

## Methodik

Ein Research-Subagent hat `automation.html` (Zeilen ~1300-6460, alle laut.fm-bezogenen Abschnitte) gegen den aktuellen
AirDeck-Stand (`src/server/services/lautfm.ts`, `src/server/http.ts`, `studio/js/lautfm.js`, `studio/js/lautfm-algos.js`)
abgeglichen und eine konkrete, mit Zeilennummern belegte Lückenliste erstellt. Diese Liste ist die Arbeitsgrundlage für
die folgenden Phasen. Bereits vorhandene Funktionsparität (Stationsverwaltung, Playlist-/Titel-CRUD, alle 16
Algorithmus-Vorlagen, Sendeplan-Raster, Statistik, Benutzerverwaltung, Live-Zugangsdaten, Logo-Upload) wird **nicht**
erneut implementiert - nur echte Lücken.

## Lückenliste (Referenz → AirDeck), priorisiert

1. **Menüpunkt-Umbenennung** „laut.fm" → „lautCast" im linken Navigationsmenü und in der Automations-Banner-Anzeige.
   Interne Bezeichner (View-Key `lautfm`, DOM-IDs, API-Pfade) bleiben unverändert - reine Label-Änderung, kein
   Identifier-Rename, um unnötige Umbau-Risiken zu vermeiden.
2. **Keine gebündelten Playlist-Änderungen.** Referenz sammelt Titel-Hinzufügen/-Entfernen in einer Playlist clientseitig
   (`plPendingAdds`/`plPendingRemoves`) und sendet sie erst gesammelt bei Klick auf „Speichern (N)". AirDeck sendet jede
   Änderung sofort einzeln. Das ist die **einzige dokumentierte Ausnahme** von der Referenz-Regel „jede Aktion ist sofort
   live" (die sonst für alles andere gilt und in AirDeck bereits so funktioniert).
3. **Kein Verarbeitungs-Poll beim Titel-Upload.** Referenz: `waitForNewTrack()` mit exponentiellem Backoff
   (800 ms → ×1,4 je Versuch → Deckel 4000 ms, max. 90 s Gesamtwartezeit), Status „Warte auf laut.fm-Verarbeitung…",
   danach automatisches Setzen der Metadaten (Künstler/Titel/Genre/Jahr/Privat) und optionales Hinzufügen zur gewählten
   Playlist. AirDeck lädt hoch und meldet nur grob „N/M Datei(en) übertragen", ohne Metadaten-Felder im Upload-Dialog
   und ohne Nachbearbeitung.
4. **Kein Bearbeiten-/Löschen-Dialog für bestehende Titel.** Referenz hat ein Bearbeiten-Modal für Künstler/Titel/Genre/
   Jahr/Privat/Typ (song/jingle) plus Löschen. AirDeck kann bisher nur Tags bearbeiten (`editTags()`), sonst nichts.
5. **Keine reichhaltige „Jetzt auf laut.fm"-Kachel.** Referenz zeigt Cover, einen aus `started_at`+`duration`
   berechneten Live-Fortschrittsbalken, der sich selbst exakt zum erwarteten Songende neu lädt, plus eine
   Stream-Vorhörfunktion (`https://stream.laut.fm/{name}` als Audio-Element). AirDeck zeigt nur eine reine Textzeile.
6. **Kein lokaler Algorithmus-Testlauf.** Referenz lässt eine selbstgeschriebene Algorithmus-Funktion vor dem Speichern
   clientseitig gegen die aktuell geladenen Titel testen (`algoTest()`, reiner Dry-Run, kein API-Aufruf). AirDeck prüft
   nur grob Klammern-/Funktionskopf-Struktur, führt aber nichts aus.
7. **Keine In-App-Referenz für Tags/Felder.** Referenz erklärt im UI selbst, welche Felder (`type`, `genre`,
   `release_year`, `popularity`, `tags`) welche Algorithmen beeinflussen, mit konkreten Beispielwerten. AirDeck hat dazu
   keine In-App-Dokumentation.
8. **Lifehacks fehlen:** Massen-Tagger (Playlist-weites Bulk-Tagging), „Jahr Batch-Füllen" (fehlende `release_year`-Werte
   automatisch ergänzen), Top-24h-Playlist-Builder (`/tracks/stats/24h` → automatische Playlist aus den meistgespielten
   Titeln der letzten 24 Stunden).
9. **Statistik-Mail-Report** - lokale Zusatzfunktion der Referenz (versendet einen HTML-Bericht per E-Mail), kein reiner
   laut.fm-API-Aufruf. Niedrige Priorität, ggf. außerhalb dieses Abgleichs.
10. **Zwei getrennte Upload-/Poll-Pfade ohne gemeinsamen Code.** Der MusikHub-„lautCast-Übertragung"-Pfad
    (`src/server/services/musikhub.ts`, `lautcastTransfer()`) verwendet einen eigenen, bewusst kurzen Fixed-Poll
    (5× 1 s, danach ehrliches `processing` statt erfundenem Erfolg) - unabhängig vom Radioadmin-Panel-Upload (Punkt 3).
    Nach Umsetzung von Punkt 3 prüfen, ob eine gemeinsame Poll-Hilfsfunktion sinnvoll ist, ohne die bewusst
    unterschiedlichen Garantien (MusikHub bleibt kurz & ehrlich, Radioadmin-Panel darf wie die Referenz bis zu 90 s warten)
    zu vermischen.

## Phasen

| Phase | Stand | Nachweis / Grenze |
|---|---|---|
| 0 - Bestandsaufnahme | Abgeschlossen | Research-Subagent-Bericht (dieser Datei zugrunde liegend) |
| 1 - Menüpunkt-Umbenennung | Siehe unten | `feature/lautcast-rename` |
| 2 - Titel-Upload: Metadaten + Verarbeitungs-Poll + Bearbeiten/Löschen | Offen | |
| 3 - Playlist-Änderungen bündeln („Speichern (N)") | Offen | |
| 4 - Reichhaltige Jetzt-Kachel + Stream-Vorhören | Offen | |
| 5 - Lokaler Algorithmus-Testlauf | Offen | |
| 6 - In-App-Tag-/Feld-Referenz | Offen | |
| 7 - Lifehacks (Massen-Tagger, Jahr-Füllen, Top-24h-Playlist) | Offen | |

### Block: Phase 1 (Menüpunkt-Umbenennung)

Branch `feature/lautcast-rename`, additiv auf dem gemergten Hauptbranch. Geändert: `studio/index.html` - Nav-Label
(`#nav-lautfm span`) „laut.fm" → „lautCast"; Automations-Banner-Text (`#lautfm-auto-banner strong`) „laut.fm
automatisiert diesen Sender" → „lautCast automatisiert diesen Sender". Interne Bezeichner (View-Key `lautfm`,
`#view-lautfm`, API-Routen `/lautfm/...`, DOM-IDs `nav-lautfm`/`lautfm-auto-banner`) bewusst unverändert gelassen -
reine Label-Änderung ohne Identifier-Rename, um das Risiko eines großflächigen Umbaus ohne Funktionsnutzen zu vermeiden.
Rein visuell/textuell, keine Funktionsänderung. Verifiziert: `npm run typecheck` grün; per Playwright/Chromium real im
Browser geprüft (Nav-Label liest „lautCast"). Kein bestehender Test referenziert den alten Label-Text.

## Nächste konkrete Arbeit

1. Diesen Block (Phase 1) committen, PR öffnen, CI abwarten, mergen.
2. Phase 2 (Titel-Upload-Vervollständigung) beginnen: Upload-Dialog um Künstler/Titel/Genre/Jahr/Privat erweitern,
   Verarbeitungs-Poll mit exponentiellem Backoff (Referenz-Timing: 800 ms → ×1,4 → Deckel 4000 ms, max. 90 s) plus
   Status-Anzeige, automatische Metadaten-Nachbearbeitung nach Auflösung der Track-ID, Bearbeiten-/Löschen-Dialog für
   bestehende Titel (Künstler/Titel/Genre/Jahr/Privat/Typ).
3. Danach Phase 3 (gebündelte Playlist-Änderungen), Phase 4 (reichhaltige Jetzt-Kachel), Phase 5 (lokaler
   Algorithmus-Testlauf), Phase 6 (In-App-Referenz), Phase 7 (Lifehacks) - je eigener, kleiner PR mit Tests.
4. Jede Phase nach Tests committen, Build abwarten, Typecheck + Testsuite grün, Fortschrittstabelle hier aktualisieren.
5. Keine Live-Verifikation gegen einen echten laut.fm-Account aus dieser Sandbox möglich - wie bei allen
   laut.fm-Anbindungen bleibt das offen und wird an dieser Stelle dokumentiert, nicht verschwiegen.
