# AirDeck V1 Beta 1: IN QUALIFIKATION

Stand: 27.09.2026. Die Qualifikation ist begonnen, nicht abgeschlossen. Kein vollständiger Zero-to-Air-/Clean-Install-/Disaster-Recovery-Nachweis und kein 24h-Soak. Bestehende CI-Erfolge sind Teilnachweise.

## Erledigte Vorbereitung

| Schritt | Status |
|---|---|
| Repo-Struktur & Branches | ✅ `release/v1.0.0-beta.1` + Backup |
| CI/CD | ✅ Build-Workflow optimiert |
| Version | ✅ `1.0.0-beta.1` in `package.json` + `package-lock.json` |
| Release-Trigger | ✅ Nur `v*`-Tags, Artefakte kurz |
| Dokumentation | ✅ README aktualisiert |

## Verbindliche Gates

[Testmatrix](P4_TEST_MATRIX.md) · [UI-Matrix](P4_FEATURE_UI_MATRIX.md) · [offene Arbeiten](P4_REMAINING.md)

## Verbleibende Blocker (9)

1. Zero-to-Air-UI-Workflow
2. Linux Clean-Install/Reboot/Upgrade/TLS
3. Backup/Restore auf frischer Instanz
4. Windows-Dienst, Android, Docker-Persistenz
5. Update-Kanäle, transaktionaler Rollback
6. Systemdiagnose + UI-Abnahme
7. SFTP, Erweiterungen/Safe Mode, Bugreport
8. RBAC/IDOR/XSS, 3 Sender, 24-72h-Soak
9. Runtime-/Lizenzinventar

Keine Fantasie-Prozentwerte. Keine Veröffentlichung als qualifizierte Beta ohne Nachweis aller Blocker.
