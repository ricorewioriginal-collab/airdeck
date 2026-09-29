# AirDeck iOS – App Plan

Stand: 2026-09-29

## Objective

Build a native SwiftUI universal client for iPhone and iPad on top of the existing AirDeck Core. Git/Core is the source of truth; the mobile app is a client, not another automation engine.

## Product surfaces

### iPhone
- Server/account selection
- Station selection
- ON AIR dashboard
- current/next item and automation state
- large Remote controls for permitted actions
- schedule
- media/MusicHub search and authorised preview
- encoder/output health and warnings
- diagnostics

### iPad
Use the same API/client layer with an adaptive multi-column studio layout: navigation/stations, automation/queue/planning, and live/output/event state. Do not fork business logic into an iPad-only implementation.

## State ownership

AirDeck Core owns:
- users, sessions, device/API tokens and scopes;
- station membership/RBAC;
- automation, queue and planning;
- media/MusicHub grants;
- encoder and output state;
- provider/cloud/streaming secrets;
- audit trail and authoritative live state.

iOS owns only presentation state, safe local preferences, cached non-sensitive read data and Keychain-held client credentials/tokens.

## Connectivity

- HTTPS REST under `/api/v1`.
- SSE `/api/v1/events` for live updates while supported by the Core.
- Reconnect with bounded exponential backoff.
- Explicit connected/degraded/offline UI.
- Never infer successful mutations from optimistic UI alone; reconcile with server state/events.
- LAN/self-hosted servers are first-class, but insecure HTTP must not silently become a production default.

## Authentication

Implement against the Core's existing human-session/device-token design. Do not invent an iOS-only password database or long-lived bearer token format. Store eligible tokens in Keychain, support revocation/logout, and never log credentials.

## Permission model

Every mutation is authorised server-side. The UI may hide/disable unavailable actions for usability, but that is not a security boundary. Station context must be explicit for station-scoped operations.

Remote controls are deliberately high-impact and require capability/permission checks. Candidate controls: automation start/stop, skip, hold, live mode and emergency action. Exact endpoint semantics must be taken from the current Core, not guessed.

## Media/MusicHub

Private media isolation must match the server contract across search, metadata, counts, artwork, preview/download and events. Preview and download remain separate permissions. iOS must not cache protected audio outside the policy defined by the server/product.

## Audio

Initial iOS scope is monitoring/authorised preview, not replacing the Core playout engine. Do not put ffmpeg, Icecast source credentials, laut.fm credentials or AirDeckCast server secrets into the app merely to emulate server functions.

## Background behaviour

Design reconnect and state refresh for normal iOS lifecycle transitions. Do not promise permanent background control/stream processing that iOS does not permit. Critical background notifications should later use a server notification service with explicit semantics.

## Native UX

- SwiftUI and platform navigation patterns.
- Dynamic Type and VoiceOver from the first production UI.
- Dark AirDeck broadcast aesthetic without sacrificing contrast/accessibility.
- Clear semantic states: ON AIR, LIVE, AUTO, OFFLINE, ERROR, SYNC/TRANSFER.
- Destructive/high-impact controls need appropriate confirmation and server acknowledgement.

## Delivery gates

### Gate 0 – contract audit
Inventory current endpoints/events/auth and record supported/unsupported mobile capabilities in `IOS_API_CONTRACT.md`.

### Gate 1 – shell/auth
Create Xcode project, app navigation, server profiles, authentication/device pairing, Keychain and test doubles/contract fixtures.

### Gate 2 – read-only operations
Dashboard, station selector, now/next, schedule, output health, event reconnect.

### Gate 3 – remote mutations
Only after exact API/RBAC semantics are verified. Add mutation tests including forbidden/cross-station cases.

### Gate 4 – media
Search, artwork and preview with permission-leak regression tests.

### Gate 5 – MusicHub
Integrate only against stable MusicHub endpoints/grants. Do not make mobile development block or redefine MusicHub Phase 2/3.

### Gate 6 – iPad/operational polish
Adaptive studio layout, accessibility, network transitions, diagnostics and App Store preparation.

## Test requirements

- API decoding and error mapping
- Keychain/token lifecycle
- logout/revocation
- SSE reconnect/backoff
- offline/degraded recovery
- station switching
- RBAC negative paths
- cross-station denial
- private-media leak prevention
- mutation reconciliation
- iPhone/iPad layout UI tests
- accessibility smoke tests

## CI

iOS CI requires a macOS runner/Xcode. Add it only when the Xcode project exists. Keep iOS CI separate enough that unavailable Apple tooling cannot break unrelated Linux/Windows builds, while PR checks still report iOS failures when iOS files change.

## Repository rule

Development begins on `feature/ios-app-foundation` and should enter the main AirDeck development branch via review/PR. Do not commit provisioning profiles, certificates, private keys, signing passwords or App Store credentials.