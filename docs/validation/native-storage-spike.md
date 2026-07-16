# KTD3 native durable-file capability spike

Status: **native and U4 integration implemented statically; physical iPhone oracle pending, so U4 remains physically unverified**
Last updated: 2026-07-15 (Australia/Brisbane)

## Decision and boundary

Expo SDK 57's JavaScript file API exposes write, close and move operations but does not expose a documented durable flush/fsync primitive. The app therefore uses the local Expo module pattern documented by Expo, with one deliberately narrow native capability:

1. validate an opaque capture identity and a local `file://` source;
2. copy into a unique `.partial` beside the final file in app-owned storage;
3. SHA-256 hash while copying;
4. durably synchronise the partial bytes (`FileHandle.synchronize` plus `fsync` on iOS; `FileDescriptor.sync` plus `Os.fsync` on Android);
5. make the partial read-only and synchronise that metadata;
6. exclusively publish it under `<capture-id>.capture` with a same-filesystem atomic rename; and
7. fsync the containing directory, reporting `unsupported` only for the platform's explicit unsupported errno.

The module returns either a typed success or a structured failure with the exact native stage and whether no artifact, a development-only partial, or a final file may exist. It rejects non-file URLs, query/fragment-bearing URLs, `..` segments, symlink sources, source files already inside the durable root, unsafe capture IDs and existing final paths. Final files are mode `0400`, and an existing capture identity is never overwritten.

This native primitive is **not by itself** the KTD3 two-resource protocol and never writes SQLite or acknowledges a capture. U4 now composes it with the exclusive SQLite artifact/queue transaction and startup reconciliation in `apps/mobile/src/storage/`; that composition still requires the physical oracle below.

Sources checked for the implementation convention:

