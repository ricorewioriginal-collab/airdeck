# AirDeck – AI Agent Handover

> **Interne Kurz-Übergabe für Claude Code, Codex, Replit, Cursor und andere Coding-Agents.**
>
> `README.md` bleibt die öffentliche Projektseite mit Projektstand, Demo, Downloads und Screenshots. Diese Datei enthält ausschließlich die knappe Arbeitsübergabe. Ausführliche Benutzer- und Entwicklerdokumentation gehört ins GitHub Wiki bzw. in notwendige versionierte technische `docs/`-Dateien.

## Vor jeder Arbeit

```bash
git fetch
git status
git branch --show-current
git log -1 --oneline
```

Arbeitsbranch: `AirDeck-Radio-Automation-&-Broadcast`.

Keine älteren Handover-Pakete über einen neueren Git-Stand schreiben. Kein Force-Push. Keine fremden Änderungen überschreiben.

## Dokumentationsstruktur

- `README.md` = öffentliche Projektübersicht, sichtbarer Projektstand, Demo, Downloads/Releases, Screenshots und Schnellstart.
- `AI_HANDOVER.md` = kurze aktuelle Agentenübergabe; keine öffentliche Produktdokumentation.
- GitHub Wiki = ausführliche Benutzer-/Entwicklerdokumentation, Architektur, Installation, MusikHub, Nextcloud, AirDeckCast, lautCast, API, Rollen/Rechte und Troubleshooting.
- `docs/` = nur technische Dokumente und Assets, die sinnvoll zusammen mit dem Quellcode versioniert werden müssen, insbesondere Screenshot-Assets und build-/codebezogene Spezifikationen.
- GitHub Releases = veröffentlichte Installer, Portable Builds, APK/DEB und Release Notes.
- Issues/Projects = Bugs und geplante Arbeit statt immer neuer Status-Markdown-Dateien.

## Arbeitsprinzip

- Erst `README.md` und diese Datei lesen, danach nur die für den aktuellen Arbeitsblock relevanten Dateien.
- Bestehende Architektur erweitern; keine zweite Benutzerverwaltung, Senderverwaltung, Mediathek, Automation, Queue, Authentifizierung oder parallele Datenbank bauen.
- Keine Mockfunktionen oder Fake-Daten als fertige Features ausgeben.
- Nach jedem Block relevante Tests ausführen und nur den eigenen Arbeitsbereich committen.
- Status sauber unterscheiden: `implementiert`, `automatisiert getestet`, `manuell getestet`, `live verifiziert`.

## Parallele Agents

### Codex – aktuell reservierter Bereich

Windows Installer / Inno Setup / First-Run / Bootstrap.

Andere Agents ändern während dieses Blocks nicht eigenständig:

- `packaging/windows/installer.iss` und Installer-Hilfsdateien,
- First-Run-/Installer-Bootstrap,
- Installer-Firewall-/lokale Icecast-Installation,
- Windows-Packaging-/Installer-CI, soweit Codex daran arbeitet.

Probleme dort dokumentieren statt parallel eine zweite Lösung zu bauen.

### UI-Agent – aktueller UI-Bereich

UI/UX anhand der vereinbarten AirDeck-Demobilder aus dem aktuellen Handover weiterentwickeln. Die Bilder sind visuelle Zielvorgabe; aktuelles Git ist funktionale Wahrheit. Keine zweite UI, keine statischen Mockups.

Empfohlene kleine Blöcke:

1. UI-01 Designsystem + App Shell + Navigation + Header
2. UI-02 Dashboard
3. UI-03 Live Studio
4. UI-04 Mediathek + MusikHub
5. UI-05 Playlists + Sendeplan
6. UI-06 Statistik
7. UI-07 Sender + Branding + Team + Einstellungen
8. UI-08 Responsive + Accessibility + Polish

### Größere Backend-Blöcke

Vor Arbeiten am MusikHub zuerst aktuellen Code und Tests prüfen. Danach in der vorgesehenen Reihenfolge weiterarbeiten: private/sichere MusikHub-Nutzung → Nextcloud-Quellen/Jobs → AirDeckCast-Auflösung → lautCast → Beta-Abnahme. Nicht aufgrund dieser Kurzdatei einen bereits weiterentwickelten Stand zurückrollen.

## Referenzen

- AirDeck-UI-Demobilder aus dem Handover definieren die visuelle Zielrichtung.
- AzuraCast-, laut.fm-/Radioadmin- und AnMaCha-Screenshots sind Funktions-/Workflowreferenzen, keine Designvorlagen und kein Code zum Kopieren.
- Referenzmaterial kann sensible Daten enthalten: keine Credentials transkribieren oder committen.

## Git-Regeln bei Agentwechsel

Vor Commit/Push erneut:

```bash
git fetch
git status
git log --oneline -5
```

Wenn Remote inzwischen weitergelaufen ist, Änderungen sauber integrieren. Keine Handover-ZIPs, Referenz-Screenshots mit Zugangsdaten, Secrets oder große Audio-Testdateien committen.

## CURRENT HANDOVER

**Zuletzt bearbeitet von:** ChatGPT – Dokumentationsstruktur / README-Wiederherstellung

**Arbeitsblock:** Multi-Agent-Koordination

**Status:** README als öffentliche Projektseite wiederhergestellt; AI-Handover separat gehalten.

**Parallel reserviert:** Codex arbeitet am Windows-Installer-/First-Run-Zwischenschritt.

**Nächster UI-Schritt:** UI-01 – ausschließlich Designsystem + App Shell + Navigation + Header anhand der vorhandenen AirDeck-UI/UX-Demobilder; Backend und Installer nicht umbauen.

**Danach:** UI-02 Dashboard.

### Nach jedem Agent-Durchlauf aktualisieren

- letzter bestätigter Commit
- Agent
- Arbeitsblock
- Status
- geänderte Hauptdateien
- ausgeführte Tests
- bekannte Probleme
- reservierte Bereiche anderer Agents
- genau ein nächster konkreter Arbeitsblock

---

**Grundsatz:** Git ist die technische Wahrheit. `README.md` ist die öffentliche Projektseite. `AI_HANDOVER.md` ist nur die kurze Arbeitsübergabe. Das Wiki ist für ausführliche Dokumentation vorgesehen.
