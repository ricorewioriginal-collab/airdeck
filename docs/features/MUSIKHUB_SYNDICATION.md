# MusikHub Syndication

Status: product/architecture specification for implementation.

## 1. Definition

A **Syndication** in AirDeck is a radio programme made available by its producer/publisher so that other authorized AirDeck stations may adopt and schedule it under the publisher's declared usage terms.

Typical forms:

1. **Prerecorded programme** — one or more audio episodes hosted in publisher-controlled storage and exchanged directly/provider-to-provider.
2. **Live/linear programme feed** — a stream URL plus programme metadata and an availability/broadcast schedule.

A syndication may be produced neutrally for broad carriage, or according to a defined format/template. It is not automatically public merely because it exists in MusikHub; the owner explicitly controls sharing and carriage permissions.

## 2. Binding storage principle: AirDeck is not the media host

**Cross-station Syndication audio files must not be stored on central AirDeck-operated servers.**

AirDeck infrastructure may coordinate identity, discovery, grants, metadata, manifests, checksums, availability, notifications and transfer authorization, but the large programme media remains on infrastructure chosen/controlled by the publisher or participating station.

Supported source/storage adapters should include, in phases:

- publisher's local AirDeck storage;
- publisher's Nextcloud/WebDAV storage;
- S3-compatible object storage configured by the publisher;
- other explicitly supported cloud/storage adapters;
- publisher-controlled HTTPS media endpoint;
- live Icecast/compatible stream URL for linear syndication.

The architecture must not require RicoReWi/AirDeck central storage for a station to publish or receive a Syndication.

If AirDeck later offers an optional hosted storage product, it must be an explicit optional provider, not the mandatory transport or canonical media store.

## 3. Control plane vs media plane

Separate coordination from file transfer.

```text
                    AIRDECK CONTROL PLANE
       metadata · discovery · grants · manifests · events
                  NO central programme media
                             |
                authorization / source descriptor
                             |
 Publisher storage -------------------------- Receiver AirDeck
 Nextcloud / S3 / HTTPS / local node          local station storage/cache
          |                                            ^
          +---------- direct media transfer -----------+

Live Syndication:
Publisher stream --------------------------------> Receiver AirDeck
       direct stream path; AirDeck central service is not a relay
```

Central AirDeck services must not proxy/relay full programme audio merely to make cross-station exchange work. Metadata/API responses must use stable asset IDs/descriptors rather than pretending a central AirDeck media URL owns the file.

## 4. Product goal

MusikHub should become more than a shared music pool. It should support programme exchange between stations while avoiding a central bandwidth/storage dependency.

The receiving station does not receive ownership of the syndication. It receives a permission/grant to use it according to the publisher's terms.

## 5. Syndication entity

Introduce a first-class MusikHub `Syndication` domain entity rather than pretending a complete programme is an ordinary music track.

Conceptual fields include stable syndication id, publisher, title/series, description/artwork, categories/tags, language, credits, source type, duration, timezone, publication state, sharing policy, usage terms, attribution, allowed stations/users/groups, availability and revision information.

Do not expose owner-private station data through the shared record.

## 6. Media asset descriptor

Prerecorded episodes reference a provider-neutral `SyndicationAssetDescriptor`, not a central AirDeck file.

Conceptual fields:

- asset id;
- owner/publisher id;
- storage adapter/provider type;
- opaque provider-side object reference;
- media filename/display name;
- byte size;
- MIME/container/codec information;
- duration;
- checksum/hash;
- revision/version;
- availability/expiry;
- whether receiver-side caching is permitted;
- whether range/resumable transfer is supported;
- encryption/transport requirements;
- authorization mode reference;
- health/last-verified metadata.

Provider credentials, raw filesystem paths and private permanent URLs must not be distributed as catalogue metadata.

## 7. Prerecorded transfer flow

Target flow:

1. publisher creates/updates an episode;
2. media stays in publisher-selected storage;
3. AirDeck creates a provider-neutral asset descriptor and checksum;
4. publisher grants another station permission;
5. receiving AirDeck requests transfer authorization;
6. Core verifies user, destination station, grant, terms and asset revision;
7. receiver obtains a short-lived/direct transfer mechanism appropriate to the adapter;
8. receiver downloads directly from publisher storage to receiver-controlled local/cache storage;
9. receiver verifies size/checksum/format;
10. AirDeck records the cached revision and readiness for playout.

The AirDeck control service is not in the audio byte path.

## 8. Transfer authorization patterns

Adapters may implement different secure transfer mechanisms, for example:

