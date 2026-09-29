# AirDeck API & Developer API Strategy

Status: binding API architecture target for implementation.

## 1. Goal

AirDeck needs one complete, versioned and machine-readable API contract that documents the endpoints/events used by AirDeck itself and exposes a deliberately supported Developer API for first-party clients, Extensions and authorized third-party integrations.

The API is part of the one-AirDeck architecture. Windows Standalone may host the same Core/API locally; Server/Web/Docker host the same contract; Android and iOS consume it rather than recreating AirDeck domain logic.

## 2. Current-state audit first

AirDeck already contains many `/api/v1` routes spread across server code and feature documentation (for example AI, bridges, streaming, health, MusicHub and Studio API calls). Before adding a parallel API, implementation must inventory the actual current router/source code and generate a complete route catalogue.

For every existing route record:

- HTTP method;
- path;
- handler/service owner;
- authentication requirement;
- RBAC permission/scope;
- station/global resource scope;
- request schema;
- response schema;
- error responses;
- side effects;
- idempotency expectations;
- rate-limit class;
- whether public/internal/developer-supported/deprecated;
- related SSE/event types;
- tests;
- documentation status.

Undocumented existing routes are documentation debt, not permission to invent replacements.

## 3. One API contract

Do not create separate incompatible APIs for Web, Windows, Android, iOS and Extensions.

Target layers:

```text
                    AirDeck Core
                         |
                API / Event contracts
                         |
       +-----------------+------------------+
       |                 |                  |
 First-party UI      Developer API      Extension SDK
 Win/Web/Mobile      integrations       capability facade
       |                 |                  |
       +-----------------+------------------+
                         |
                 shared RBAC/audit
```

Some endpoints may be internal-only, but they still belong to the documented contract inventory and must be explicitly classified.

## 4. OpenAPI

Adopt OpenAPI as the canonical HTTP API description.

Target artifacts:

- `openapi/airdeck-v1.yaml` (or generated equivalent);
- interactive API documentation served by AirDeck for authorized users/developers;
- static generated reference in project documentation;
- CI validation/linting;
- generated/validated client types where useful.

The OpenAPI source must not drift from runtime routes. Prefer schemas/route metadata that can be validated against implementation and tests rather than a hand-maintained decorative document.

## 5. API domains to cover

The complete inventory/documentation must cover all applicable AirDeck domains, including:

- system health/version/capabilities;
- setup/bootstrap where safely documentable;
- authentication/session/device tokens;
- current user/profile/avatar/preferences;
- users/roles/RBAC;
- stations and station settings;
- branding/public station data;
- automation/live state/mode;
- queue/now/next/history;
- planning/clocks/schedules/playlists;
- media library/files/uploads/preview;
- MusikHub catalog/grants/shares/download/broadcast-use;
- recorder/replays/voice tracking;
- encoder profiles;
- outputs/streaming/Icecast/AirDeckCast;
- lautCast when implemented;
- Nextcloud/cloud sources/sync jobs;
- bridges/relays;
- statistics/listeners/history;
- AI providers/settings/actions where implemented;
- notifications/community/profile/publisher functions when implemented;
- Extensions catalogue/install/lifecycle/capabilities when implemented;
- audit/logs/jobs;
- updates/capabilities;
- public listener endpoints;
- Developer API keys/apps/webhooks when implemented.

A feature is not considered API-documented if only its UI behavior is described.

## 6. Events / realtime

REST documentation alone is incomplete because AirDeck uses realtime state.

Define a versioned event catalogue for SSE and any future WebSocket channel.

For every event:

- event name/type;
- schema/version;
- resource/station scope;
- permission required;
- delivery semantics;
- ordering expectations where applicable;
- reconnect/resume behavior;
- example payload;
- deprecation policy.

Provide a machine-readable event schema (JSON Schema/AsyncAPI or another explicitly versioned contract). AsyncAPI should be evaluated for realtime documentation.

Never leak events for stations/resources the authenticated principal cannot access.

## 7. API Explorer inside AirDeck

