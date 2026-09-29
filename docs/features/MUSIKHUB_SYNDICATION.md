# MusikHub Syndication

Status: product/architecture specification for implementation.

## 1. Definition

A **Syndication** in AirDeck is a radio programme made available by its producer/publisher so that other authorized AirDeck stations may adopt and schedule it under the publisher's declared usage terms.

Typical forms:

1. **Prerecorded programme** — one or more uploaded audio files/episodes with metadata and timing information.
2. **Live/linear programme feed** — a stream URL plus programme metadata and an availability/broadcast schedule.

A syndication may be produced neutrally for broad carriage, or according to a defined format/template. It is not automatically public merely because it exists in MusikHub; the owner explicitly controls sharing and carriage permissions.

## 2. Product goal

MusikHub should become more than a shared music pool. It should also support programme exchange between stations.

Example flow:

```text
Producer / Station A
   |
   +-- creates "Weekend Mix"
   +-- uploads episode audio OR provides approved stream URL
   +-- metadata / duration / availability / usage terms
   +-- shares to selected stations/users OR publishes to allowed catalogue
                         |
                         v
                 MusikHub Syndication
                         |
              discovery + permissions
                         |
                         v
Station B                           Station C
   |                                  |
   +-- follows/adopts                 +-- follows/adopts
   +-- maps to local schedule         +-- maps to local schedule
   +-- local fallback                 +-- different local airtime
   +-- broadcast history              +-- broadcast history
```

The receiving station does not receive ownership of the syndication. It receives a permission/grant to use it according to the publisher's terms.

## 3. Syndication entity

Introduce a first-class MusikHub `Syndication` domain entity rather than pretending a complete programme is an ordinary music track.

Conceptual fields:

- stable syndication id;
- owner/publisher user or organization/station;
- title;
- subtitle/series name;
- description;
- cover/artwork;
- categories/genres/tags;
- language;
- content/advisory flags where relevant;
- explicit/clean indicator where relevant;
- producer/host/presenter credits;
- contact/support URL;
- source type: `prerecorded`, `live_stream`, optionally `hybrid` later;
- default programme duration;
- timezone for live schedules;
- publication state;
- visibility/sharing policy;
- usage/license declaration;
- attribution requirements;
- allowed stations/users/groups;
- availability window;
- created/updated timestamps;
- version/revision information.

Do not expose owner-private station data through the public/shared syndication record.

## 4. Prerecorded episodes

A prerecorded syndication should support a series with individual episodes/releases.

`SyndicationEpisode` conceptual fields:

- episode id;
- syndication id;
- title;
- episode number/date/season where applicable;
- description;
- audio asset reference;
- duration;
- publish/available-from timestamp;
- available-until/expiry timestamp where applicable;
- intended air date/time where supplied;
- replay/embargo rules;
- metadata/cue points;
- optional chapter/segment metadata;
- optional local-break markers;
- checksum/media technical metadata;
- revision/version;
- withdrawn state/reason.

The audio file uses MusikHub's controlled media/storage/download mechanisms. It must not become an untracked public file URL by default.

## 5. Stream syndications

A stream-based syndication describes a programme source and when it is valid/on air.

Conceptual fields:

- stream source id;
- protected source URL/reference;
- format/codec information when known;
- programme timezone;
- recurring or explicit transmission windows;
- expected duration;
- connection lead time;
- reconnect policy;
- metadata policy;
- fallback behavior;
- health/preflight status;
- optional backup stream URL/reference;
- source authentication stored only in AirDeck secret storage.

Receiving users must not be given raw credentials simply because they can schedule the feed. AirDeck should resolve protected stream credentials Core-side.

## 6. Metadata

Syndication metadata is distinct from ordinary song metadata.

At minimum support:

- programme/series title;
- episode title;
- presenter/host;
- producer/publisher;
- description;
- category/genre;
- language;
- duration;
- artwork;
- original/expected air time;
- usage/attribution text;
- website/contact;
- content flags.

For stream syndications, the publisher may also provide dynamic now-playing/programme metadata. The receiving station chooses how allowed upstream metadata maps to its own public output according to AirDeck policy.

## 7. Sharing / grants

Reuse and extend MusikHub's grant/visibility concepts instead of creating an unrelated sharing system.

Target sharing modes:

- private draft;
- selected users;
- selected stations;
- selected organization/team/group where supported;
- all eligible users within the private AirDeck deployment/community;
- public catalogue only when explicitly enabled and legally appropriate.

A grant can specify capabilities such as:

- discover/view metadata;
- preview/listen;
- schedule/broadcast;
- download/cache episode media;
- rebroadcast/replay;
- access live stream during authorized window.

