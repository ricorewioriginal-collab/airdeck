# AirDeck iOS – Mobile API Contract

Stand: 2026-09-29

This document is intentionally a contract checklist, not a list of invented endpoints. Before implementing a feature, inspect the current Core routes/services/tests and replace `TO VERIFY` with the exact supported method/path/event and semantics.

## Existing architectural contract

- REST namespace: `/api/v1`
- live events: SSE `/api/v1/events`
- authentication model: human sessions, paired-device tokens for apps/clients, scoped API tokens for integrations
- server-side RBAC/scope/station enforcement is authoritative

## Capability matrix

| Capability | Required for iOS | Current exact API | Status |
|---|---|---|---|
| Core health/version | yes | TO VERIFY | audit required |
| Login/session | yes | TO VERIFY | audit required |
| Device pairing/token issue | yes | TO VERIFY | audit required |
| Token revoke/logout | yes | TO VERIFY | audit required |
| Current user/scopes | yes | TO VERIFY | audit required |
| Accessible stations | yes | TO VERIFY | audit required |
| Station live state | yes | TO VERIFY | audit required |
| Now playing / next | yes | TO VERIFY | audit required |
| Automation state | yes | TO VERIFY | audit required |
| Queue read | yes | TO VERIFY | audit required |
| Automation mutations | later | TO VERIFY | high-impact; audit first |
| Schedule/planning read | yes | TO VERIFY | audit required |
| Media search | yes | TO VERIFY | permission filtering required |
| Artwork | yes | TO VERIFY | permission filtering required |
| Media preview/range | later | TO VERIFY | separate preview permission |
| MusicHub catalogue | later | TO VERIFY | wait for stable Phase 2 contract |
| MusicHub preview/download | later | TO VERIFY | distinct permissions |
| Encoder status | yes | TO VERIFY | audit required |
| Output status | yes | TO VERIFY | audit required |
| Output mutations | later | TO VERIFY | high-impact; audit first |
| SSE event types | yes | `/api/v1/events` | enumerate payloads before coding |

## Contract rules

1. Do not create an endpoint merely to make the app easy if an equivalent Core endpoint already exists.
2. If a mobile-friendly aggregate endpoint is genuinely needed, add it to Core with normal auth/RBAC/station tests and document it here.
3. Never trust station IDs, role names or capabilities supplied by the client without server-side resolution.
4. Never return provider/cloud/streaming secrets to iOS for status screens.
5. Private media visibility must be identical across list/search/count/artwork/preview/events.
6. Preview permission does not imply download permission; catalogue visibility does not imply broadcast permission.
7. Mutations must return/reconcile authoritative state and meaningful typed errors.
8. Event payloads need a versionable/stable shape before the app depends on them.
9. Treat network loss, token expiry/revocation and server upgrade/version mismatch as explicit states.

## Error model to standardise

The client needs machine-readable categories for at least:
- unauthenticated
- token expired/revoked
- forbidden
- station inaccessible
- validation error
- conflict/stale state
- resource missing
- provider unavailable
- Core degraded/unavailable
- rate limited
- unsupported capability/version

Use the existing Core error envelope if one exists; do not create an iOS-only server error format.

## Next audit task

A coding agent should now inspect current `src/server` routes/services/tests and fill this matrix with exact endpoints, request/response DTOs, required scopes/roles, station context and SSE event names. Any missing capability should be classified as:

- `EXISTS`
- `NEEDS MOBILE AGGREGATE`
- `NEEDS CORE FEATURE`
- `BLOCKED BY MUSIKHUB`
- `NOT PLANNED`

Only then create the Swift API client.