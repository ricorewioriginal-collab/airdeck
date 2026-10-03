# AnMaCha Cast – REST-API für eigene Werkzeuge

Alle Aufrufe gehen an `https://<server>/api/v1/…` mit dem Header `Authorization: Bearer <API-Schlüssel>`.
Antworten sind JSON (UTF-8). Schreibende Aufrufe senden JSON im Body (`Content-Type: application/json`).
Pro Schlüssel gelten 120 Anfragen pro Minute; danach kommt `429`.

**Schlüssel erzeugen:** Studio → *Mein Profil & API* → *Neuer API-Schlüssel*. Ein persönlicher Schlüssel hat nie mehr
Rechte als das eigene Konto, gilt nur für die eigenen Sender und wird ungültig, sobald das Konto gesperrt oder gelöscht
wird. Rechte werden als *Scopes* vergeben (z. B. `queue:write`); „Nur lesen“ enthält ausschließlich `…:read`.
Administratoren können unter *Benutzer & Rollen → API-Tokens* zusätzlich Sender-unabhängige Schlüssel anlegen.

Fehler kommen als `{ "error": "<code>", "message": "…" }` mit passendem HTTP-Status (`400` ungültig, `401` nicht
angemeldet, `403` Recht fehlt, `404` nicht gefunden, `409` Konflikt, `413` zu groß, `415` Dateityp, `429` zu viele).

## Lesen (Auswahl)

| GET | Recht | Liefert |
|---|---|---|
| `/me` | – | Wer bin ich: Rollen, Rechte, Sender |
| `/stations` | `branding:read` | Sender, die der Schlüssel sehen darf |
| `/stations/{id}/now-playing` | `now_playing:read` | Aktueller Titel, Dauer, Position, nächster Titel |
| `/stations/{id}/history?limit=50` | `now_playing:read` | Verlauf der gespielten Titel |
| `/stations/{id}/queue` | `queue:read` | Warteschlange |
| `/stations/{id}/media?q=&limit=` | `media:read` | Bibliothek (Suche) |
| `/stations/{id}/playlists` | `queue:read` | Playlists |
| `/stations/{id}/plans` | `automation:read` | Sendeplan |
| `/stations/{id}/stats?period=7d` | `now_playing:read` | Hörerstatistik |
| `/stations/{id}/polls`, `/forms`, `/draws` | `queue:read` | Umfragen, Formulare, Auslosungen |

Ohne Schlüssel erreichbar (öffentliche Senderseite): `/public/stations/{id}/page`, `/schedule`, `/charts`,
`/public/network`, `/public/site` sowie die Hörer-Endpunkte unter `/public/stations/{id}/listener/…`.

## Schreiben

### Warteschlange und Playout (`queue:write`, `automation:write`, `cardwall:trigger`)

| Methode | Pfad | Recht | Body / Wirkung |
|---|---|---|---|
| POST | `/stations/{id}/queue` | `queue:write` | `{ "mediaId": "…", "position"?: 0 }` – Titel einreihen |
| POST | `/stations/{id}/queue/{uid}/move` | `queue:write` | `{ "to": 2 }` |
| DELETE | `/stations/{id}/queue/{uid}` | `queue:write` | Eintrag entfernen |
| POST | `/stations/{id}/queue/clear` · `/shuffle` · `/next` | `queue:write` | Leeren, mischen, nächsten Titel aus der Rotation nachlegen |
| POST | `/stations/{id}/queue/fill` | `queue:write` | `{ "count": 10 }` – aus der Rotation auffüllen |
| POST | `/stations/{id}/queue/fill-from` | `queue:write` | `{ "playlistId": "…", "count": 10 }` |
| POST | `/stations/{id}/playout/start` · `/stop` · `/skip` | `automation:write` | Automation steuern |
| POST | `/stations/{id}/playout/mic` | `automation:write` | `{ "on": true }` – Mikrofon (Ducking) |
| PATCH | `/stations/{id}/playout` | `automation:write` | `{ "volume"?: 0.8, "crossfadeMs"?: 3000 }` |
| PUT | `/stations/{id}/mode` | `automation:write` | `{ "mode": "auto" \| "live" }` |
| POST | `/stations/{id}/onair` | `automation:write` | `{ "onAir": true, "note"?: "Morgenshow" }` |
| POST | `/stations/{id}/now-playing` | `automation:write` | `{ "title": "…", "artist": "…" }` – Metadaten von außen setzen |
| POST | `/stations/{id}/decks/{A-D}/{aktion}` | `automation:write` | Deck bedienen: `load`, `play`, `pause`, `stop`, `eject`, `seek` (`ms`), `tempo` (`tempo` 0,8–1,25, Tonhöhe bleibt), `loop` (`ms` = Schleifenlänge ab jetzt, 0 = verlassen), `advance` |
| GET | `/stations/{id}/media/{mid}/waveform` | `media:read` | Wellenform: 600 Spitzenwerte (0–100) |
| POST | `/stations/{id}/cardwall/{slot}/trigger` | `cardwall:trigger` | Cart abfeuern (Slot 0–…) |
| POST | `/stations/{id}/playout/carts-stop` | `cardwall:trigger` | Alle Carts stoppen |
| POST | `/stations/{id}/quick/{category}` | `cardwall:trigger` | Zufälligen Jingle/Spot einer Kategorie spielen |

### Bibliothek und Playlists (`media:write`, `queue:write`)