A receiving user must have both the syndication grant and sufficient rights on the destination station.

## 8. Usage terms / rights

AirDeck must not assume that uploaded audio or a stream may legally be redistributed.

The publisher must explicitly declare the usage basis/terms before making a syndication available to others.

Possible policy fields:

- permission to carry on authorized stations;
- territory restrictions where applicable;
- valid-from / valid-until;
- number/frequency of permitted broadcasts if required;
- replay/catch-up permission;
- editing permission;
- required attribution/credits;
- required programme title/metadata;
- advertising/local-break policy;
- download/cache permission;
- custom terms/reference.

AirDeck should record acceptance/version of applicable terms for the receiving station where needed.

This is operational rights metadata, not a substitute for legal advice or actual rights ownership.

## 9. Discovery UI in MusikHub

Add a first-class MusikHub section such as:

`MusikHub > Syndications`

Suggested views:

- Discover;
- Available to my stations;
- Following/Subscribed;
- Scheduled;
- My Syndications;
- Drafts;
- Expiring/Withdrawn;
- Categories.

Cards/detail pages should make clear:

- prerecorded vs live stream;
- series/episode;
- duration;
- next availability/live window;
- publisher;
- rights/usage summary;
- compatible destination stations;
- already scheduled status;
- update/new episode status.

## 10. Adoption/subscription

Receiving stations should be able to **adopt/follow** a syndication without copying its ownership record.

A local `SyndicationSubscription` may contain:

- destination station id;
- syndication id;
- enabled state;
- schedule mapping;
- episode selection rule;
- timezone/local-time conversion;
- metadata mapping;
- download/cache preference;
- fallback item/playlist/source;
- preflight lead time;
- notification preferences;
- local notes;
- last/next planned broadcast;
- terms acceptance revision.

## 11. Scheduling prerecorded programmes

A receiving user can add a prerecorded syndication to the normal AirDeck planning/scheduling system.

Examples:

- schedule a specific episode once;
- schedule newest available episode every Saturday at 18:00;
- schedule an explicitly dated episode at a local time;
- repeat an episode only when publisher terms permit;
- automatically fetch/cache before airtime when allowed.

Before airtime AirDeck should verify:

- grant still valid;
- episode not withdrawn/expired;
- media available and valid;
- duration known;
- local station permission;
- terms still compatible;
- fallback available.

The programme must then enter the same authoritative AirDeck automation/playout path as other scheduled content. Do not create a separate syndication playout engine.

## 12. Scheduling live streams

For a stream syndication, a receiving station can map the upstream programme window into its schedule.

At preflight:

1. verify grant and transmission window;
2. resolve stream credentials Core-side;
3. test source reachability/format safely;
4. prepare the live/remote source;
5. switch according to the normal AirDeck automation rules at scheduled time;
6. monitor stream health;
7. use configured fallback on failure;
8. return to normal local automation after the programme window.

A stream must never be trusted merely because the publisher supplied a URL. Apply SSRF/network policy, protocol allowlists, timeout/size controls and secret handling.

## 13. Local breaks / affiliate windows

Design for optional future affiliate/local-break markers without requiring them for v1.

A syndicated show may define windows such as:

- local news;
- local ads/sponsorship;
- station ID/jingle;
- weather/traffic;
- optional local insert.

The receiving station can map approved break markers to local content while preserving the programme timeline. This must be deterministic and tested before broad rollout.

## 14. Updates and withdrawal

Publishers need lifecycle controls:

- publish new episode;
- replace/revise before deadline;
- deprecate episode;
- withdraw episode/source;
- update metadata/terms;
- end syndication.

Receiving stations must be notified when a scheduled item is materially changed or withdrawn.

Do not silently replace already scheduled media close to airtime without policy. Define a configurable lock/freeze window and require operator attention for high-impact changes.

## 15. Caching / storage

For prerecorded syndications, allow controlled local caching when the grant permits it.

Benefits:

- reliable playout even if the source server is unavailable at airtime;
- reduced repeated transfer;
- checksum verification.

Cache ownership remains tied to the syndication grant. On withdrawal/expiry, AirDeck applies the configured rights/cache policy and must not treat the file as a permanently owned local library track.

Nextcloud/MusikHub storage adapters may be used as underlying storage, but the syndication domain model remains independent of one storage provider.

## 16. Broadcast history and reporting

Record carriage/broadcast events:

- syndication/episode;
- destination station;
- scheduled start;
- actual start/end;
- completed/interrupted/fallback status;
- source type;
- relevant revision/terms version;
- failure reason;
- optional reporting acknowledgement to publisher where allowed.

This supports both station operations and publisher/affiliate reporting without exposing unrelated private analytics.

