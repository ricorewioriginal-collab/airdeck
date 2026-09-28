# AirDeck – AI Agent Handover

> **Startpunkt für Claude Code, Codex, Replit, Cursor und andere Coding-Agents.**
>
> Die ausführliche Projektbeschreibung und der öffentliche Entwicklungsstand stehen in [`README.md`](README.md). Git und README sind die primären Wahrheiten; diese Datei hält nur die knappe Arbeitsübergabe fest.

## Vor jeder Arbeit

```bash
git fetch
git status
git branch --show-current
git log -1 --oneline
```

Arbeitsbranch: `AirDeck-Radio-Automation-&-Broadcast`.

Keine älteren Handover-Pakete über einen neueren Git-Stand schreiben. Kein Force-Push. Keine fremden Änderungen überschreiben.

## Arbeitsprinzip

- Erst README und diese Datei lesen, danach nur die für den aktuellen Arbeitsblock relevanten Dateien.
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

- `README.md` ist der allgemeine Ausgangspunkt und enthält Status, Screenshots, Installation und Funktionsübersicht.
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

Wenn Remote weitergelaufen ist, Änderungen sauber integrieren. Keine Handover-ZIPs, Referenz-Screenshots mit Zugangsdaten, Secrets oder große Audio-Testdateien committen.

## CURRENT HANDOVER

**Zuletzt bearbeitet von:** ChatGPT – Dokumentationsbereinigung / Agent-Handover

**Arbeitsblock:** Multi-Agent-Koordination

**Status:** implementiert

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

**Grundsatz:** Git ist die technische Wahrheit. README ist der allgemeine Einstieg. Diese Datei ist nur die kurze Übergabe, damit ein neuer Agent nicht das komplette Projekt erneut analysieren muss.
