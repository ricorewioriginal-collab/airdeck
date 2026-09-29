# AirDeck iOS

Native iPhone/iPad client for the existing AirDeck Core.

## Status

Foundation/specification only. This branch intentionally does not introduce a second playout engine, second authentication system, or WebView wrapper.

## Architecture

- Swift + SwiftUI
- iPhone + iPad universal app
- Existing AirDeck `/api/v1` REST API
- Existing `/api/v1/events` SSE stream for live state
- Device-token/session model defined by AirDeck Core
- Keychain for client-side credentials/tokens
- Server remains authoritative for RBAC, station/tenant boundaries, automation, media permissions, encoder/output state and secrets

## Planned modules

- `App/` application bootstrap/navigation
- `Core/API/` typed API client and DTO mapping
- `Core/Auth/` login, device pairing and token lifecycle
- `Core/Events/` SSE reconnect/backoff/state propagation
- `Core/Storage/` Keychain and non-sensitive preferences
- `Features/Servers/` multiple AirDeck Core connections
- `Features/Dashboard/` ON AIR, current/next item, warnings
- `Features/Remote/` permission-aware live remote controls
- `Features/Automation/` queue/automation state
- `Features/Schedule/` clocks and programme planning
- `Features/Library/` media search and authorised preview
- `Features/MusicHub/` shared/private catalogue once API contract is stable
- `Features/Outputs/` encoder/output/AirDeckCast/Icecast/lautCast status
- `Features/Settings/` account, server and diagnostics
- `DesignSystem/` native AirDeck visual system
- `Tests/` unit/UI/contract tests

## Non-goals

The iOS app must not:

- run an independent radio automation/planning database;
- contain streaming, Nextcloud or provider secrets;
- bypass server RBAC or station scopes;
- expose private media through search, cover, preview, counts or events;
- embed a parallel Studio UI in a WebView;
- duplicate MusicHub business logic;
- assume unfinished server APIs exist.

## Delivery phases

1. API inventory and stable mobile contract.
2. Xcode project, navigation, server profiles, login/device pairing and Keychain.
3. Dashboard + SSE live state.
4. Remote/automation/schedule read paths, then permission-gated mutations.
5. Library preview and MusicHub integration after the server contract is stable.
6. Output diagnostics and operational alerts.
7. iPad studio layout, accessibility, background/reconnect behaviour and App Store hardening.
8. Optional Live Activities/push notifications only after server-side notification semantics are defined.

See `docs/mobile/IOS_APP_PLAN.md` and `docs/mobile/IOS_API_CONTRACT.md`.