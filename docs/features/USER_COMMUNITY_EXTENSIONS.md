# AirDeck User Bar, Community & Extensions

Status: product/architecture specification for implementation.

This specification is subordinate to the binding platform-parity architecture. AirDeck remains one product with shared Core/domain behavior; Windows/Web/Docker/Demo/Android/iOS surfaces adapt the UX to their platform.

## 1. Persistent signed-in user area

Every authenticated AirDeck surface must make the currently signed-in identity visible without requiring the user to open Settings first.

Prefer an existing top/header/navigation bar rather than adding another permanent bar when the current layout has a suitable location.

The compact user control should show, where space permits:

- profile image/avatar;
- display name or username;
- optional role/station context when useful;
- status/notification indicator;
- accessible menu trigger.

On narrow/mobile surfaces this may collapse to avatar + menu while preserving the same functions.

The user menu should provide at minimum:

- My profile;
- account/profile settings;
- AirDeck/application settings according to permission;
- current station/workspace context and switcher where applicable;
- Community entry point;
- Extensions entry point;
- session/device information where supported;
- Sign out.

Do not expose secrets, provider credentials or administrative actions merely because they are reachable from the user menu. Existing RBAC/station scope remains authoritative.

## 2. Profile model

Extend the existing user/account model rather than creating a second community identity database.

Candidate profile fields:

- immutable/internal user id;
- username/login identity;
- display name;
- avatar/profile image reference;
- short bio (optional);
- public/community handle if different from login name;
- profile visibility;
- community participation settings;
- notification preferences;
- developer/publisher profile reference when applicable.

Security-sensitive login identity and public community presentation must remain separable where necessary.

Avatar uploads must use normal upload validation, size/type limits and authorization. No remote arbitrary HTML/SVG/script execution through avatars.

## 3. Community

Community is an AirDeck capability, not a separate authentication system.

Initial community scope should focus on useful radio/creator collaboration rather than building a generic social network.

Planned capabilities:

- user/developer profiles;
- extension publisher profiles;
- extension ratings/reviews after an installation/use eligibility rule;
- announcements/release notes;
- optional station/community discovery for explicitly public stations;
- follows/favorites for developers/extensions/public stations;
- support/discussion links for extensions;
- abuse/reporting/moderation workflow;
- notification inbox for relevant AirDeck/community events.

Private stations, internal media, schedules, team membership and operational data must never become community-visible by default.

Public discovery is opt-in and server-side permission checked.

## 4. Extensions menu

Add a first-class `Extensions` area to AirDeck.

It acts like a small AirDeck app store/extension marketplace for discovering, installing, updating, enabling, disabling and removing extensions.

Primary views:

- Discover;
- Installed;
- Updates;
- Categories;
- Developer/Publisher;
- Permissions & Security;
- optional Development/Local Extensions mode for authorized developers.

Each extension detail view should include:

- name;
- icon;
- publisher;
- version;
- supported AirDeck/Core/API versions;
- supported platforms/surfaces;
- description/screenshots;
- requested permissions/capabilities;
- privacy/data access declaration;
- network domains/endpoints if external access is requested;
- changelog;
- install/update action;
- verification/signing state;
- community rating/reviews when available;
- support/source/license links where supplied.

## 5. Extension architecture: no duplicated AirDeck

Extensions integrate with AirDeck through stable extension contracts. They must not bundle or fork another AirDeck Core.

Preferred model:

```text
Extension package
   |
   +-- manifest
   +-- signed package / integrity metadata
   +-- optional UI contribution
   +-- optional Core/server contribution through approved SDK
   +-- migrations owned by extension namespace
   +-- assets/locales
        |
        v
AirDeck Extension Host / SDK
        |
        +-- RBAC + station scope
        +-- capability permissions
        +-- API/event contracts
        +-- lifecycle
        +-- audit/logging
        v
Shared AirDeck Core
```

An extension may contribute features, commands, panels, integrations, importers/exporters, provider adapters, automation actions/triggers, metadata processors or other approved extension points.

It must not bypass Core authorization or directly assume access to all station/user/media data.

## 6. Manifest

Define a versioned manifest contract before accepting third-party extensions. Example conceptual fields (exact schema to be implemented and versioned):

- extension id (globally stable/reverse-domain style recommended);
- name;
- publisher id;
- version;
- manifest schema version;
- minimum/maximum compatible AirDeck contract version;
- entry points;
- platform/surface support;
- requested capabilities;
- requested network access;
- UI contribution points;
- dependencies;
- optional extension-to-extension dependencies;
- integrity/signature metadata;
- update channel;
- license/privacy/support metadata.

Unknown or unsupported permissions must fail closed.

## 7. Permission/capability model

Extensions receive only declared and approved capabilities.

Candidate capabilities include narrowly scoped variants of:

- read station metadata;
- read/write schedule;
- read media metadata;
- request media file access;
- automation actions/triggers;
- read output status;
- control outputs;
- notifications;
- UI panels/navigation contributions;
- external network access to declared domains;
- extension-owned storage;
- community/publisher API.

High-impact permissions must be clearly disclosed before install/enable and may require administrator approval.

Never expose raw stored passwords/tokens to extensions. Provider operations should use Core-mediated APIs wherever possible.

