# AirDeck Platform Parity PR Checklist

Use together with `PLATFORM_PARITY.md` for main product capabilities.

## Core / source of truth
- [ ] Feature uses the existing AirDeck Core/domain model or deliberately extends it.
- [ ] No duplicate automation, station, MusicHub, RBAC, provider or output state was created in a client.
- [ ] Permissions and station scope are enforced server-side/Core-side.
- [ ] API/event contracts are documented where cross-platform clients consume them.

## Windows
- [ ] Windows Standalone remains operational with a local Core/Engine.
- [ ] Full desktop functionality is preserved/extended where the feature is applicable.
- [ ] Closing the UI does not accidentally terminate intended background playout/server operation.

## Server / Web / Docker
- [ ] Server/Web exposes equivalent domain capability.
- [ ] Docker runs the same Core behavior, not a fork or reduced reimplementation.
- [ ] Deployment/configuration differences are documented rather than hidden in feature code.

## Demo
- [ ] Demo is on the same feature contract/version.
- [ ] Demo uses real product behavior where practical.
- [ ] Any disabled destructive/external action is explicitly a demo safety restriction.
- [ ] Demo reset/seed does not alter production semantics.

## Android
- [ ] Main capability implemented with Android-native UX, or explicit exception documented.
- [ ] Android does not contain a private duplicate of domain logic.
- [ ] Authentication/secrets use platform-appropriate secure storage.

## iOS / iPadOS
- [ ] Main capability implemented with Apple-native UX, or explicit exception documented.
- [ ] iOS does not contain a private duplicate of domain logic.
- [ ] Authentication/secrets use Keychain/platform-appropriate secure storage.

## Parity / compatibility
- [ ] `PLATFORM_PARITY.md` matrix remains accurate.
- [ ] Client/Core compatibility is considered.
- [ ] Shared DTO/event changes have migration/backward-compatibility handling where required.
- [ ] Platform-specific limitation has a documented alternative workflow.

## Tests
- [ ] Core tests cover the domain behavior.
- [ ] Negative RBAC/station-scope tests exist where relevant.
- [ ] Web/Windows critical path is tested.
- [ ] Docker/demo regression is tested where relevant.
- [ ] Android/iOS contract tests are added when those surfaces consume the feature.

## Completion language
Do not call a cross-platform feature simply `done` when only one surface exists. Report separately: Core, Windows, Web/Docker, Demo, Android, iOS/iPadOS, tests and verification.
