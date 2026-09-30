#!/bin/sh
# Setzt die öffentliche AirDeck-Demo komplett zurück. Die Instanz wird alle 10 Minuten verworfen.
set -e
cd "$(dirname "$0")/../.."
compose="docker compose -f packaging/demo/docker-compose.demo.yml"
public_stream="${AIRDECK_DEMO_PUBLIC_STREAM_URL:-https://airdeck-demo.ricorewi-radio.de/stream/airdeck-demo.mp3}"

echo "[$(date -Is)] Demo wird zurückgesetzt ..."
$compose down -v --remove-orphans
$compose up -d

ok=""
for i in $(seq 1 30); do
  if curl -fs http://127.0.0.1:8751/api/v1/health | grep -q '"ok":true'; then ok=1; break; fi
  sleep 1
done
[ -n "$ok" ] || { echo "Health-Check nach 30 s nicht erreicht."; exit 0; }

token=$($compose logs airdeck-demo 2>/dev/null | grep -o 'ad_[A-Za-z0-9_-]*' | head -1)
[ -n "$token" ] || { echo "Kein Admin-Token gefunden."; exit 0; }
api="http://127.0.0.1:8751/api/v1/stations/main"
auth="Authorization: Bearer $token"

curl -fs -X PATCH -H "$auth" -H "Content-Type: application/json" -d '{"name":"AirDeck-FM","slogan":"Testinstanz - setzt sich alle 10 Minuten zurueck"}' "$api" >/dev/null
curl -fs -X PUT -H "$auth" -H "Content-Type: application/json" -d '{"requests":true,"messages":true,"voting":true,"voice":true}' "$api/listener" >/dev/null

# Encoder-Ziel bleibt intern. publicUrl ist ausschließlich die hörbare HTTPS-Adresse für Browser,
# Dokumentation und Tests; Zugangsdaten bzw. Port 8000 werden nicht öffentlich exponiert.
curl -fs -X POST -H "$auth" -H "Content-Type: application/json" \
  -d "{\"name\":\"AirDeckCast Demo\",\"type\":\"icecast\",\"host\":\"127.0.0.1\",\"port\":8000,\"mount\":\"/airdeck-demo.mp3\",\"username\":\"source\",\"password\":\"airdeck-demo-source\",\"bitrateKbps\":128,\"enabled\":true,\"publicUrl\":\"$public_stream\"}" \
  "$api/outputs" >/dev/null

upload_tone() {
  freq="$1"; name="$2"; category="$3"; dur="${4:-8}"
  $compose exec -T airdeck-demo ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=${freq}:duration=${dur}" -c:a pcm_s16le -f wav - \
    | curl -fs -X PUT -H "$auth" -H "Content-Type: audio/wav" --data-binary @- "http://127.0.0.1:8751/api/v1/stations/main/media?name=${name}.wav&category=${category}"
}
track_a="$(upload_tone 440 DemoTrack-A music 12 | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
track_b="$(upload_tone 554 DemoTrack-B music 12 | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
track_c="$(upload_tone 659 DemoTrack-C music 12 | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
station_id="$(upload_tone 880 AirDeck-FM-ID station_id 3 | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
jingle="$(upload_tone 988 Demo-Jingle jingle 3 | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"

curl -fs -X PATCH -H "$auth" -H "Content-Type: application/json" -d "{\"mediaId\":\"$jingle\",\"label\":\"Demo Jingle\"}" "$api/cardwall/cart1" >/dev/null
curl -fs -X PATCH -H "$auth" -H "Content-Type: application/json" -d "{\"mediaId\":\"$station_id\",\"label\":\"AirDeck-FM ID\"}" "$api/cardwall/cart2" >/dev/null
curl -fs -X PATCH -H "$auth" -H "Content-Type: application/json" -d "{\"mediaId\":\"$track_a\",\"label\":\"Demo Track A\"}" "$api/cardwall/cart3" >/dev/null

