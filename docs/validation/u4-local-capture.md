# U4 local-first mobile capture validation

Validated on 2026-07-16 against U4 in the implementation plan.

Status: **implemented and green under deterministic checks plus the signed native iOS simulator Maestro gate; physical iPhone durability, latency and field evidence remain required. U4 is not yet a passed physical-device gate.**

## Implemented boundary

- The Expo field shell captures a private coverage photo in one action after device preflight, keeps the shutter available while a voice note records or saves, and queues photo and voice artifacts independently. No categorisation or AI request runs on the shutter path. A local photo count is explicitly not presented as inspection coverage.
- Each capture reserves one opaque identity and append-only intent, copies to an app-owned partial file, hashes and durably synchronises it, publishes it with an exclusive same-filesystem atomic rename, synchronises the parent directory, and commits the artifact plus upload queue row in one exclusive SQLite transaction before acknowledgement.
- iOS stores originals under protected Application Support with `completeUntilFirstUserAuthentication`, excludes the durable root from consumer backup, makes published originals read-only, uses `fsync`, `renamex_np(..., RENAME_EXCL)`, and directory `fsync`. Android uses `noBackupFilesDir`, private/read-only permissions, `Os.fsync`, `Files.move(..., ATOMIC_MOVE)`, and directory `fsync`; Android physical proof remains the later U12 gate.
- Development builds expose deliberate process termination after copy, durable partial sync, hash, atomic rename, SQLite commit, and the capture state-machine acknowledgement boundary. Production builds reject the failure oracle.
- Startup scans protected storage before enabling capture. Valid final-only files are adopted under the reserved identity; partial, corrupt, checksum-mismatched, wrong-job, and conflicting residues are preserved or quarantined under that identity. Missing or corrupt evidence is never acknowledged.
- SQLite persists intent, immutable artifact identity/checksum/byte count, independent queue lane, redacted append-only events, cached field-session state, and redacted raw performance samples. It does not persist media payloads or transcripts in these tables.
- Camera, microphone, storage, battery, low-power and native thermal state are explicit preflight inputs. Critical storage or thermal state blocks media while retaining manual-note fallback. Permission denial is literal and does not block the other capture mode.
- An enrolled device with an expired session may keep capturing only into the already-open cached assigned job. New jobs, server mutations, approval, packaging, delivery and recipient actions remain blocked until renewed authority. Observed loss/revocation blocks capture and sync; remote wipe is documented as best effort; local-only work is reported as `evidence_at_risk` rather than recoverable.
- Local-original cleanup is denied until server durability and retention eligibility are both true and no retained reference or professional/dispute hold applies.
- Shutter acknowledgement, voice start and local durable-save latency are recorded separately. The evaluator uses nearest-rank p95, retains all outliers, and cannot pass below 300 photo and 30 voice samples. Instrumentation failure does not revoke an artifact already committed as durable.

## Automated proof and evidence locations

| Contract                                        | Implementation and proof                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Capture state and two-resource commit           | `apps/mobile/src/capture/`, `apps/mobile/src/storage/sqlite-capture-ledger.ts`                            |
| Native durable boundary and failure oracle      | `apps/mobile/modules/expo-durable-file/`, `scripts/verification/validate-native-module.mjs`               |
| Startup adopt/quarantine                        | `apps/mobile/src/storage/reconciliation.ts`, `apps/mobile/src/storage/startup-recovery.ts`                |
| Camera, audio, field status and manual fallback | `apps/mobile/App.tsx`, `apps/mobile/src/audio/`, `apps/mobile/src/accessibility/`                         |
| Cached session/device authority                 | `apps/mobile/src/jobs/`, `apps/mobile/src/jobs/field-access.test.ts`                                      |
| Independent foreground queue policy             | `apps/mobile/src/sync/`                                                                                   |
| Storage, battery and native thermal policy      | `apps/mobile/src/storage/capture-preflight.ts`, `apps/mobile/src/storage/device-signals.ts`               |
| Cleanup guard                                   | `apps/mobile/src/storage/cleanup-policy.ts`                                                               |
| Raw performance rubric                          | `apps/mobile/src/storage/performance-samples.test.ts`, `apps/mobile/src/storage/performance-benchmark.ts` |
| Simulator journey definitions                   | `apps/mobile/e2e/`, `scripts/mobile/run-mobile-e2e.mjs`                                                   |

