# AnMaCha Cast auf iPhone und iPad

Eine native iOS-App ist ohne Apple-Entwicklerkonto (99 €/Jahr) nicht dauerhaft möglich – kostenlos signierte Apps laufen nur 7 Tage. Deshalb gibt es den **kostenlosen, unbefristeten Weg über die Web-App (PWA)**:

1. Auf dem iPhone in **Safari** die Adresse des AnMaCha-Cast-Servers öffnen (am besten `https://…`).
2. **Teilen → Zum Home-Bildschirm**. Die App startet danach im Vollbild wie eine normale App, ohne App Store, iTunes oder Apple-ID-Bindung.

Was enthalten ist: Studio, Bibliothek, Playlisten, Sendeplan, Podcast, Statistik, Radioadmin-Funktionen u. a. (gleiche Oberfläche wie im Browser), Offline-Hülle (die App öffnet auch ohne Netz, Daten kommen vom Server), Bildschirm bleibt während der Mikrofon-Sendung an (iOS 16.4+).

Grenzen (iOS-Vorgaben, nicht umgehbar):
- **Mikrofon nur über HTTPS** – bei `http://` sperrt Safari den Zugriff. Lösung: Server hinter einem HTTPS-Proxy/Tunnel (z. B. Caddy, Cloudflare Tunnel).
- **Kein Mikrofon im Hintergrund**: Beim Sperren des Bildschirms oder App-Wechsel stoppt iOS die Aufnahme. Für Live-Sendungen die App im Vordergrund lassen.
- Kein nativer Audio-Engine-Zugriff wie in der Android-App; Decks laufen im Browser-Audio.