- [Expo Modules API: get started](https://docs.expo.dev/modules/get-started/), specifically the recommended `modules/<name>` local-module layout and development-build/prebuild flow.
- [Expo Modules API reference](https://docs.expo.dev/modules/module-api/), specifically `ModuleDefinition`, `Name` and `AsyncFunction`.
- [Expo native module tutorial](https://docs.expo.dev/modules/native-module-tutorial/), including `requireNativeModule` from `expo` and current Swift/Kotlin module definitions.

## Development-only failure points

`persistCapture` accepts one optional failure point. Any non-`none` value fails closed in a non-debuggable build.

| Value                           | Behaviour                                                                                 | Expected durable residue           |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| `terminate_after_copy`          | Sends SIGKILL after userspace copy and before durable partial sync.                       | Partial may be truncated.          |
| `return_after_partial_sync`     | Returns `DEBUG_FAILURE_INJECTED` after file fsync and deliberately preserves the partial. | One complete `.partial`; no final. |
| `terminate_after_partial_sync`  | Sends SIGKILL to the development app after file fsync.                                    | One complete `.partial`; no final. |
| `terminate_after_hash`          | Sends SIGKILL after durable partial sync and SHA-256 calculation.                         | One complete `.partial`; no final. |
| `return_after_atomic_rename`    | Returns `DEBUG_FAILURE_INJECTED` after rename but before directory fsync.                 | Final may exist; no partial.       |
| `terminate_after_atomic_rename` | Sends SIGKILL after rename but before directory fsync.                                    | Final may exist; no partial.       |

The return injections prove structured failure and make container inspection repeatable. The termination injections exercise real process-loss boundaries. They must not be exposed through production UI or a release build.

## Exact physical iPhone oracle (blocking)

Run this on the inspector's declared Build Week iPhone using an EAS/Xcode **development build**, not Expo Go or a simulator. Record the phone model, iOS build, app build/commit, free storage, battery percentage, thermal state and whether iCloud device backup is enabled in the evidence manifest.

1. Use the integrated U4 development-only failure panel. Download the app container immediately after each termination if raw residue must be observed; on normal relaunch, U4 intentionally adopts or quarantines residue before enabling capture.
2. Create a camera-originated fixture on the phone, record its exact byte length, and compute its SHA-256 outside this module for an independent comparator.
3. Call with a fresh capture ID and `debugFailurePoint: "none"`. Expect `ok: true`, the independent hash and byte length, `immutable: true`, `directorySync: "synced"` (or an explicitly recorded `unsupported` result), no `.partial`, and one `<capture-id>.capture`.
4. Call again with the same capture ID. Expect `FINAL_ALREADY_EXISTS`; download the app container and prove the original final file's bytes/hash did not change.
5. Call with a new capture ID and `return_after_partial_sync`. Expect structured `DEBUG_FAILURE_INJECTED`, stage `partial_sync`, state `partial_preserved_debug`; download the app container in Xcode Devices and Simulators and prove the partial byte length/hash equals the source and the final path is absent.
6. Delete only that debug-oracle residue through the development harness. Call with a new ID and `terminate_after_partial_sync`. Expect the app process to terminate without a success result. Download the container before relaunch to prove one complete hashed partial and no final; then relaunch and prove startup reconciliation quarantines or preserves that same identity.
7. Call with a new ID and `terminate_after_atomic_rename`. Expect process termination. Download the container before relaunch and prove no partial plus one complete/hash-matching final; then relaunch and prove U4 adopts that same identity. A missing, corrupted or truncated final is a hard failure for this process-loss oracle.
8. Run the normal success case again, immediately force-restart the iPhone (volume up, volume down, then hold the side button until the Apple logo), relaunch, and independently verify the final's byte length and SHA-256. This is the physical persistence check after both file and directory sync.
9. Repeat the copy, durable-sync, hash, rename, SQLite and acknowledgement boundaries through the integrated U4 harness. Prove partial-only is preserved or quarantined without a second capture identity, final-only is adopted before acknowledgement, committed rows resume without duplication, and no SQLite acknowledgement exists for a missing/corrupt artifact.
10. Save the raw app logs (without source path/media content), downloaded-container manifest, independent checksums, screenshots/video of termination and relaunch, and the U4 ledger/reconciliation events under `docs/validation/build-week/native-storage/`.

Pass requires every step above on the declared iPhone, no overwrite, no truncated/hash-divergent final, and no acknowledgement without exactly one valid immutable file plus ledger identity. The same oracle is a separate U12 blocker on the declared Android support-floor device.

## Evidence expected

- device/build/profile record matching `benchmarks/launch-profile.yaml`;
- input and final byte lengths plus independently calculated SHA-256 values;
- app-container listing before/after each injected boundary;
- structured result JSON for normal and return-injection cases;
- process termination/relaunch capture for both termination points;
- directory-sync status and any unsupported errno evidence;
- duplicate-ID refusal with unchanged original hash;
- U4 reconciliation and ledger event trace; and
- an explicit pass/fail manifest with no inferred results.

## Current evidence and pending facts

Current evidence is limited to source/static validation of the local module shape and typed boundary:

- module-local strict TypeScript typecheck passed;
- Prettier and the repository ESLint configuration passed for the TypeScript wrapper;
- Expo Modules autolinking `search`, `resolve` and `verify` found `ExpoDurableFileModule` for both Apple and Android;
- clean temporary `expo prebuild --no-install` runs generated both native projects without editing the workspace app;
- the Swift source parsed and typechecked for an iOS 16.4 simulator SDK against a minimal Expo Modules API shape, and the podspec passed Ruby syntax validation; and
- `git diff --check` passed for the module and this record.

CocoaPods 1.17.0 now installs the linked iOS workspace successfully, and the official Maestro CLI 2.6.1 is installed. The physical iOS build remains blocked because the paired iPhone runs iOS 26.5.2 while Xcode 26.3 only exposes the iOS 26.2 SDK, and the configured developer account has stale keychain credentials. Homebrew OpenJDK is now available, but an Android Kotlin/Gradle compile still cannot run because no Android SDK or declared Android support-floor device is installed. These are validation-environment limits, not passing evidence. There has been **no physical-device run, no observed process-loss reconciliation, no independent on-device checksum comparison, and no Android-floor run**. Therefore EI1, the KTD3 spike, U4 and the Build Week physical capture gate are not complete.

Pending facts to record during the oracle:

- exact Build Week iPhone model and iOS build;
- actual app filesystem behaviour for directory `fsync` on that device;
- observed protection/backup attributes for U4's implemented file-protection and backup-exclusion policy;
- latency distribution under the declared real media workload;
- behaviour under genuine storage exhaustion and protected-data/device-lock states; and
- Android support-floor model, OS and atomic/directory-sync results for U12.