Add an `API / Developer` area for authorized users.

It should provide:

- interactive endpoint documentation;
- search by domain/path;
- request/response schemas;
- permissions/scopes;
- examples;
- realtime event catalogue;
- API version/server capability information;
- changelog/deprecations;
- authentication guide;
- SDK/download links when available.

Interactive requests must clearly show which server/demo they target. Live API experimentation for development follows the binding AirDeck rule: live tests only on the designated Demo.

Do not expose secrets in example responses or documentation.

## 8. Developer API

The Developer API is the supported external subset of AirDeck's API contract.

It should support use cases such as:

- station dashboards/status integrations;
- now-playing/schedule integrations;
- authorized automation/control tools;
- media/metadata workflows according to granted permissions;
- AirDeck Extensions;
- custom hardware/controllers;
- reporting/statistics tools;
- webhooks/event consumers;
- external creator/radio workflows.

Developer access must be explicit and scoped. It must not mean `all internal endpoints with an admin password`.

## 9. Developer applications and credentials

Plan a Developer Application model:

- application id;
- owner/developer/publisher;
- name/description;
- allowed redirect URIs if OAuth is introduced;
- allowed scopes/capabilities;
- station/resource grants;
- credential/token records;
- creation/last-used/expiry/revocation timestamps;
- environment (development/demo/production where applicable);
- rate-limit policy;
- audit metadata.

API credentials must be shown only at creation where appropriate, stored hashed/encrypted according to credential type, individually revocable and never logged in plaintext.

Prefer short-lived tokens and standards-based authorization for user-delegated access. Do not create permanent universal master API keys as the default integration model.

## 10. Scopes

Developer scopes should be fine-grained and mapped to Core authorization.

Conceptual examples:

- `profile:read`;
- `stations:read`;
- `stations:write`;
- `automation:read`;
- `automation:control`;
- `schedule:read`;
- `schedule:write`;
- `media:read`;
- `media:upload`;
- `musikhub:read`;
- `musikhub:share`;
- `outputs:read`;
- `outputs:control`;
- `stats:read`;
- `notifications:write`;
- `extensions:manage` (high impact/admin only).

Exact names must be reconciled with existing AirDeck permissions instead of creating a second authorization vocabulary unnecessarily.

## 11. Public API vs authenticated API

Explicitly classify routes:

### Public
Only deliberately public/non-sensitive information, e.g. health summary and explicitly public station/listener metadata.

### Authenticated first-party
AirDeck UI/client operations using normal user/session/device authorization.

### Developer-supported
Stable external contract with documented scopes/versioning/rate limits.

### Internal/admin
Documented for maintainers but not promised as third-party stable and not exposed without appropriate authorization.

### Deprecated
Still available for a defined migration window with replacement/removal version documented.

`public` must never be inferred from the absence of a UI login check.

## 12. Webhooks

Add a Developer API webhook design for selected events.

Examples:

- now playing changed;
- automation state changed;
- schedule changed;
- output disconnected/reconnected;
- upload/job completed/failed;
- extension/security event where appropriate.

Requirements:

- explicit event subscriptions;
- HTTPS targets;
- signed requests (HMAC or equivalent);
- replay protection/timestamp/event id;
- retry with backoff;
- delivery logs;
- disable/quarantine failing endpoints;
- station/resource permission checks;
- secret rotation;
- test webhook function targeting only safe developer/demo endpoints.

## 13. Rate limits, pagination and idempotency

Standardize API behavior:

- consistent pagination/filter/sort conventions;
- request IDs/correlation IDs;
- documented rate-limit headers/errors;
- idempotency keys for appropriate create/control/payment-like/high-impact operations;
- consistent timestamp/timezone representation;
- consistent error envelope;
- stable resource IDs;
- safe concurrency/version conflict handling where needed.

## 14. Error contract

Define a common error shape, conceptually:

```json
{
  "error": {
    "code": "station_forbidden",
    "message": "Access to this station is not permitted.",
    "requestId": "...",
    "details": {}
  }
}
```

