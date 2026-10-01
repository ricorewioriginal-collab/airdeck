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
| 1 - Menüpunkt-Umbenennung | Gemerged (PR #56) | `feature/lautcast-rename` |
| 2 - Titel-Upload: Metadaten + Verarbeitungs-Poll + Bearbeiten/Löschen | Siehe unten | `feature/lautcast-phase2-upload-edit` |
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
Browser geprüft (Nav-Label liest „lautCast"). Kein bestehender Test referenziert den alten Label-Text. Zusätzlich (per
Playwright-Verifikation des Folgeblocks aufgefallen, nachträglich in diesen Block aufgenommen): der Panel-Titel im
lautCast-Kopf (`lf-title`, bisher „laut.fm Radioadmin") ebenfalls auf „lautCast" umbenannt.

### Block: Phase 2 (Titel-Upload: Metadaten + Verarbeitungs-Poll + Bearbeiten/Löschen)

Branch `feature/lautcast-phase2-upload-edit`, additiv auf dem gemergten Hauptbranch (inkl. Phase 1). Größte der
dokumentierten Lücken geschlossen - Details siehe Lückenliste Punkt 3/4 oben:

- **Upload-Dialog je Datei** (`uploadTracks()`): statt reinem Datei-Upload jetzt ein kurzer `formDialog()` je Datei mit
  Künstler/Titel/Genre/Jahr/Typ (Song/Jingle)/Privat/Ziel-Playlist. „Abbrechen" überspringt nur diese eine Datei, die
  übrigen werden trotzdem angeboten (kein Alles-oder-nichts).
- **`waitForNewTrackLogic()`** (neu, exportiert, reine Logik ohne DOM/Netzwerk-Abhängigkeit): exponentielles Backoff
  (800 ms Start, ×1,4 je Versuch, Deckel 4000 ms), max. 90 s Gesamtwartezeit - exakt das Referenz-Timing aus
  `automation.html waitForNewTrack()`. Ab dem zweiten Versuch zusätzlicher Cross-Check gegen `;queued`/`;incomplete`:
  ist die negative Upload-Platzhalter-ID dort nicht mehr gelistet, gilt die Verarbeitung als abgeschlossen, auch wenn
  der direkte `own=true&order=desc`-Abruf aus irgendeinem Grund noch nicht aktualisiert wirkt. Nach Zeitüberschreitung
  ehrlich `null` statt eines erfundenen Erfolgs - die aufrufende `uploadOneTrack()` meldet das dann als „Zeitüberschreitung,
  Metadaten bitte manuell setzen" statt eines stillen Fehlschlags.
- Nach Auflösung der Track-ID: automatisches `PATCH .../tracks/{id}` mit den Metadaten, optionales
  `POST .../playlists/{id}` zur gewählten Playlist (laut.fm lehnt bereits enthaltene Tracks ohne Fehler ab - idempotent).
- **`editTrack()`/`deleteTrack()`** (neu): Bearbeiten-Dialog (Künstler/Titel/Genre/Jahr/Typ/Privat) und Löschen für
  bestehende Titel in der Titel-Tabelle (`trackTable()` um ✎/🗑-Aktionen erweitert, inkl. Playlist-Detailansicht und
  „Uploads in Verarbeitung"-Liste) - bisher war nur das Bearbeiten der Tags möglich.

Kein Server-Änderungsbedarf: alle genutzten Radioadmin-Pfade (`/tracks?own=true&order=desc`, `/tracks;queued`,
`/tracks;incomplete`, `PATCH`/`DELETE /tracks/{id}`) sind über den bestehenden generischen Proxy
(`allowedRadioadminPath()` in `src/server/lautfm.ts`) bereits erlaubt - die Methodenprüfung (`lautfm:write` für
PATCH/DELETE) greift unverändert.

Test: `test/lautfm-upload-poll.test.ts` (neu, 4 Fälle: sofortiger Treffer ohne Wartezeit, exponentielles Backoff bis
zum Treffer mit exakt geprüften Verzögerungswerten, Cross-Check-Erkennung bei scheinbar noch alter `own`-Liste,
ehrliches `null` nach Ablauf von `maxWaitMs`) - reine Logikprüfung mit injizierten Fake-API-Aufrufen/-Uhr, keine echte
Zeit/kein echtes Netzwerk. `npm run typecheck` grün; vollständige laut.fm-/MusikHub-Testsuite (21 Tests) weiterhin
grün. Per Playwright/Chromium real im Browser gegen einen lokalen Mock-Radioadmin-Server geprüft: Titel-Tabelle zeigt
die neuen ✎/🗑-Aktionen, Bearbeiten-Dialog öffnet vorausgefüllt mit allen Feldern.

**Weiterhin offen (bewusst nicht in diesem Block):** Playlisten-Änderungen bündeln (Phase 3), reichhaltige
Jetzt-Kachel/Stream-Vorhören (Phase 4), lokaler Algorithmus-Testlauf (Phase 5), In-App-Tag-Referenz (Phase 6),
Lifehacks (Phase 7) - keine Live-Verifikation gegen einen echten laut.fm-Account möglich.

## Nächste konkrete Arbeit

1. Diesen Block (Phase 2) committen, PR öffnen, CI abwarten, mergen.
2. Phase 3 (gebündelte Playlist-Änderungen) beginnen: `plPendingAdds`/`plPendingRemoves`-Muster aus der Referenz -
   Hinzufügen/Entfernen in der Playlist-Detailansicht sammeln statt sofort zu senden, „Speichern (N)"-Button mit
   Ergebnis-Rückmeldung (ok/fehlgeschlagen je Änderung).
3. Danach Phase 4 (reichhaltige Jetzt-Kachel + Stream-Vorhören), Phase 5 (lokaler Algorithmus-Testlauf), Phase 6
   (In-App-Referenz), Phase 7 (Lifehacks) - je eigener, kleiner PR mit Tests.
4. Jede Phase nach Tests committen, Build abwarten, Typecheck + Testsuite grün, Fortschrittstabelle hier aktualisieren.
5. Keine Live-Verifikation gegen einen echten laut.fm-Account aus dieser Sandbox möglich - wie bei allen
   laut.fm-Anbindungen bleibt das offen und wird an dieser Stelle dokumentiert, nicht verschwiegen.
5. Keine Live-Verifikation gegen einen echten laut.fm-Account aus dieser Sandbox möglich - wie bei allen
   laut.fm-Anbindungen bleibt das offen und wird an dieser Stelle dokumentiert, nicht verschwiegen.