playlist_json=$(curl -fs -X POST -H "$auth" -H "Content-Type: application/json" -d "{\"name\":\"AirDeck Demo Rotation\",\"color\":\"#22a6ff\",\"items\":[\"$track_a\",\"$track_b\",\"$track_c\",\"$station_id\",\"$jingle\"]}" "$api/playlists")
playlist_id=$(printf '%s' "$playlist_json" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [ -n "$playlist_id" ]; then
  curl -fs -X POST -H "$auth" -H "Content-Type: application/json" -d "{\"label\":\"Demo Rotation\",\"days\":[],\"from\":\"00:00\",\"to\":\"23:59\",\"playlistId\":\"$playlist_id\",\"shuffle\":true}" "$api/plans" >/dev/null
fi

curl -fs -X PATCH -H "$auth" -H "Content-Type: application/json" -d '{"autostart":true,"hls":{"enabled":true,"bitrateKbps":96,"segmentSeconds":2}}' "$api/playout" >/dev/null || true
curl -fs -X POST -H "$auth" -H "Content-Type: application/json" -d '{"autostart":true}' "$api/playout/start" >/dev/null || true
for mid in "$track_b" "$track_c" "$station_id" "$track_a" "$jingle"; do curl -fs -X POST -H "$auth" -H "Content-Type: application/json" -d "{\"mediaId\":\"$mid\"}" "$api/queue" >/dev/null; done

demo_user="${AIRDECK_DEMO_USER:-demo}"
demo_pass="${AIRDECK_DEMO_PASSWORD:-airdeck-demo}"
curl -fs -X POST -H "$auth" -H "Content-Type: application/json" -d "{\"username\":\"$demo_user\",\"name\":\"Demo\",\"password\":\"$demo_pass\",\"roles\":[\"admin\"],\"stationIds\":[\"main\"],\"mustChangePassword\":false}" "http://127.0.0.1:8751/api/v1/users" >/dev/null

# MusicHub in der öffentlichen Demo mit echten vorhandenen Demo-Medien befüllen.
# Keine Fake-Cloudquelle und keine externen Zugangsdaten: der Demo-Nutzer kann die Cloud-Dialoge selbst öffnen.
demo_login=$(curl -fs -X POST -H "Content-Type: application/json"   -d "{\"username\":\"$demo_user\",\"password\":\"$demo_pass\"}"   "http://127.0.0.1:8751/api/v1/auth/login")
demo_token=$(printf '%s' "$demo_login" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).token||''))")
if [ -n "$demo_token" ]; then
  demo_auth="Authorization: Bearer $demo_token"
  hub_item_json=$(curl -fs -X POST -H "$demo_auth" -H "Content-Type: application/json"     -d "{\"stationId\":\"main\",\"mediaId\":\"$track_a\"}"     "http://127.0.0.1:8751/api/v1/music-hub/items")
  hub_item_id=$(printf '%s' "$hub_item_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).id||''))")
  hub_collection_json=$(curl -fs -X POST -H "$demo_auth" -H "Content-Type: application/json"     -d '{"owner":{"kind":"station","id":"main"},"name":"MusicHub Demo"}'     "http://127.0.0.1:8751/api/v1/music-hub/collections")
  hub_collection_id=$(printf '%s' "$hub_collection_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).id||''))")
  hub_collection_revision=$(printf '%s' "$hub_collection_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).revision||1)))")
  if [ -n "$hub_item_id" ] && [ -n "$hub_collection_id" ]; then
    curl -fs -X PUT -H "$demo_auth" -H "Content-Type: application/json"       -d "{\"stationId\":\"main\",\"revision\":$hub_collection_revision,\"itemIds\":[\"$hub_item_id\"]}"       "http://127.0.0.1:8751/api/v1/music-hub/collections/$hub_collection_id/items" >/dev/null
    echo "MusicHub-Demo seeded: DemoTrack-A + MusicHub Demo"
  fi
fi

# Lokalen Icecast-Mount prüfen. Ein Fehler beendet den Reset nicht, wird aber deutlich geloggt.
stream_ok=""
for i in $(seq 1 20); do
  if curl -fs --max-time 2 -r 0-1023 http://127.0.0.1:8752/airdeck-demo.mp3 >/dev/null 2>&1; then stream_ok=1; break; fi
  sleep 1
done
if [ -n "$stream_ok" ]; then
  echo "Demo-Stream lokal erreichbar; öffentliche Playback-URL: $public_stream"
else
  echo "WARNUNG: Icecast-Mount war nach dem Reset noch nicht hörbar. AirDeck bleibt erreichbar."
fi

echo "[$(date -Is)] Demo zurückgesetzt: $public_stream"