## 17. Notifications

Useful events include:

- new episode available;
- episode updated;
- episode/source withdrawn;
- terms changed;
- live programme starts soon;
- preflight failed;
- media cache failed;
- syndication scheduled;
- syndication successfully aired;
- upstream stream lost/fallback used;
- grant expiring/revoked.

Integrate with AirDeck's planned notification/community surface rather than creating a separate notification center.

## 18. API

The complete AirDeck API must include Syndication endpoints/events when implemented.

Conceptual resource families:

- `/api/v1/musikhub/syndications`
- `/api/v1/musikhub/syndications/:id`
- `/api/v1/musikhub/syndications/:id/episodes`
- `/api/v1/musikhub/syndications/:id/grants`
- `/api/v1/stations/:sid/syndications/subscriptions`
- `/api/v1/stations/:sid/syndications/schedule`
- preflight/health operations where appropriate.

These are conceptual paths only; implementation must first reconcile them with the current MusikHub/API router conventions and avoid duplicate resources.

Developer API access uses explicit scopes/capabilities and must not reveal protected source URLs/credentials.

## 19. Events

Candidate realtime events:

- `syndication.created`
- `syndication.updated`
- `syndication.withdrawn`
- `syndication.episode.available`
- `syndication.episode.updated`
- `syndication.grant.changed`
- `syndication.subscription.changed`
- `syndication.preflight.failed`
- `syndication.broadcast.started`
- `syndication.broadcast.completed`
- `syndication.broadcast.failed`

Names/schemas must be aligned with AirDeck's actual event conventions and added to the common realtime contract.

## 20. Security

Required:

- Core-side RBAC and station scoping;
- grants checked at discovery, scheduling, download and playout;
- protected stream credentials in secret storage;
- SSRF protection for stream URLs;
- no private source URL leakage through client/API logs;
- upload/media validation;
- checksum/integrity validation;
- audit sensitive share/grant/withdraw actions;
- rate limits where needed;
- publisher cannot control receiving station outside the explicit syndication contract;
- receiver cannot mutate publisher master metadata unless explicitly collaborative functionality is introduced later.

## 21. Platform parity

Syndication is one MusikHub/Core capability.

Windows Standalone, Server/Web/Docker, Demo, Android and iOS/iPadOS use the same domain/API contract. UX may be adapted to the platform.

Main user flows should be available where technically meaningful:

- discover;
- preview/details;
- adopt/follow;
- choose destination station;
- schedule;
- view upcoming/status;
- receive change/failure notifications.

Do not implement a separate mobile syndication database or scheduler.

## 22. Demo-only live tests

All runtime/live tests of Syndication must be performed exclusively on the designated AirDeck Demo.

Use demo/test media and demo stream sources. Never use a production/customer/real station as a development test target.

Test at least:

- prerecorded upload -> share -> adopt -> schedule -> real demo playout;
- live test stream -> share -> schedule -> source switch -> return;
- revoked grant before airtime;
- withdrawn episode;
- source unavailable -> fallback;
- changed terms;
- timezone/DST handling;
- two receiving demo stations scheduling the same syndication independently;
- unauthorized user/station denied;
- protected stream credential not exposed.

## 23. Implementation phases

### Phase A — reconcile with current MusikHub
- inspect current MusikHub entities/grants/storage/jobs;
- reuse existing IDs/grants/audit patterns;
- define Syndication/Episode/Subscription models;
- threat model and rights model.

### Phase B — prerecorded MVP
- create/edit syndication;
- episode upload/reference;
- sharing/grants;
- discovery/details;
- adopt/subscription;
- schedule specific episode;
- cache/preflight/fallback;
- broadcast history.

### Phase C — recurring episode rules
- newest episode scheduling;
- availability/expiry;
- update/withdraw workflow;
- notifications;
- lock/freeze behavior.

### Phase D — stream syndication
- protected stream source;
- recurring live windows/timezones;
- preflight/health;
- automation source switching;
- fallback/reconnect;
- dynamic metadata policy.

### Phase E — affiliate features
- local break markers;
- publisher reporting;
- richer templates/requirements;
- community/catalog discovery where approved.

### Phase F — API/SDK/platform parity
- OpenAPI/event schemas;
- Developer API scopes;
- Windows/Web/Docker/Demo UI parity;
- Android/iOS native surfaces;
- SDK models/examples.

## 24. Completion rule

Do not call Syndication complete when it merely accepts an upload or URL.

Completion requires a real end-to-end path:

**publisher creates -> rights/share -> receiver discovers -> adopts -> schedules -> preflight -> AirDeck playout -> fallback/error handling -> broadcast history**, with RBAC, API/events, tests and platform parity accounted for.