- short-lived signed download URL;
- scoped WebDAV/Nextcloud share/token;
- S3-compatible presigned GET;
- mutually authenticated AirDeck-node transfer;
- one-time transfer token resolved by the publisher node;
- authenticated HTTPS endpoint with expiring capability token.

Requirements:

- least privilege;
- short expiry;
- asset/revision binding;
- destination/grant binding where feasible;
- revocation support;
- TLS;
- no permanent provider credentials handed to receivers;
- no credential in normal logs/history;
- retry/resume without broadening permission.

## 9. Publisher node transfer

For users who do not use Nextcloud/S3, AirDeck should support a publisher-node model: the publisher's own AirDeck server/Windows standalone installation can expose an explicitly enabled, authenticated transfer endpoint.

This endpoint must be opt-in and should support:

- only assets explicitly shared for Syndication;
- expiring capability tokens;
- bandwidth/concurrency limits;
- optional allowed transfer windows;
- resumable/range requests where practical;
- audit logs;
- revocation;
- no directory browsing;
- no arbitrary filesystem paths;
- TLS/reverse-proxy guidance;
- safe behavior behind NAT/firewalls.

A publisher that cannot/will not expose its AirDeck node can choose Nextcloud/S3/another supported provider instead.

## 10. NAT/offline constraints

Pure direct node-to-node transfer is not always possible because a publisher may be offline or behind NAT/CGNAT.

AirDeck must therefore support multiple provider adapters rather than silently falling back to central AirDeck storage.

If a source is unreachable:

- receiver preflight reports the asset unavailable;
- previously authorized local cache may be used if still valid;
- configured fallback content is selected for airtime;
- AirDeck does not upload the file to a central server as an implicit workaround.

Optional future peer-assisted transport may be evaluated, but central relay is not the default architecture.

## 11. Receiver-side caching

A receiving station may cache a Syndication episode locally when the grant permits it. This is strongly recommended before airtime for prerecorded shows.

The cache belongs to the receiving station's own AirDeck storage, not central AirDeck infrastructure.

Cache records include asset/revision/checksum, source provider, grant/terms revision, downloaded timestamp, validity and last verification.

On withdrawal/expiry/revocation, AirDeck applies the configured rights policy. A cached Syndication must not silently become a permanently owned library track.

## 12. Stream syndications

A live/linear Syndication is also decentralized.

The publisher supplies a protected stream descriptor; at airtime the receiving AirDeck connects directly to the publisher/provider stream. Central AirDeck services must not relay the audio.

Source credentials remain protected Core-side. Receiving UI/API consumers do not receive raw passwords merely because they can schedule the programme.

Support expected transmission windows, timezone, codec/format, connection lead time, reconnect policy, metadata policy, fallback and optional backup source.

## 13. Metadata and discovery

Syndication metadata is distinct from ordinary song metadata and may be coordinated through AirDeck's control plane because it is comparatively small.

Support programme/series title, episode title, presenter/host, publisher, description, category, language, duration, artwork reference, original/expected air time, attribution/usage text, website/contact and content flags.

Artwork may be stored/provider-hosted using the same adapter principle; central metadata services should not become an accidental unbounded media CDN.

## 14. Sharing / grants

Reuse and extend MusikHub's grant/visibility concepts.

Target sharing modes include private draft, selected users, selected stations, organization/team/group, eligible users in a deployment/community and explicitly enabled catalogue publication.

Capabilities may include discover metadata, preview, schedule/broadcast, download/cache, replay and live-window access.

A receiving user needs both the Syndication grant and sufficient rights on the destination station.

## 15. Usage terms / rights

AirDeck must not assume that uploaded audio or a stream may legally be redistributed.

The publisher explicitly declares usage terms such as permitted stations, territory/time window, replay, editing, attribution, metadata, local-break policy and cache/download permission. AirDeck records the applicable revision where required.

This is operational rights metadata, not a substitute for actual rights ownership or legal advice.

## 16. Discovery UI

Add `MusikHub > Syndications` with views such as Discover, Available to my stations, Following/Subscribed, Scheduled, My Syndications, Drafts, Expiring/Withdrawn and Categories.

Details must show source type, series/episode, duration, next availability/live window, publisher, rights summary, compatible destination stations, schedule state and update state. The UI should also show source readiness/provider status without exposing provider secrets.

## 17. Adoption/subscription

Receiving stations adopt/follow a Syndication without copying ownership.

A local subscription stores destination station, schedule mapping, episode selection rule, timezone conversion, metadata mapping, cache preference, fallback, preflight lead time, notifications, local notes, last/next broadcast and terms revision.

## 18. Scheduling prerecorded programmes

Examples include a specific episode once, newest episode every Saturday, or explicitly dated episodes.

Before airtime AirDeck verifies grant, terms, withdrawal/expiry, local permission, cached/source asset revision/checksum, duration and fallback.

