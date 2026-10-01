# AnMaCha-Cast-Demo (öffentliche Testinstanz)

Pfade, Hostnamen, Container-/Dienstnamen in diesem Ordner bleiben bewusst "airdeck(-demo)"
(siehe docs/REBRANDING_ANMACHA_CAST.md Phase 7): der laufende Demo-Server, sein DNS-Eintrag und
sein TLS-Zertifikat zeigen bereits auf diese Namen.

Die Demo setzt sich **alle 10 Minuten vollständig zurück** und ist von produktiven Installationen getrennt.

## Vollfunktions-Demo mit hörbarem Stream

Die Demo enthält ffmpeg und Icecast. AnMaCha Cast sendet intern an `127.0.0.1:8000/airdeck-demo.mp3`; dieser Encoder-Endpunkt bleibt privat. Für Besucher wird ausschließlich der Mount über den HTTPS-Reverse-Proxy veröffentlicht:

`https://airdeck-demo.ricorewi-radio.de/stream/airdeck-demo.mp3`

Damit können Player, Encoder, Automation, Queue, Now Playing und Streamstatus nicht nur optisch, sondern mit echter Audio-Ausgabe getestet werden. Die Testmedien sind synthetisch erzeugte Töne; produktive Streaming-Zugangsdaten werden nicht verwendet.

## Netzwerkmodell

```text
AnMaCha Cast/Encoder (Container)
        |
        v
Icecast :8000 (Container)
        |
        v
127.0.0.1:8752 (Host, nicht extern offen)
        |
        v
HTTPS Reverse Proxy /stream/*
        |
        v
öffentlicher Demo-Stream
```

AnMaCha Cast selbst ist am Host nur über `127.0.0.1:8751` erreichbar. Icecast ist nur über `127.0.0.1:8752` erreichbar. Firewall/NAT sollen beide Ports nicht öffentlich freigeben.

## Einrichtung

1. `airdeck-demo.ricorewi-radio.de` per DNS auf den Demo-Server zeigen lassen.
2. Passendes Reverse-Proxy-Snippet verwenden: [`nginx.demo.conf`](nginx.demo.conf), [`Caddyfile.demo`](Caddyfile.demo) oder [`apache.demo.conf`](apache.demo.conf).
3. Demo starten:
   ```bash
   docker compose -f packaging/demo/docker-compose.demo.yml up -d --build
   ```
4. Reset alle 10 Minuten:
   ```text
   */10 * * * * /opt/airdeck-demo/packaging/demo/reset-demo.sh >> /var/log/airdeck-demo-reset.log 2>&1
   ```

`reset-demo.sh` erzeugt Sender, Testmedien, Playlist, Queue, Automation, HLS, Zusatz-Streams-Ausgang und Demo-Zugang neu. Zusätzlich prüft es nach dem Start, ob der Icecast-Mount lokal tatsächlich Audio liefert.

## Zugang

| | |
|---|---|
| Benutzername | `demo` |
| Passwort | `airdeck-demo` |

Der Zugang ist auf die Demo beschränkt. Alle Demo-Daten werden beim nächsten Reset verworfen.

## Wichtig

- Keine echten Daten oder Secrets in der Demo ablegen.
- Der öffentliche Stream ist absichtlich hörbar; der Icecast-Admin-/Source-Port selbst bleibt privat.
- Falls der Stream nicht spielt, zuerst `curl http://127.0.0.1:8752/airdeck-demo.mp3` auf dem Server und danach die `/stream/`-Route des Reverse Proxys prüfen.
