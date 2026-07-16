# U5 investigation threads and coverage ledger validation

Validated on 2026-07-15 against the U5 contract in the implementation plan.

## Implemented boundary

- The canonical investigation aggregate starts in one command, uses expected-revision writes, supports pause/resume, preserves an ordered cross-area timeline, and closes explicitly as finding candidates or no reportable finding.
- Recent captures retain original job, capture-area, time, and sequence metadata. Retroactive attachment creates links rather than copies. A wrong-area correction appends assignment history and does not rewrite `captureAreaId`.
- One immutable original can support separate Building and Timber Pest candidate links without merging their module identities.
- Structured observations and measurements remain part of the investigation. Finishing is immediate with either `manual_only` or `queue_ai_asynchronously`; AI is not on the field completion path.
- Investigation packets contain only inspector-selected attached evidence plus bounded location, corrected transcript spans, contradictions, prior inspector feedback, observation, measurement, coverage, limitation, unknown, exact module-schema, and pinned model/prompt/skill data. Source references, span bounds, module identities, and schema mappings fail closed. The packet is immutable, revisioned, and canonically hashed.
- Coverage is an inspector-set per-area, per-module ledger with `inspected`, `access_limited`, `inaccessible`, `not_applicable`, and `revisit` states. Limited/inaccessible states require explicit limitations. Revisit creates a visible open item and a later inspector judgement resolves it. No photo count or percentage participates in completion.
- The mobile field contract keeps photo, tap-to-record voice, start/pause/resume investigation, attach recent, area change, and finish in one control dock. Photo remains enabled while voice is recording or saving. All primary and secondary actions declare at least 48 by 48 pixels, text status, dynamic type, and wrapping at 200% text scale.
- A platform-typed Expo SQLite adapter stores checksummed investigation/coverage snapshots with compare-and-set revisions and a redacted append-only local event log. Reopening a new repository instance restores the active area thread; checksum or identity corruption fails closed instead of restoring professional state.
- Synthetic cracked-tile and shared Building/Timber Pest fixtures use independently written language and retain the inspector's classifications, uncertainty, source selection, and material inaccessible-roof limitations.

The mobile field shell imports only the platform-safe `InvestigationStatus` type from `@inspection/domain/inspection/types`; it does not transitively import the Node SHA-256 implementation. The full mobile investigation repository continues to consume the platform-safe `@inspection/domain/inspection/mobile` surface.

## Automated proof

Focused suite:

```text
pnpm exec vitest run packages/domain/src/inspection packages/test-fixtures/src/investigations apps/mobile/src/areas apps/mobile/src/investigations apps/mobile/src/measurements --config vitest.config.ts

Test Files  9 passed
Tests       33 passed
```

The focused cases prove:

- three pre-thread photos attach and appear in capture order;
- an investigation continues from the main bathroom to the exterior;
- capture-area metadata survives an inspector correction;
- paused work rejects mutation until explicit resume;
- Building and Timber Pest links reuse one original without schema merging;
- no-reportable-finding closure creates no module candidate and needs no AI;
- inaccessible roof-void close-out creates separate material limitations;
- revisit items remain visible until a later coverage judgement;
- private unselected coverage evidence is absent from a drafting packet;
- field controls are textual, 48-pixel minimum, wrapping, one-tap where required, and do not disable the shutter during voice capture;
- crack-width units and values are validated before recording.
- local process restart restores the active investigation, stale writes fail compare-and-set, snapshot corruption is detected, and events omit snapshot/media/observation content.

Static and build proof:

```text
pnpm exec eslint packages/domain/src/inspection packages/domain/src/freeze.ts packages/domain/src/canonical.ts apps/mobile/src/areas apps/mobile/src/investigations apps/mobile/src/measurements packages/test-fixtures/src/investigations packages/test-fixtures/src/index.ts
# exit 0

pnpm --filter @inspection/mobile typecheck
pnpm --filter @inspection/domain typecheck
pnpm --filter @inspection/test-fixtures typecheck
# all exit 0

pnpm --filter @inspection/domain build
pnpm --filter @inspection/test-fixtures build
pnpm --filter @inspection/mobile build
# all exit 0; Expo iOS export produced the bundle

sed -n '/await this.#database.execAsync(`/,/^    `);/p' apps/mobile/src/investigations/sqlite-inspection-snapshot-port.ts | sed '1d;$d' | sqlite3 :memory:
# exit 0; SQLite accepted the local snapshot/event schema and append-only triggers
```

## Evidence locations

- Domain aggregate and coverage ledger: `packages/domain/src/inspection/`
- Platform-safe mobile domain surface: `packages/domain/src/inspection/mobile.ts`
- Field control dock and interaction contracts: `apps/mobile/src/investigations/`
- Local SQLite snapshots, revision fencing, checksums, and redacted event log: `apps/mobile/src/investigations/local-inspection-repository.ts` and `apps/mobile/src/investigations/sqlite-inspection-snapshot-port.ts`
- Coverage close-out/presentation: `apps/mobile/src/areas/`
- Structured measurement input: `apps/mobile/src/measurements/`
- Cracked-tile and mixed-module fixtures: `packages/test-fixtures/src/investigations/`

## Required physical validation still outside this automated proof

This validation does not claim a physical-device timing, VoiceOver/TalkBack, wet-hand, glove, sunlight, or 200% Dynamic Type session. Those named checks require the Build Week iPhone/Android run and measured evidence described by the global physical-field validation contract. The exported `InvestigationControlDock` must be exercised through the integrated U4 capture shell in that run; a TypeScript layout contract is not a substitute for device proof.
