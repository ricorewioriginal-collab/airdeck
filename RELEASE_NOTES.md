# AirDeck v1.0.0-beta.1 – Release Notes

**Veröffentlichung:** Geplant  
**Branch:** `release/v1.0.0-beta.1`  
**Stand:** 27.09.2026

---

## 🎯 Was ist neu

### Kern & Automatisierung
- **4 Decks** mit CUE/PFL, Play/Pause/Stop/Seek
- **Cardwall** mit 12 Slots, Ducking, Gruppen
- **Queue** mit Backtiming, Drag & Drop
- **Playlistverwaltung** mit Manuell/Shuffle-Modi
- **Rotation** mit Interpreten-/Genre-Trennung
- **Sendeplan** mit Zeitplan, Stunden-Uhr, Sendeplan-Raster
- **Automation** 24/7 mit Crossfade, Silence Detection, Notfall-Ordner
- **Source Priority Engine** mit Anti-Flapping, Fallback-Ketten, RBAC

### Audio & Streaming
- **DSP-Kette:** 10-Band-EQ, Kompressor, Limiter, AGC, Multiband
- **Encoder:** LAME-MP3 (CBR/VBR), AAC, Opus
- **Ausgänge:** Icecast, SHOUTcast v1/v2, laut.fm
- **AirDeckCast:** Eigene Streaming-Schicht mit HLS, alternative Profile
- **Liquidsoap**-Unterstützung

### Plattformen
- **Windows:** Installer (Inno Setup), Portable ZIP, Tray-Symbol
- **Android:** Handy-Sender (Mikrofon + Musik), Studio-Fernbedienung
- **Linux:** Debian-Paket mit systemd-Dienst
- **Docker:** amd64 + arm64 (Raspberry Pi 4/5)

### Sicherheit & Betrieb
- **Benutzerverwaltung** mit Rollen: Admin, Sendeleitung, Redaktion, Moderation, Ansicht
- **Geräte-Pairing** mit QR-Code, Kamera-Scan, LAN-Discovery
- **Backup/Restore** mit verschlüsselten Secrets
- **Update-System** mit Klick-Updates
- **Systemdiagnose** mit Health-Checks

### KI-Automation
- **Director:** Moderation, Nachrichten, Musikplanung
- **Provider:** OpenAI, Anthropic, Gemini, Ollama/LM Studio
- **TTS:** OpenAI, ElevenLabs, Kokoro, Piper

---

## ⚠️ Bekannte Einschränkungen (Beta)

| Bereich | Einschränkung |
|---|---|
| **Zero-to-Air** | Noch nicht vollständig nachgewiesen |
| **Clean-Install** | Noch nicht vollständig nachgewiesen |
| **24h-Soak** | Noch nicht durchgeführt |
| **SFTP** | Nicht implementiert |
| **Extensions** | Nicht implementiert |
| **Bugreport** | Zentrales Backend fehlt |
| **Lizenzinventar** | Nicht vollständig |
| **Windows-Signierung** | Zertifikat optional |

---

## 📋 Voraussetzungen

- **Node.js:** ≥ 22.18
- **ffmpeg:** Für Audio-Encoder/Decoder
- **Datenbank:** SQLite (Standard), PostgreSQL, MySQL

---

## 🚀 Installation

### Windows
```bash
# Installer
AirDeck-Setup.exe

# Oder Portable
AirDeck-Windows-Portable.zip
```

### Linux
```bash
sudo apt install ./AirDeck-Linux.deb
```

### Docker
```bash
docker compose up -d
```

### Android
APK aus dem Release herunterladen und im Studio verbinden.

---

## 📄 Lizenz

Privates Hobbyprojekt. Siehe [HAFTUNGSAUSSCHLUSS.md](HAFTUNGSAUSSCHLUSS.md).

---

## 🔗 Links

- **Repository:** https://github.com/ricorewioriginal-collab/anmacha_control
- **Demo:** https://airdeck-demo.ricorewi-radio.de
- **Dokumentation:** [docs/](docs/)