| Methode | Pfad | Recht | Body / Wirkung |
|---|---|---|---|
| PUT | `/stations/{id}/media?name=Titel.mp3` | `media:write` | Rohdaten der Audiodatei als Body (Upload) |
| POST | `/stations/{id}/media/url` | `media:write` | `{ "url": "https://…" }` – von einer Adresse laden |
| PATCH | `/stations/{id}/media/{mediaId}` | `media:write` | `{ "title"?, "artist"?, "category"?, "tags"?: [] }` |
| DELETE | `/stations/{id}/media/{mediaId}` | `media:write` | Titel löschen |
| POST | `/stations/{id}/playlists` | `queue:write` | `{ "name": "…" }` |
| PATCH | `/stations/{id}/playlists/{plId}` | `queue:write` | `{ "name"?, "items"?: ["mediaId", …] }` |
| POST | `/stations/{id}/playlists/{plId}/play` | `automation:write` | Playlist sofort spielen |
| POST | `/stations/{id}/m3u/import` | `queue:write` | `{ "name": "…", "m3u": "#EXTM3U…" }` |

### Sendeplan und Uhr (`automation:write`)

| Methode | Pfad | Body |
|---|---|---|
| POST | `/stations/{id}/plans` | `{ "label": "Morgenshow", "days": [1,2,3,4,5], "from": "06:00", "to": "10:00", "playlistId": "…" }` |
| PATCH / DELETE | `/stations/{id}/plans/{planId}` | Felder wie oben |
| POST | `/stations/{id}/clock-events` | `{ "label": "Nachrichten", "at": "00", "kind": "jingle", "mediaId": "…" }` |
| POST | `/stations/{id}/clock-events/{evId}/fire` | Sofort auslösen |
| POST | `/stations/{id}/jobs` | `{ "kind": "…", "at": "2026-10-03T12:00:00Z", … }` – zeitgesteuerte Aufgabe |

### Hörer-Interaktion und Community (`stations:write`, `queue:write`)

| Methode | Pfad | Recht | Body |
|---|---|---|---|
| PUT | `/stations/{id}/listener` | `stations:write` | `{ "requests": true, "messages": true, "votes": true, "polls": true, "forms": true }` |
| POST | `/stations/{id}/inbox/{msgId}/{action}` | `queue:write` | `action` = `read`, `star`, `queue`, `delete` |
| POST | `/stations/{id}/polls` | `stations:write` | `{ "question": "…", "options": ["A", "B"], "active": true }` |
| PATCH / DELETE | `/stations/{id}/polls/{pollId}` | `stations:write` | `{ "active": false }` – Optionen sind nach der ersten Stimme fest |
| POST | `/stations/{id}/forms` | `stations:write` | `{ "title": "…", "fields": [{ "label": "Name", "type": "text", "required": true }], "thanks": "…" }` |
| DELETE | `/stations/{id}/form-entries/{entryId}` | `stations:write` | Eintrag löschen |
| POST | `/stations/{id}/draw` | `stations:write` | `{ "names": ["…"], "mode": "normal" \| "multi" \| "elim", "count": 3, "label": "Karten" }` |
| DELETE | `/stations/{id}/draws` | `stations:write` | Protokoll leeren |

### Sender, Ausgänge, Aufnahme

| Methode | Pfad | Recht | Body |
|---|---|---|---|
| POST | `/stations` | `stations:write` | `{ "id": "zwei", "name": "Sender Zwei" }` |
| PATCH | `/stations/{id}` | `stations:write` | `{ "name"?, "slogan"?, "genre"?, "primaryColor"?, "public"? }` |
| PUT | `/stations/{id}/logo` | `stations:write` | Bilddaten als Body (≤ 2 MB) |
| POST | `/stations/{id}/outputs` | `outputs:write` | `{ "kind": "icecast", "host": "…", "port": 8000, "mount": "/live", "password": "…" }` |
| PATCH / DELETE | `/stations/{id}/outputs/{outId}` | `outputs:write` | `{ "enabled": false }` |
| POST | `/stations/{id}/recorder/start` · `/stop` | `automation:write` | Mitschnitt |
| POST | `/stations/{id}/recap/email` | `automation:write` | `{ "to": "…" }` – Sendungs-Rückblick per Mail |

### Konto

| Methode | Pfad | Body |
|---|---|---|
| PATCH | `/me/profile` | `{ "name"?: "…", "links"?: { "website": "https://…", "instagram": "@name" } }` (nur Sitzung) |
| POST | `/me/tokens` | `{ "name": "OBS", "scopes": ["now_playing:read"] }` → `{ "token": "ad_…", "info": {…} }` (nur Sitzung) |
| DELETE | `/me/tokens/{tokId}` | Eigenen Schlüssel widerrufen |
| POST | `/auth/password` | `{ "current": "…", "next": "…" }` |

## Live-Ereignisse

`GET /api/v1/events?station={id}` liefert Server-Sent Events (`now_playing`, `queue.changed`, `inbox.changed`,
`community.changed`, `site.changed`, …). Für Icecast/AzuraCast/laut.fm-Brücken und Webhooks siehe [BRIDGE.md](BRIDGE.md).

## Beispiel

```bash
# Titel suchen und einreihen
curl -H "Authorization: Bearer $KEY" "https://radio.example/api/v1/stations/main/media?q=sommer&limit=1"
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"mediaId":"med_abc123"}' https://radio.example/api/v1/stations/main/queue
```
