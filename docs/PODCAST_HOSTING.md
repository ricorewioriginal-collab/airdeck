# Podcast: echter öffentlicher Link

Der Feed (`/api/v1/public/stations/<sender>/podcast.xml`) wird vom Server erzeugt. Podcast-Verzeichnisse wie Apple Podcasts oder Spotify rufen ihn aus dem Internet ab – eine lokale Adresse (`localhost`, `192.168…`) funktioniert dafür nicht. Es gibt zwei kostenlose Wege; im Studio unter **Aufnahme & Podcast → Öffentlicher Link**.

## 1 · Dieser Server mit öffentlicher Adresse

Die Adresse wird eingetragen, damit Feed-, Audio- und Cover-Links sie statt des lokalen Hosts enthalten. **Erreichbarkeit prüfen** ruft den Feed von dort ab. Der Server muss laufen, solange Hörer oder Verzeichnisse abrufen.

Kostenlose Tunnel:

- **Tailscale Funnel** (stabile `https://<rechner>.<tailnet>.ts.net`-Adresse): `tailscale funnel 8080` (Port des Servers einsetzen). Funnel muss in der Tailscale-Verwaltung freigeschaltet sein.
- **Cloudflare Tunnel**: Mit eigener Domain `cloudflared tunnel --url http://localhost:8080` (schnell, wechselnde Adresse) oder ein benannter Tunnel mit fester Adresse.
- Eigene Domain mit Reverse-Proxy (Caddy/nginx) und HTTPS.

Nur die Pfade unter `/api/v1/public/` müssen von außen erreichbar sein; das Studio selbst kann geschützt bleiben.

## 2 · Kostenloser Podcast-Hoster

Der Hoster betreibt den öffentlichen Feed, der Server muss nicht erreichbar sein. Episoden werden hochgeladen (Button ⇪ in der Episodenliste oder automatisch für Auto-Episoden).

| Hoster | Einrichtung | Grenzen des kostenlosen Tarifs |
|---|---|---|
| **Buzzsprout** | Podcast-ID (Ziffern in der Dashboard-Adresse) und API-Token (Profil → API) | 2 Stunden Upload pro Monat, Episoden 90 Tage; Feed `https://feeds.buzzsprout.com/<id>.rss` |
| **Podbean** | Client-ID und -Secret (podbean.com/api → Meine Apps), Feed-Adresse optional | 5 Stunden Speicher insgesamt, max. 100 MB je Datei |

Zugangsdaten liegen verschlüsselt im Secret-Store und verlassen den Server nie über die API. Lokal als Entwurf angelegte Episoden werden beim Hoster als Entwurf/privat angelegt, veröffentlichte dort veröffentlicht. Eine Episode wird nie doppelt hochgeladen. Bei Buzzsprout wird nach dem Upload auf die Kodierung gewartet (bis ca. 2 Minuten); dauert sie länger, bleibt die Episode privat und wird dort veröffentlicht.

Spotify for Creators bietet keine Upload-Schnittstelle: den Feed (Weg 1) oder den Hoster-Feed (Weg 2) dort unter „RSS-Feed importieren“ eintragen.

## API

- `PUT /api/v1/stations/:sid/podcast` mit `publicBaseUrl` (leer = entfernen)
- `POST /api/v1/stations/:sid/podcast/check` – Erreichbarkeit der öffentlichen Adresse
- `PUT /api/v1/stations/:sid/podcast/host` – `{kind: "buzzsprout"|"podbean"|"", podcastId, token | clientId, clientSecret, feedUrl, autoPush}`
- `POST /api/v1/stations/:sid/podcast/host/test` – Zugangsdaten prüfen
- `POST /api/v1/stations/:sid/podcast/episodes/:id/push` – Episode hochladen
