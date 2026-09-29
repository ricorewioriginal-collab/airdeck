# Alexa Radio Skill – AirDeck + laut.fm

## Objective
Prepare one Alexa listening experience that resolves and streams public AirDeck stations and public laut.fm stations without duplicating AirDeck playout or importing provider secrets.

## Product scope – phase 1
- German (`de-DE`) first.
- Custom Alexa skill with AudioPlayer for long-form/live audio.
- Search/resolve public AirDeck stations that opted into Alexa publication.
- Search/resolve public laut.fm stations through the official public laut.fm API/search service.
- Play/stop/resume and playback status handling.
- Metadata/artwork for devices with screens where supported.

Phase 1 is listening only. No AirDeck automation control, scheduling edits, MusicHub access, uploads, server administration or streaming credentials.

## Why a resolver layer is required
Alexa AudioPlayer needs a public HTTPS stream endpoint. Many AirDeck outputs may be localhost-only, LAN-only, credentialed, or unsuitable for Alexa. The skill backend therefore resolves a station into a deliberately public playback descriptor rather than returning raw AirDeck output objects.

Suggested safe descriptor:

```ts
type AlexaStation = {
  source: "airdeck" | "lautfm";
  id: string;
  name: string;
  aliases?: string[];
  streamUrl: string;
  artworkUrl?: string;
  description?: string;
  nowPlaying?: { title?: string; artist?: string };
};
```

`streamUrl` must contain no embedded username/password/token that would expose a privileged source credential.

## AirDeck publication model
Add only after auditing existing public station/output models.

Desired semantics:
- `alexaPublished: boolean`, default false.
- optional spoken aliases.
- one explicit public playback output selected for Alexa.
- server-side validation that the selected URL is an allowed public listening stream, not a source/admin endpoint.
- publication/update/revocation audit event.
- revocation takes effect for new resolutions immediately.

If equivalent public-directory fields already exist, reuse them rather than adding duplicate schema.

## laut.fm integration
Use the official public laut.fm API for discovery/information. Current public documentation includes station listings, station lookup, current song, schedules and related station resources, plus a search API. The implementation must confirm the actual stream field/URL from the current API response before coding playback.

Do not scrape laut.fm pages. Do not use Radioadmin credentials for public listening. Do not mirror all stations into the AirDeck database merely to support Alexa.

### Caching
Use short-lived cache entries for station discovery/resolution to reduce provider load. Provider errors must not poison the cache indefinitely. Station availability and stream URLs can change, so avoid permanent assumptions.

## Alexa implementation
Preferred deployment options:
1. AWS Lambda using the Alexa SDK, or
2. an HTTPS web service that implements Alexa request verification correctly.

Select based on existing AirDeck deployment/operations after audit; do not put the skill handler inside the realtime playout path.

### AudioPlayer
Use `AudioPlayer.Play` with `REPLACE_ALL` for station changes. Handle playback lifecycle requests including started/stopped/failed and the relevant controller/built-in playback intents.

Live radio normally uses offset 0. Do not model a live station as a finite queue of songs merely because Alexa supports queues.

### Stream validation
Before marking a station Alexa-compatible, validate:
- public internet reachability
- HTTPS
- trusted certificate
- port 443
- supported format/container
- supported bitrate range
- no authentication challenge intended for a private stream

AirDeck should expose compatibility status to admins, e.g. `Alexa compatible`, `private/local only`, or a concrete validation failure.

## Voice model
Initial custom slots/intents:

- `PlayStationIntent`
  - slot `stationName`
  - optional source hint (`airdeck`, `laut.fm`)
- built-in stop/cancel/help/play/resume intents as appropriate

Resolution algorithm:
1. normalize requested name;
2. exact AirDeck alias/name match among Alexa-published stations;
3. exact laut.fm station match when source is explicit or no AirDeck exact match exists;
4. ranked fuzzy candidates;
5. if ambiguity remains, ask the user to choose rather than guessing.

The actual German utterance set must be tested against Alexa model conflicts and certification requirements.

## Search breadth
“All laut.fm stations” means the skill can resolve/search the public catalog through the provider API; it does not mean hardcoding every station name into the Alexa interaction model. Use a station-name slot strategy and backend search/resolution suitable for a changing catalog.

## Privacy and security
- No AirDeck admin/source/provider secrets in Alexa responses, tokens or logs.
- No private station appears in public Alexa discovery.
- Do not use a source/encoder URL as a listener URL.
- Sanitize external artwork/metadata.
- Rate-limit public resolver endpoints.
- Treat station names/provider data as untrusted input.
- Avoid SSRF: never fetch an arbitrary URL supplied by an Alexa utterance. Resolve only trusted AirDeck publication records or URLs returned/validated from supported provider integration.

## Operational design
Keep provider adapters separate:

```text
StationResolver
  |- AirDeckPublicStationProvider
  `- LautFmPublicStationProvider
```

Then:

```text
Alexa request
 -> intent parsing
 -> StationResolver
 -> StreamCompatibilityValidator
 -> AudioPlayer.Play response
```

This makes future public providers possible without coupling them to AirDeck automation.

## Observability
Record privacy-safe operational events:
- requested normalized station name
- provider chosen
- resolution result type
- playback directive issued
- playback failed reason category
- provider latency/error category

Do not log credentials, raw auth headers or sensitive Alexa user data unnecessarily.

## Certification/readiness checklist
- skill metadata/privacy policy/terms prepared
- invocation name verified
- German voice model built successfully
- AudioPlayer interface enabled
- real Echo tests completed
- stream endpoints 24/7 accessible for certification
- station artwork reachable over HTTPS
- playback stable for several minutes
- built-in playback intents work
- failure responses are understandable
- no misleading claim that private/local AirDeck streams are Alexa-playable
- provider attribution/terms checked before publication

## Future phases
- favorites/recent stations
- account linking for personalized AirDeck favorites (not required for public listening)
- Echo Show richer presentation
- voice query: current song / schedule, when backed by public metadata
- optional AirDeck admin-controlled aliases and featured stations

Remote studio control should be a separate, authenticated feature/project with explicit authorization and confirmation for risky actions; do not smuggle it into the public radio skill.

## Next implementation task
1. Audit AirDeck public station/output routes and schemas.
2. Audit a current laut.fm station API response and identify the supported public listening URL field/path.
3. Define `AlexaStation` DTO and provider interfaces.
4. Implement unit-tested name normalization/resolution without network side effects.
5. Implement provider adapters and stream compatibility validation.
6. Only then add Alexa SDK/Lambda/web-service handler and interaction model.