## 8. Sandboxing and trust

Do not treat marketplace code as trusted merely because it is installable.

Implementation must evaluate platform-appropriate isolation. At minimum:

- signed/integrity-checked packages;
- publisher identity;
- explicit permission grants;
- restricted filesystem access;
- restricted process execution;
- restricted network access;
- no arbitrary secret-store access;
- namespace-isolated extension storage;
- lifecycle timeouts/crash isolation where practical;
- audit trail for sensitive actions;
- ability to disable/quarantine a broken extension without breaking AirDeck startup.

A safe mode must allow AirDeck to start with third-party extensions disabled.

## 9. Store / registry backend

The marketplace catalog should be a registry service/API, not hard-coded into clients.

It should support:

- publishers;
- extension metadata/version records;
- immutable package hashes;
- package signing/verification metadata;
- compatibility declarations;
- categories/search;
- release channels;
- moderation/revocation;
- ratings/reviews;
- install/update metadata;
- security advisories;
- staged or emergency withdrawal of malicious/broken releases.

AirDeck clients should cache catalog metadata safely but the Core remains authoritative for install/enable policy.

## 10. Developer experience

Developers need an official AirDeck Extension SDK and documentation.

Provide eventually:

- manifest JSON schema;
- typed API/SDK package(s);
- sample extension;
- local development mode;
- packaging/signing CLI;
- compatibility validator;
- test harness using the AirDeck Demo;
- publishing workflow;
- review/security requirements;
- versioning/deprecation policy.

Developer mode must be visibly different from normal marketplace installation and must not silently weaken production security.

## 11. Live testing rule

All live tests for community/extension functionality must follow AirDeck's binding rule: **live tests only on the designated AirDeck Demo**.

Third-party extension development must never use a real production/customer station as the default live-test target. Local automated/integration tests are allowed; runtime/live verification belongs on the Demo.

The Extension SDK/test harness should make the Demo the documented live target.

## 12. Cross-platform behavior

The extension system must not create five unrelated plugin ecosystems.

An extension declares the surfaces it supports. Shared/Core functionality should be implemented once through the extension contract. UI contributions can have platform-specific renderers/adapters.

Examples:

- a provider adapter can run in the shared Core and expose status/actions to all compatible clients;
- a desktop-only audio-driver extension may legitimately support Windows only;
- an extension with general station-management UI should expose equivalent capability to Web/Android/iOS where the extension contract and platform allow it;
- unsupported platforms must be declared explicitly rather than failing silently.

## 13. Installation lifecycle

Target lifecycle:

1. discover/select extension;
2. fetch trusted catalog metadata;
3. check AirDeck/platform compatibility;
4. display publisher + permissions + data/network access;
5. download package;
6. verify hash/signature;
7. stage package;
8. validate manifest/dependencies/migrations;
9. request/admin-approve capabilities where required;
10. atomically install;
11. start/enable through Extension Host;
12. healthcheck;
13. rollback/quarantine on failed activation.

Updates use the same validation path and must support rollback where feasible.

Removal must clean extension runtime registration while preserving/removing extension-owned data according to an explicit user choice/policy.

## 14. Community/store moderation and security

Plan for:

- verified publisher status;
- malware/security review workflow;
- automated package scanning;
- manual review for sensitive capabilities;
- report extension/review/user;
- extension/version revocation;
- security advisory channel;
- publisher suspension;
- audit trail;
- clear distinction between official, verified third-party and unverified/developer-local extensions.

Ratings must not substitute for security review.

## 15. Initial implementation phases

### Phase A — user identity surface
- inspect existing top/navigation bar;
- show avatar + display name/username;
- add profile/account/settings menu;
- preserve responsive/mobile native layout;
- add profile/avatar model through existing user system.

### Phase B — community foundation
- community profile/preferences;
- notification/community entry point;
- privacy defaults;
- publisher profile foundation;
- moderation/reporting data model.

### Phase C — extension contracts
- ADR/threat model;
- manifest schema;
- capability/permission vocabulary;
- Extension Host lifecycle;
- extension-owned storage;
- compatibility/version rules;
- safe mode.

### Phase D — Extensions UI
- Discover/Installed/Updates;
- extension details + permission disclosure;
- enable/disable/remove;
- local developer extension mode.

### Phase E — registry/store
- catalog API;
- publisher workflow;
- signing/integrity;
- publishing/review/moderation;
- ratings/reviews;
- security revocation/update flow.

### Phase F — official SDK
- typed SDK;
- sample extension;
- packaging/signing tooling;
- Demo test harness;
- developer docs.

## 16. Acceptance rules

Do not call the feature complete merely because an `Extensions` menu exists.

Completion must separately prove:

- existing user/RBAC integration;
- visible signed-in identity;
- profile/avatar handling;
- community privacy/moderation basics;
- manifest/version contract;
- permissions enforced Core-side;
- safe install/update/remove lifecycle;
- package integrity/signing;
- crash/safe-mode behavior;
- developer SDK path;
- Windows/Web/Docker/Demo parity;
- Android/iOS adaptation where applicable;
- automated tests;
- live verification exclusively on the AirDeck Demo.