The following checks passed locally:

```text
pnpm design:lint
pnpm native:validate
pnpm --filter @inspection/mobile lint
pnpm --filter @inspection/mobile typecheck
pnpm exec vitest run apps/mobile/src
pnpm test:e2e:mobile
pnpm --filter @inspection/mobile build
```

Deterministic mobile contract result after the durable investigation/review/package workflow, exact-source lineage and restart reconciliation were added:

```text
Test Files  44 passed (44)
Tests       180 passed (180)
```

The signed native simulator runtime gate also passed in strict sequence on the dedicated iPhone 16 Pro simulator (`iOS 26.3`, UDID `DF3F2D11-DD01-4F8F-8567-14E559B3747A`):

```text
MOBILE_E2E_RUN_MAESTRO=1 \
MAESTRO_DEVICE_ID=DF3F2D11-DD01-4F8F-8567-14E559B3747A \
MAESTRO_DRIVER_STARTUP_TIMEOUT=120000 \
pnpm test:e2e:mobile

Test Files  44 passed (44)
Tests       180 passed (180)
Maestro     6 flows passed sequentially from explicit clean states
```

The final explicit-clean-state six-flow run on 2026-07-17 proved atomic-rename termination and same-identity startup adoption; local photo, voice and manual-note capture with offline queueing; an active investigation retained across area change and process relaunch; cached-job capture after session expiry; explicit revision-bound source selection; and a freshly generated Building review whose protected source packet bound two selected evidence items and one inspector observation. The independent journeys clear app state at their boundary; the field-investigation and fresh-recipient journeys deliberately share only their required persisted state. A separate clean-state seeded journey exercises review, independent approval and delivery transitions. The suite retained an independently persisted synthetic Timber Pest fixture, accepted and approved the modules separately, rendered a recipient-safe overview with Building and Timber Pest source counts, preserved package state across relaunch, and exercised valid synthetic evidence-durability and provider-state transitions. The final photo was durably linked to the active investigation and restored workflow pointers were checksum-checked against the local investigation aggregate. These runs do not prove a live model call, live server durability, a live provider send or physical-device durability. The recovery ledger has an explicit `acknowledged` intent state, so a valid normal capture is not repeatedly misreported as interrupted on later launches.

The Debug simulator app was built with Xcode 26.3 using local signing. Its simulated Mach-O entitlement section contains the expanded application identifier and private keychain access group generated from `$(AppIdentifierPrefix)$(CFBundleIdentifier)`; Expo SecureStore opened successfully in runtime. The previous build with signing disabled correctly failed closed with `A required entitlement isn't present`, which is retained as setup evidence rather than counted as a product pass.

`pnpm native:validate` found the local module through Expo autolinking on Apple and Android, accepted the podspec, and parsed the Swift source. Mobile lint and strict TypeScript passed. The Expo iOS export bundled 688 modules into a 1.7 MB Hermes bundle. `pnpm design:lint` reported zero errors and zero warnings against the root `DESIGN.md`.

`pnpm test:contract:mobile` validates all committed Maestro YAML and runs deterministic substitutes, and explicitly makes no simulator or device claim. `pnpm test:e2e:mobile` requires Maestro runtime execution against a development build compiled with `EXPO_PUBLIC_MOBILE_E2E_MODE=1`. The runtime harness executes flows sequentially because the termination oracle deliberately kills the app; production builds cannot expose the controls.

On this workstation, native autolinking, podspec syntax, Swift parsing, TypeScript compilation, unit/component tests, the Expo iOS JavaScript export, a signed Debug simulator build and the sequential Maestro runtime journey can be checked. CocoaPods 1.17.0 installed the linked workspace successfully with 105 declared dependencies and 104 pods. The official Maestro CLI 2.6.1 runs with the Homebrew OpenJDK `JAVA_HOME`. The paired physical iPhone 16 Pro runs iOS 26.5.2 (`23F84`) with Developer Mode enabled and is partially declared in `benchmarks/launch-profile.yaml`. On 17 July it was reachable through CoreDevice, the developer disk image mounted and Xcode exposed it as a destination. The current-workspace Debug build then reached automatic provisioning but failed with Xcode exit 65 because no matching Apple developer account was signed in and no iOS App Development provisioning profile existed for `co.inspectionhub.field`. Consequently, no app from this source state was installed and the physical durability-oracle, latency and field journey remain unproven. A simulator is not accepted as the KTD3 durability oracle.

