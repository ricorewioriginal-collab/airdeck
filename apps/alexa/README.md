# AirDeck Alexa Radio Skill

Status: preparation / architecture foundation

## Goal
Provide an Alexa audio skill that can play:

1. public AirDeck station streams explicitly published for Alexa, and
2. public laut.fm stations discovered through the official public laut.fm API.

The skill is a playback/discovery client. It does not become a second AirDeck automation engine and it must never expose AirDeck administration, provider credentials, source passwords, MusicHub files, or private/internal streams.

## Core architecture

```text
Alexa device
  -> Alexa Skills Kit / AudioPlayer
  -> AirDeck Alexa skill backend
      -> AirDeck public station directory / Alexa publication endpoint
      -> laut.fm public API/search
  -> resolved public HTTPS audio stream
  -> Alexa AudioPlayer
```

## Alexa playback constraints
The implementation must follow the current Alexa AudioPlayer requirements. In particular, resolved streams must be publicly reachable through HTTPS on port 443 with a trusted certificate and use a supported audio/playlist format and bitrate. Do not assume a localhost/LAN AirDeck mount can be played by Alexa.

## Station sources

### AirDeck
Only stations whose owner/admin explicitly enables `Publish to Alexa` may enter the Alexa directory. The public Alexa projection should expose only safe metadata such as station id/slug, display name, aliases, public artwork, public description, public stream URL, optional current-title metadata and availability.

Never expose internal output configuration or stream/source credentials.

### laut.fm
Use the official public laut.fm API/search capabilities for station discovery and current public station information. Do not copy or maintain a static full catalog when the official API can resolve it dynamically. Cache conservatively and respect provider terms/rate limits.

## Initial intents
- Launch/help
- Play station by name
- Search/play laut.fm station by name
- Play an AirDeck station by name
- Stop/cancel
- Resume/play
- Help

Example UX targets (interaction-model wording must be certification-tested):
- `Alexa, öffne AirDeck Radio und spiele RadioAmBad.`
- `Alexa, öffne AirDeck Radio und spiele den laut.fm Sender <Name>.`
- `Alexa, sage AirDeck Radio, spiele <Sendername>.`

Do not promise invocation forms that the Alexa interaction model has not actually accepted.

## Name resolution
Station names are ambiguous. Resolution must normalize spelling, punctuation, whitespace and common spoken variants, but must not silently choose an unrelated station when multiple strong matches exist. Prefer exact normalized match; otherwise ask a short disambiguation question.

AirDeck aliases must be admin-managed and audited. laut.fm names/metadata come from the official API.

## Security boundary
The Alexa backend is public-facing and separate from privileged AirDeck control APIs. Public station lookup must be read-only. No AirDeck admin session or source password is sent to Alexa. If account linking is added later for favorites/private personalization, use narrowly scoped tokens and do not turn it into remote administration by default.

## Metadata
For screen-capable Alexa devices, provide safe AudioPlayer metadata/artwork when available. Metadata must be derived from public station/now-playing data only. Stream tokens should be opaque and must not contain credentials or undefined customer data.

## Failure behavior
Handle at least:
- unknown station
- ambiguous station
- station exists but is not Alexa-published
- provider API unavailable
- stream unavailable
- unsupported/non-HTTPS stream
- AudioPlayer PlaybackFailed

Never fall back from a requested private AirDeck station to an internal URL.

## Testing gates
Before production/certification:
- real Echo-device playback test (simulator alone is insufficient for AudioPlayer playback)
- German `de-DE` interaction model tests
- exact/ambiguous station-name tests
- AirDeck publication permission tests
- laut.fm discovery tests
- HTTPS/format validation
- long-running live playback
- stop/resume/playback-controller behavior
- provider outage and stream failure tests
- no credentials/private station metadata in responses/logs

## Repository rule
This folder is intentionally a foundation. Before adding Lambda/web-service implementation, audit current AirDeck public station/output routes and define the smallest safe public Alexa station projection. Do not invent privileged AirDeck endpoints.