# AnMaCha Cast Changelog

Alle wesentlichen Änderungen an **offiziell veröffentlichten AnMaCha-Cast-Versionen** werden hier dokumentiert. Einträge vor der Umbenennung (siehe `docs/REBRANDING_ANMACHA_CAST.md`) tragen noch den damaligen Projektnamen AirDeck – das ist der historisch korrekte Releasename und bleibt unverändert.

> **Automatisch gepflegt:** Bei einer neuen Veröffentlichung aktualisiert der Changelog-Workflow den Bereich zwischen `AUTO-CHANGELOG` und `/AUTO-CHANGELOG`. Grundlage sind die tatsächlich veröffentlichten GitHub-Releases sowie der Git-Vergleich zwischen zwei Versionen. Individuelle Release-Hinweise gehören in die GitHub Release Notes.

Die Versionshistorie orientiert sich soweit praktikabel an Semantic Versioning.

## Kategorien

- **Added** – neue Funktionen
- **Changed** – geändertes Verhalten
- **Fixed** – Fehlerbehebungen
- **Security** – öffentlich dokumentierbare Sicherheitskorrekturen
- **Deprecated** – künftig zu entfernende/ersetzende Funktionen
- **Removed** – entfernte Funktionen

## [Unreleased]

Dieser Bereich bleibt für bewusst dokumentierte Änderungen vorgesehen, die noch nicht veröffentlicht wurden. Automatisch erzeugte Release-Historie beginnt darunter.

<!-- AUTO-CHANGELOG:START -->
## Veröffentlichte Versionen

### AnMaCha Cast V1.1 - Beta — 02.10.2026

**Version:** `v0.5.0`  
**Release:** [AnMaCha Cast V1.1 - Beta](https://github.com/ricorewioriginal-collab/anmacha_cast/releases/tag/v0.5.0)  
**Vergleich:** [v0.5.0-beta.1 → v0.5.0](https://github.com/ricorewioriginal-collab/anmacha_cast/compare/v0.5.0-beta.1...v0.5.0)

**Änderungen laut Git-Historie:**

- Update public release wording for AnMaCha Cast
- News-Zentrale (Show-Prep): Feeds, Artikelwahl, Wetter-Block, KI-Vorschlag, Teleprompter (#98)
- Track-TÜV: Tonart-Analyse, Online-Tag-/Cover-Suche, Vorher/Nachher-Bericht (#99)
- pages: redeploy current AnMaCha Cast public site
- docs: remove stale v0.4.1 comparison
- branding: replace legacy AirDeck artwork
- site: expose current support branding and demo docs
- site: use direct demo auto-login
- docs: refresh demo links and current release info
- site: show public demo login credentials
- docs: make public demo credentials prominent
- Feature/tracks UI (#101)
- Deep Stats: Heatmap Wochentag×Uhrzeit, Top/Flop mit Vorperiode, Interpreten-Anteile, Song-Verlauf, Excel/PDF/Mail (#100)
- KI-Studio: Ansage-Typen als Knöpfe, KI-Playlist erstellen/neu ordnen, automatische KI-Ansagen (#97)
- Sendezentrale: Netzwerk-Senderkarten mit Live/Ø 24h/Ø 7 Tage, Sortierung und Sync (#96)
- Podcast: Auto-Veröffentlichung fertiger Mitschnitte nach Vorlage (#95)
- Ereignisse: Kategorie-, Nachrichten- und KI-Ansage-Trigger, „Jetzt beenden“; Berichte: Meistgespielt + Verlauf-Filter (#94)
- Sound & Stimme: Master-Presets, Bass/Höhen, Stereo-Breite und Mikrofon-Kette (#93)
- Smart Blocks & Allgemeine Rotation: Playlisten aus Regeln, dynamisch oder als Momentaufnahme (#92)
- Cardwall → Soundboard: Tags, Favoriten, Zuletzt, Suche, Hotkeys, Show-Modus, Alle stoppen (#91)
- Einschübe, Dialog-Neugestaltung und KI-Werkstatt (Control-Center-Abgleich, Teil 2) (#90)
- Rename AirDeck to AnMaChaCast across identifiers, packaging, and docs (#89)
- Design + Navigation wie im AnMaCha Control Center, Nachrichten & Wetter, Hörerstatistik, Überblend-Profile, Motion-Loops (#88)
- Windows: natives WPF-Hauptfenster statt WebView2 für die Kernbedienung (#87)
- Design-Relaunch: neues Logo, 2026-Farbschema, aufgeräumte Navigation (#86)
- Motion Mixes (Foster Kent): Korrektur + erste Vorarbeit (loopEndMs) (#85)
- Motion-Mix-Video: eigene Umsetzung des "Foster Kent"-Stils (#84)
- Decks: ±10-Sekunden-Sprung + Funktionsabgleich-Doku aktualisiert (#83)
- Rotation: Energie-Fluss-Regel (max. BPM-Sprung zwischen Titeln) (#82)
- Android: letzte Capacitor-Überbleibsel aus dem nativen Build entfernt (#81)
- Demo: Direktlink mit automatischer Anmeldung (plus offene Branch-Commits) (#79)
- docs: aktuelle Release-Version v0.5.0-beta.1 (#76)
- docs: Changelog v0.5.0-beta.1 (#75)
- docs: Changelog v0.5.0-beta.1 (#77)
- Copilot/release aktualisierte version (#80)
- docs: Release-Screenshots v0.5.0-beta.1 (#78)

### AnMaCha Cast v0.5.0-beta.1 — 02.10.2026

**Version:** `v0.5.0-beta.1`  
**Release:** [AnMaCha Cast v0.5.0-beta.1](https://github.com/ricorewioriginal-collab/anmacha_cast/releases/tag/v0.5.0-beta.1)
<!-- AUTO-CHANGELOG:END -->

## Hinweise zur Historie

Der automatisch gepflegte Abschnitt ist eine technische Zusammenfassung der veröffentlichten Git-Historie. Er soll keine Änderungen erfinden oder Commit-Nachrichten als fachlich geprüfte Release Notes ausgeben. Für besonders wichtige Änderungen können die Release Notes weiterhin manuell verständlicher ergänzt werden.

Nur freigegebene GitHub-Releases werden in die veröffentlichte Versionshistorie aufgenommen.