The programme then enters the normal authoritative AirDeck automation/playout path. There is no separate Syndication playout engine.

## 19. Scheduling live streams

At preflight AirDeck verifies grant/window, resolves credentials Core-side, tests source safely, prepares the remote source, switches through normal automation, monitors health, uses fallback if needed and returns to local automation afterward.

Apply SSRF/network policy, protocol allowlists, timeout controls and secret handling to publisher-supplied URLs.

## 20. Local breaks / affiliate windows

Plan optional future local-break markers for local news, ads/sponsorship, station IDs, weather/traffic and other affiliate inserts. Receiving stations map approved markers to local content while preserving programme timing.

## 21. Updates and withdrawal

Publishers can publish/revise/withdraw episodes or sources, update metadata/terms and end a Syndication. Receivers are notified of material changes.

Define a freeze/lock window so already prepared broadcasts are not silently replaced immediately before airtime.

## 22. Broadcast history and reporting

Record Syndication/episode, destination station, scheduled/actual times, completion/fallback status, source type, asset revision, terms revision and failure reason. Optional publisher reporting must not expose unrelated private station analytics.

## 23. Notifications

Integrate new episode, update, withdrawal, terms change, live-start, preflight failure, cache failure, scheduled/aired, stream loss/fallback and grant expiry/revocation into AirDeck's common notification/community surface.

## 24. API and developer API

The complete AirDeck API includes Syndication resources/events. Conceptual families include `/api/v1/musikhub/syndications`, episodes, grants, station subscriptions/schedule and transfer-authorization/preflight operations.

Implementation must reconcile exact paths with current MusikHub/API conventions.

Developer API responses must expose stable asset descriptors/status, not raw storage credentials/private URLs. Transfer authorization endpoints require narrow scopes and Core-side grant/station validation.

## 25. Security

Required:

- Core-side RBAC/station scoping;
- grant checks at discovery/schedule/transfer/playout;
- provider credentials in secret storage;
- short-lived transfer authorization;
- SSRF protection;
- no private source URL/path/credential leakage;
- upload/media validation at publisher and receiving boundaries;
- checksum/integrity verification;
- audit share/grant/transfer/withdraw actions;
- rate/bandwidth/concurrency limits;
- publisher cannot control receiver outside the explicit contract;
- receiver cannot mutate publisher master metadata;
- central AirDeck services must not become an implicit file relay.

## 26. Platform parity

Syndication is one MusikHub/Core capability. Windows Standalone, Server/Web/Docker, Demo, Android and iOS/iPadOS use the same domain/API contract. UX is platform-adapted; no separate mobile database/scheduler/transfer model.

## 27. Demo-only live tests

All runtime/live Syndication tests occur exclusively on the designated AirDeck Demo using test media, test provider storage and test streams.

Test at least provider-to-receiver direct transfer, checksum/cache, publisher-node transfer where supported, Nextcloud/S3 adapter where available, revoked transfer token, source offline/fallback, live direct stream, withdrawal, timezone/DST, two receivers and credential non-disclosure.

Never use a production/customer/real station as a development test target.

## 28. Implementation phases

### Phase A — storage/transport architecture
- inspect current MusikHub storage/grants/jobs;
- define provider-neutral asset descriptor;
- storage adapter interface;
- transfer authorization contract;
- cache model;
- threat model;
- prove no central media dependency.

### Phase B — prerecorded MVP
- publisher-selected storage;
- episode asset descriptor;
- sharing/grants;
- direct authorized transfer;
- receiver cache/checksum;
- discovery/adoption/scheduling;
- fallback and history.

### Phase C — storage adapters
- Nextcloud/WebDAV;
- S3-compatible storage;
- publisher AirDeck-node transfer;
- HTTPS provider adapter;
- resume/retry/health.

### Phase D — recurring episode workflow
- newest-episode scheduling;
- availability/expiry;
- update/withdraw;
- notifications;
- freeze window.

### Phase E — live stream Syndication
- protected direct stream descriptor;
- recurring windows/timezones;
- preflight/health;
- automation switching;
- fallback/reconnect;
- dynamic metadata.

### Phase F — affiliate/API/platform work
- local break markers;
- reporting;
- OpenAPI/events/Developer API;
- platform parity and SDK models.

## 29. Completion rule

Do not call Syndication complete when it merely accepts an upload or URL.

Completion requires:

**publisher storage -> metadata/rights/share -> receiver discovers -> direct authorized transfer or direct stream -> local cache/preflight -> schedule -> AirDeck playout -> fallback/error handling -> broadcast history**, without central AirDeck programme-media storage or mandatory relay.