## Physical Build Week iPhone gate

Use an EAS development build with `EXPO_PUBLIC_MOBILE_E2E_MODE=1`. Record all pre-run facts in `benchmarks/launch-profile.yaml` before viewing results: actual iPhone model, iOS version/build, app/runtime build, free storage, battery, low-power and thermal state, camera media distribution, and network profile. Keep at least 5 GB free unless the predeclared profile says otherwise. Preserve raw evidence under `docs/validation/build-week/u4-local-capture/` with SHA-256 checksums.

1. Prove `KTD3-IOS-DURABLE-FSYNC-ATOMIC-RENAME`: on the physical iPhone, independently inspect the development-build container and show protected app-owned partial/final files, durable file sync, exclusive same-filesystem rename, directory sync, backup exclusion and surfaced failures. A successful method return, simulator run, `close`, or rename alone is insufficient.
2. Prove `U4-IOS-KILL-EVERY-BOUNDARY`: select each failure point—copy, durable sync, hash, atomic rename, SQLite commit, and acknowledgement—then capture, allow `SIGKILL`, relaunch, and export the protected directory plus `inspection-field-v1.db`. For each reserved capture ID prove exactly one valid outcome: partial quarantined/preserved, valid final adopted, or already committed ledger/queue resumed. No second identity, missing acknowledged file, duplicate, or checksum mismatch is allowed.
3. Prove `U4-MAESTRO-RUNTIME` by running `MOBILE_E2E_RUN_MAESTRO=1 pnpm test:e2e:mobile` against the installed development build. Save the raw Maestro output and screenshots/video for start, capture, voice, offline queue, termination/relaunch, resume and area change.
4. Prove `U4-IOS-LATENCY-P95`: take 10 unmeasured warm-up photos, then retain at least 300 timestamped photo samples and 30 voice-start samples from `capture_performance_samples`. Calculate nearest-rank p95 without deleting outliers. Required maxima are shutter acknowledgement 150 ms, local durable save 750 ms, and voice start 300 ms. Checksum the raw export and record the 30-photo size/distribution facts used by the profile.
5. Prove `U4-IOS-OFFLINE-RECONNECT`: run 20 minutes in airplane mode while taking photos during queued/upload work and recording voice independently. Restore auth/network and reconcile the same local capture IDs and SHA-256 checksums with server-durable artifacts; capture is not allowed to wait for network or AI.
6. Prove `U4-IOS-PERMISSION-LOCKED-STORAGE`: revoke camera and microphone separately mid-job, verify literal manual-note fallback and independence of the other mode, exercise low/free-storage and serious/critical thermal policy, lock/relaunch after first unlock, and inspect truncated/corrupt/checksum-mismatch recovery. Confirm no media content, transcript, address, source URI or credential appears in application logs.
7. Prove `U4-DEVICE-REVOCATION-LOSS-REPLACEMENT`: expire auth with the cached assigned job open; confirm existing-job capture continues while new/server/approval/package/delivery actions remain blocked; restore auth and sync the same IDs. Then test a fully synced lost device, an airplane-mode lost device, old-device reconnect after server revocation, the reconnect/revocation race, and replacement enrollment. Server-durable work may recover; local-only work must remain visibly `evidence_at_risk`.
8. Prove `U4-FIELD-ACCESSIBILITY`: complete a 60-minute walkthrough with 300 photos, 30 voice notes, 10 investigations, multiple area changes, 20 minutes of airplane mode, one forced termination, a low-battery transition, wrong-area correction, cross-area investigation, late attachment and queued departure. Repeat critical controls in sunlight, wet-hand, light-glove, one-handed, stairs/hazard interruption, 200% text, haptic-off and audio-off conditions. The workflow must not encourage screen attention while moving through a hazard.

The physical gate fails on any evidence loss, duplicate capture identity, acknowledged missing/corrupt file, silent identity replacement, post-hoc benchmark profile change, under-sampled latency result, omitted outlier, or inaccessible critical action/status. Android parity is explicitly a separate U12 support-floor gate and must not be inferred from the static Kotlin implementation.
