# AirDeck Platform Parity Architecture

Status: **binding architecture rule**  
Applies to: Windows Standalone, Server/Web, Docker, Demo, Android, iOS/iPadOS and future first-party AirDeck clients.

## 1. Core principle

AirDeck is **one product with one authoritative domain/core architecture and multiple platform-appropriate surfaces**.

Do not create separate Windows-AirDeck, Web-AirDeck, Android-AirDeck or iOS-AirDeck business logic that evolves independently.

```text
                         AirDeck Core
     Automation · Media/MusikHub · Planning · Stations · Users/RBAC
        Encoder · Outputs · Recorder · Sync · Integrations · Events
                              |
              stable contracts / APIs / events
                              |
      +-----------------------+-----------------------+
      |                       |                       |
 Windows Standalone      Server/Web/Docker       Mobile clients
 full local product      same product state       Android / iOS
      |                       |                       |
 local Core/Engine       authoritative Core       native platform UX
```

## 2. Windows remains standalone

The Windows application is not reduced to a thin remote control.

Windows must remain capable of a complete standalone AirDeck installation with the local Core/Engine and the complete AirDeck operating surface required for professional station operation.

Closing the desktop UI must not implicitly stop a configured background/server playout process.

Windows may also connect to a remote AirDeck deployment where the architecture supports it, but remote operation must not remove standalone operation.

## 3. Server, Web and Docker

Server/Web and Docker use the same authoritative AirDeck Core, domain models, permissions and feature contracts as Windows.

Docker is a deployment form, not a separate edition of AirDeck.

A feature must not be reimplemented with incompatible semantics merely because it runs in Docker or a server installation.

## 4. Demo parity

The AirDeck demo must follow the same product version and real feature contracts as the deployable product.

Allowed demo differences are limited to environment concerns such as:

- safe demo/test data;
- restricted credentials;
- loopback/reverse-proxy configuration;
- disabled destructive/external actions where required for safety;
- deterministic reset/seed behavior.

Do not maintain a separate mock/demo implementation of product features.

A green demo should exercise real backend behavior wherever practical.

## 5. Android

Android is a first-party AirDeck surface, not a separate radio automation.

It should expose the main AirDeck capabilities supported by the shared Core while using Android-native interaction patterns and platform facilities.

Examples include Android-appropriate navigation, lifecycle/background behavior, media controls, notifications, secure credential storage, sharing and device capabilities.

Do not force the desktop layout onto Android merely to claim parity.

## 6. iOS / iPadOS

iOS/iPadOS is a first-party AirDeck surface using the same Core contracts and permission model.

It should expose the main AirDeck capabilities while following Apple platform conventions: SwiftUI/native navigation, sheets, iPad split views where appropriate, Keychain, platform media/background facilities and accessibility conventions.

Do not create a second Automation, MusicHub, station model, RBAC model or provider integration inside the iOS app.

## 7. Functional parity rule

Main product capabilities must be tracked across first-party surfaces. A platform-specific presentation may differ; domain meaning must not.

Initial parity domains:

| Capability | Windows Standalone | Server/Web/Docker | Demo | Android | iOS/iPadOS |
|---|---|---|---|---|---|
| Authentication / users / RBAC | Required | Required | Real, safely seeded | Required | Required |
| Station selection/management | Required | Required | Real, safely seeded | Required* | Required* |
| Dashboard / status | Required | Required | Required | Required | Required |
| Automation / live state | Required | Required | Required | Required* | Required* |
| Queue / Now Playing | Required | Required | Required | Required | Required |
| Planning / schedules | Required | Required | Required | Required* | Required* |
| Media library | Required | Required | Required | Required* | Required* |
| MusikHub | Required | Required | Required when released | Required* | Required* |
| Encoder / output status | Required | Required | Required | Required | Required |
| Output management | Required | Required | Safe subset | Required* | Required* |
| Recorder / voice tracking | Required | Required | As demo-safe | Required* | Required* |
| Statistics / history | Required | Required | Required | Required | Required |
| AirDeckCast | Required | Required | As demo-safe | Required* | Required* |
| lautCast | Required when released | Required when released | As demo-safe | Required* | Required* |
| Nextcloud/cloud sources | Required when released | Required when released | As demo-safe | Required* | Required* |
| Local Core/Engine hosting | **Required** | Server deployment | Hosted demo | Not required | Not required |

`Required*` means the domain capability must be available when technically meaningful, but its controls/workflow may be adapted to the mobile platform. A missing mobile capability needs an explicit documented reason, not silent omission.

## 8. One domain implementation

The following must not be independently re-created per client:

- automation scheduling/rules;
- station ownership and station scoping;
- users, roles and authorization decisions;
- MusicHub catalog/grants;
- provider credentials;
- AirDeckCast/lautCast provider semantics;
- Nextcloud authorization/source semantics;
- playout truth/state;
- encoder/output truth/state;
- audit/history semantics.

Clients render state and request actions. The authoritative Core validates and executes actions.

Windows standalone may host that Core locally; this does not make it a separate domain implementation.

## 9. API/event contract discipline

New cross-platform features should be designed Core-first:

1. define/extend the domain behavior;
2. define permissions and station scope;
3. expose a stable API/event contract where clients need it;
4. add server tests;
5. implement Web/Windows/mobile surfaces against that contract;
6. update the parity matrix and platform tests.

Never invent a private mobile-only version of a domain endpoint merely because a UI is easier to build that way.

## 10. Platform capability exceptions

Parity means equivalent product capability, not pixel-identical UI.

Acceptable differences include:

- Windows hosting a local Core/Engine while phones do not;
- platform-specific microphone/audio session handling;
- Android notification/media controls vs Apple Now Playing/Live Activities;
- iPad split view vs desktop multi-column workspace;
- OS-specific file pickers, share sheets and secure stores;
- features restricted by an OS background-execution/security model.

For each exception document:

- capability affected;
- platform limitation;
- alternative workflow;
- whether server/Web fallback is required.

## 11. Release/version discipline

First-party surfaces must declare which AirDeck Core/API contract versions they support.

Do not silently ship a client against an incompatible server contract.

Where practical CI should maintain a compatibility/parity gate for:

- API contract compatibility;
- permissions/station scoping;
- event decoding;
- critical workflows;
- current Core vs current first-party clients.

## 12. Demo and deployment acceptance

For a major capability, completion does not mean "implemented in one UI".

Track these states separately:

- Core implemented;
- API/events implemented;
- Windows surface implemented;
- Web/Docker surface implemented;
- Demo verified;
- Android surface implemented/exception documented;
- iOS/iPadOS surface implemented/exception documented;
- automated tests;
- live/manual verification where required.

## 13. Alexa and external integrations

Alexa, third-party players and other integrations are **not additional AirDeck editions**.

They are adapters/consumers of deliberately exposed AirDeck capabilities.

For example, the Alexa radio skill may consume a public listener stream but must not duplicate the AirDeck station/automation backend.

## 14. AI coding agents

Claude Code, Codex, Replit Agent or any other coding agent working on AirDeck must read this document before introducing a platform-specific feature.

Agents must not solve platform work by duplicating AirDeck business logic.

When adding a main capability, they must check whether parity work or a documented platform exception is required.

## 15. Review rule

A pull request should be challenged if it:

- creates a second source of truth;
- implements domain logic only in a client;
- causes Windows/Web/Docker to diverge;
- introduces demo-only fake behavior instead of real integration;
- creates incompatible Android/iOS semantics;
- silently omits a main function on a first-party platform;
- bypasses shared RBAC/station scope/provider security.

The default architectural decision is always: **one AirDeck, shared Core, native surfaces.**
