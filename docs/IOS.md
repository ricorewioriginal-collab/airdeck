# AnMaCha Cast auf iPhone und iPad

Eine native iOS-App ist ohne Apple-Entwicklerkonto (99 €/Jahr) nicht dauerhaft möglich – kostenlos signierte Apps laufen nur 7 Tage. Deshalb gibt es den **kostenlosen, unbefristeten Weg über die Web-App (PWA)**:

1. Auf dem iPhone in **Safari** die Adresse des AnMaCha-Cast-Servers öffnen (am besten `https://…`).
2. **Teilen → Zum Home-Bildschirm**. Die App startet danach im Vollbild wie eine normale App, ohne App Store, iTunes oder Apple-ID-Bindung.

Was enthalten ist: Studio, Bibliothek, Playlisten, Sendeplan, Podcast, Statistik, Radioadmin-Funktionen u. a. (gleiche Oberfläche wie im Browser), Offline-Hülle (die App öffnet auch ohne Netz, Daten kommen vom Server), Bildschirm bleibt während der Mikrofon-Sendung an (iOS 16.4+).

Grenzen (iOS-Vorgaben, nicht umgehbar):
- **Mikrofon nur über HTTPS** – bei `http://` sperrt Safari den Zugriff. Lösung: Server hinter einem HTTPS-Proxy/Tunnel (z. B. Caddy, Cloudflare Tunnel).
- **Kein Mikrofon im Hintergrund**: Beim Sperren des Bildschirms oder App-Wechsel stoppt iOS die Aufnahme. Für Live-Sendungen die App im Vordergrund lassen.
- Kein nativer Audio-Engine-Zugriff wie in der Android-App; Decks laufen im Browser-Audio.

## AnMaCha Cast Mobil (`/mobil.html`)

Die Android-Betriebsarten als Web-App – auf dem iPhone `https://<server>/mobil.html` öffnen und zum Home-Bildschirm hinzufügen:

| Tab | Funktionen |
|---|---|
| **Go Live** | Mikrofon als Live-Quelle (ON AIR), Push-to-Talk, Pegelanzeige, Bildschirm bleibt an; Läuft gerade/Weiter/Auffüllen; Musik vom Handy hochladen und in die Warteschlange; Warteschlange bearbeiten |
| **Studio** | 4 Decks (Play/Pause/Stop), Mediathek-Suche → Deck oder Queue, Playlisten starten |
| **Radioadmin** | laut.fm: Hörer jetzt, Titelsuche → Playlist, Playlisten; alles Weitere (Upload mit Optionen, Tags, Algorithmen, Sendeplan, Statistik) im vollständigen Studio |

Wichtig: Anders als die Android-App sendet die Web-App **nicht direkt** an Icecast/laut.fm (Browser können keine Icecast-Verbindung aufbauen). Das Mikrofon geht an einen AnMaCha-Cast-Server (z. B. die Windows-App oder Docker), der dann weitersendet. Dieser Server muss per HTTPS erreichbar sein.

### Direkt von GitHub

Ohne eigene Adresse für die Oberfläche: **https://ricorewioriginal-collab.github.io/anmacha_cast/app/** öffnen, die Adresse des eigenen Servers (`https://…`) und Anmeldung eintragen, dann „Zum Home-Bildschirm“. Der Server erlaubt diese Seite automatisch (CORS). Ein fertiger Verbindungslink hat die Form `…/app/#server=https://dein-server&token=…`.

### Erreichbarkeit aus dem Studio

Im Studio (Seitenleiste, unten) öffnet **„Mobil-App (iPhone/Handy)“** direkt `mobil.html` – bereits angemeldet. Auf dem iPhone dort „Teilen → Zum Home-Bildschirm“ wählen. Die Adresse des eigenen Servers lautet `https://<server>/mobil.html`.

### Download-Seite (nicht gelistet)

`https://ricorewioriginal-collab.github.io/anmacha_cast/ios.html` – eigene Installationsseite mit `noindex`, ohne Menüeintrag auf der Projektseite; verlinkt in der README. Für die Website ricorewi-radio.de (Bereich „Downloads“) genügt ein Link auf diese Adresse, z. B.:

```html
<a href="https://ricorewioriginal-collab.github.io/anmacha_cast/ios.html" rel="noopener">AnMaCha Cast für iPhone &amp; iPad (Web-App)</a>
```