Do not expose stack traces, filesystem paths, SQL details, tokens or provider secrets to API consumers.

## 15. Versioning and compatibility

Keep `/api/v1` stable while documenting actual behavior.

Breaking changes require a deliberate migration/version policy. Prefer additive evolution inside a major API version.

Document:

- introduced version;
- deprecated version;
- replacement;
- planned removal version/date when known.

First-party Windows/Web/Docker/Android/iOS compatibility should be checked against the same contract in CI.

## 16. SDKs

After the API contract stabilizes, provide official SDKs where they materially help.

Priority:

1. TypeScript/JavaScript (Web/Extensions/Node integrations);
2. Swift (iOS/iPadOS);
3. Kotlin (Android);
4. optional Python for automation/integration developers.

SDKs should be generated or contract-tested where practical and must not contain business logic that belongs in AirDeck Core.

## 17. Extension API relationship

The Extension SDK should use a capability-restricted facade over the same Core/API concepts.

Extensions must not receive unrestricted raw internal API access simply because they run locally.

The Developer API and Extension API can share schemas/models/scopes, but Extension Host permissions/sandboxing remain an additional boundary.

## 18. Security

Required:

- server-side auth/RBAC/station scoping on every protected operation;
- credential rotation/revocation;
- no secrets in OpenAPI examples/logs;
- upload validation;
- SSRF protection for callback/webhook/import URLs;
- CSRF protections for browser/session flows where applicable;
- CORS allowlist policy;
- audit high-impact API operations;
- rate limits/brute-force protection;
- explicit public-route review;
- event stream authorization and filtering.

## 19. Documentation generation and CI

CI should eventually fail when important API drift occurs.

Target checks:

- OpenAPI schema valid;
- runtime route inventory vs documented route inventory;
- request/response schema tests;
- permission metadata present for protected routes;
- no duplicate operation IDs;
- generated SDK/type compatibility;
- broken documentation links/examples;
- deprecation metadata;
- event schema validation.

Generate a human-readable endpoint index grouped by domain and permission.

## 20. Live testing

All runtime/live API verification must be performed exclusively on the designated AirDeck Demo.

Local unit/integration/contract tests and isolated local development are allowed. If the Demo is unavailable, mark live verification blocked; never fall back to a production/customer/real station.

Developer documentation and API Explorer must reinforce this rule for AirDeck development/testing.

## 21. Implementation phases

### Phase A — inventory
- inspect all current router registrations and Studio API calls;
- enumerate every `/api/v1` route;
- enumerate SSE/realtime events;
- classify public/auth/internal/developer/deprecated;
- map RBAC/station scope/tests.

### Phase B — contract foundation
- OpenAPI toolchain;
- shared schema/error/pagination conventions;
- endpoint metadata;
- realtime schema strategy;
- CI validation.

### Phase C — complete current API documentation
- document every existing endpoint;
- document every existing event;
- fill missing schemas/tests/permission metadata;
- add searchable generated endpoint reference.

### Phase D — in-product Developer area
- API Explorer/docs;
- authentication/scopes guide;
- version/capability page;
- event catalogue;
- deprecation/changelog page.

### Phase E — Developer API credentials/apps
- developer application model;
- scoped credentials/tokens;
- station/resource grants;
- revocation/audit/rate limiting.

### Phase F — webhooks and SDKs
- signed webhook subscriptions/delivery;
- TypeScript SDK;
- Swift/Kotlin SDKs aligned with first-party apps;
- Extension SDK facade;
- examples/test harness.

## 22. Completion criteria

Do not call `AirDeck API complete` until:

- every runtime HTTP route is inventoried;
- every supported route is documented with schemas/auth/scope/errors;
- realtime events are inventoried/documented;
- OpenAPI is validated against implementation;
- Developer API stability classification exists;
- developer credentials/scopes are safely implemented if external access is enabled;
- API Explorer/reference is available;
- CI catches contract drift;
- first-party clients consume compatible contracts;
- automated security/permission tests exist;
- live verification occurred only on the AirDeck Demo.
