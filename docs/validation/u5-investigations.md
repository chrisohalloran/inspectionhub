# U5 investigation threads and coverage ledger validation

Validated on 2026-07-17 against the U5 contract in the implementation plan.

## Implemented boundary

- The canonical investigation aggregate starts in one command, uses expected-revision writes, supports pause/resume, preserves an ordered cross-area timeline, and closes explicitly as finding candidates or no reportable finding.
- Recent captures retain original job, capture-area, time, and sequence metadata. Retroactive attachment creates links rather than copies. A wrong-area correction appends assignment history and does not rewrite `captureAreaId`.
- One immutable original can support separate Building and Timber Pest candidate links without merging their module identities.
- Structured observations and measurements remain part of the investigation. Finishing is immediate with either `manual_only` or `queue_ai_asynchronously`; AI is not on the field completion path.
- Investigation packets contain only inspector-selected attached evidence plus bounded location, corrected transcript spans, contradictions, prior inspector feedback, observation, measurement, coverage, limitation, unknown, exact module-schema, and pinned model/prompt/skill data. Source references, span bounds, module identities, and schema mappings fail closed. The packet is immutable, revisioned, and canonically hashed.
- Coverage is an inspector-set per-area, per-module ledger with `inspected`, `access_limited`, `inaccessible`, `not_applicable`, and `revisit` states. Limited/inaccessible states require explicit limitations. Revisit creates a visible open item and a later inspector judgement resolves it. No photo count or percentage participates in completion.
- The integrated field shell reserves the fixed dock for capture-critical photo, tap-to-record voice, and start/pause/resume controls. Attach recent, area change, measurement, evidence correction, coverage close-out, and finish remain in the scrollable current-area workspace so the dock stays reachable at accessibility-large text. Photo remains enabled while voice is recording or saving. All primary and secondary actions declare at least 48 by 48 pixels, text status, dynamic type, and wrapping at 200% text scale.
- The field shell now executes the U5 transitions against the local repository instead of presenting placeholders: it restores or creates the coverage ledger, attaches the newest three acknowledged, unattached same-job captures in order, persists domain-validated measurements, paginates all attached evidence for direct area correction, records per-module close-out states and limitations, and lets one selected evidence set create separate Building and Timber Pest candidate links.
- A platform-typed Expo SQLite adapter stores checksummed investigation/coverage snapshots with compare-and-set revisions and a redacted append-only local event log. Reopening a new repository instance reconciles the field-session area and active pointer against the durable aggregate and restores the coverage ledger; checksum or identity corruption fails closed instead of restoring professional state. UI-originated events use event-specific key and value schemas rather than accepting professional prose.
- Runtime restoration validates the complete nested investigation and coverage aggregates rather than accepting a shallow envelope. It checks ordered timeline projection, artifact/area/measurement/observation semantics, completion shape, module links, checksums, and observation-only candidates before any stored state can regain professional authority.
- Field mutations run through one duplicate-tap fence. A failed compare-and-set reloads durable investigation and coverage state and shows an explicit review-and-retry status. Pausing closes active-only panels, and incomplete coverage blocks module approval and delivery packaging.
- Each professional approval is bound to the exact accepted review versions and a monotonic revision of that module's coverage only. A Building coverage change invalidates Building approval without silently staling an unchanged Timber Pest approval, and vice versa. The canonical SHA-256 approval snapshot covers the actual job, organisation, module, review versions and coverage state; stored workflow parsing revalidates review provenance, checks, verifier state, approval review versions, and package coherence. The package manifest includes the commissioned module set, exact approval bindings and accepted review versions. Coverage and review mutations clear the affected approval and any prior package before the professional write can proceed.
- Startup searches checksummed job-scoped investigation snapshots whenever the field-session pointer is absent. An active aggregate committed immediately before process termination is therefore recovered instead of becoming an orphan that permits a second investigation to start.
- Candidate completion commits the aggregate first, then reconciles the session pointer and selectively invalidates only the affected professional modules. A pure startup reconciliation covers process loss between those writes without reviving stale approval or package state.
- The field session now persists the exact organisation and commissioned module references. Session, workflow, and investigation reconciliation rejects a foreign job, tenant, module type, or module ID before any cached state can regain authority. Snapshot restoration also requires the complete contiguous local event chain from revision zero through the current head, with the event head bound to the current snapshot hash.
- Finding-candidate reconciliation persists processed candidate IDs. A completed investigation invalidates affected professional state once, but later asynchronous drafts for that same completed investigation survive restart instead of being mistaken for newly discovered stale work.
- Approval binding recomputes every accepted finding's canonical content hash and hashes the complete accepted authority: finding content, authorship, source references, provenance, verifier result, checks, exact coverage, job, organisation, and module. Mutating content, provenance, verifier version, evidence hash, checks, or the packet hash invalidates approval and package restoration.
- The stable capture dock visibly retains the full area path and a typed local-durability/action status at accessibility-large text, including the explicit `Not saved — retry` state after a rejected local write. Completion blockers are rendered in a scrollable per-module checklist with a reachable `Continue field work` action, and coverage/measurement forms keep dismissal disabled while a protected write is in flight and surface rejected writes locally after durable state reload.
- iOS announces saved, not-saved, and needs-review durability changes without repeating identical announcements. Evidence-area correction includes local photo previews, original voice playback, transcript-unavailable context, and manual-note excerpts so inspectors do not identify hundreds of artifacts from sequence numbers alone.
- The fake server-durability and delivery-provider controls are absent until their exact lifecycle states exist. Evidence advances through valid queue transitions before a package becomes queued; provider proof then records sending, provider-accepted, and sent separately. Review, approval, package, and provider mutations use the same field-action fence, and a confirmed package is visibly disabled so it cannot be recreated or silently requeued.
- React Native package exports resolve current workspace source through a scoped Metro fallback for TypeScript sources that retain emitted `.js` specifiers. The real simulator therefore exercises the same current domain validator proved by the focused tests instead of a potentially stale `dist` build.
- `pnpm test:contract:mobile` is the explicitly named deterministic contract gate used in CI. `pnpm test:e2e:mobile` fails closed unless it executes the five Maestro journeys against a selected runtime, so contract checks can no longer be reported as UI E2E proof.
- Synthetic cracked-tile and shared Building/Timber Pest fixtures use independently written language and retain the inspector's classifications, uncertainty, source selection, and material inaccessible-roof limitations.

The mobile field shell imports only the platform-safe `InvestigationStatus` type from `@inspection/domain/inspection/types`; it does not transitively import the Node SHA-256 implementation. The full mobile investigation repository continues to consume the platform-safe `@inspection/domain/inspection/mobile` surface.

## Automated proof

Focused suite:

```text
pnpm exec vitest run packages/domain/src/inspection packages/test-fixtures/src/investigations apps/mobile/src/areas apps/mobile/src/investigations apps/mobile/src/measurements apps/mobile/src/storage/field-workflow.test.ts apps/mobile/src/completion apps/mobile/src/review/demo-review-items.test.ts --config vitest.config.ts

Test Files  19 passed
Tests       75 passed
```

The focused cases prove:

- three pre-thread photos attach and appear in capture order;
- only unattached captures from the same job are eligible for recent attachment;
- at-risk, quarantined, failed, and otherwise unacknowledged captures cannot be attached as professional evidence;
- an investigation continues from the main bathroom to the exterior;
- capture-area metadata survives an inspector correction, while every attached artifact remains reachable through paged direct-area correction;
- paused work rejects mutation until explicit resume;
- Building and Timber Pest links reuse one original without schema merging;
- no-reportable-finding closure creates no module candidate and needs no AI;
- inaccessible roof-void close-out creates separate material limitations;
- coverage initialisation and close-out events persist with redacted, allowlisted metadata;
- revisit items remain visible until a later coverage judgement;
- private unselected coverage evidence is absent from a drafting packet;
- field controls are textual, 48-pixel minimum, wrapping, one-tap where required, and do not disable the shutter during voice capture;
- crack-width, length, level, moisture percentage, and relative-scale values are validated in the domain before recording;
- incomplete coverage blocks professional completion readiness;
- Building and Timber Pest approvals bind independently to exact accepted versions and per-module coverage revisions;
- accepted authority fails closed when content, provenance, evidence, verifier, checks, or the approval snapshot changes;
- candidate processing is idempotent and preserves a later asynchronous draft for the same completed investigation;
- local process restart reconciles the field session to the active investigation, recovers an open aggregate even when its session pointer was never committed, rejects foreign professional identity and incomplete event history, detects snapshot corruption, and rejects professional prose disguised as safe metadata;
- a confirmed delivery package remains non-actionable, while synthetic evidence and provider fixtures traverse only valid lifecycle transitions.

Integrated simulator proof:

```text
MOBILE_E2E_RUN_MAESTRO=1 \
MAESTRO_DEVICE_ID=DF3F2D11-DD01-4F8F-8567-14E559B3747A \
MAESTRO_DRIVER_STARTUP_TIMEOUT=120000 \
pnpm test:e2e:mobile

Deterministic mobile tests: 35 files, 134 tests passed
Maestro runtime: InspectionHub E2E, iOS 26.3, accessibility-large text
Maestro journeys: 5 passed sequentially
```

The U5 journey captured three private photos, started one investigation, attached the newest three in original order, changed to the roof void, stored a structured measurement, reassigned evidence while retaining the original capture area, recorded Building coverage as inaccessible with a limitation, and saved the same selected evidence as distinct Building and Timber Pest finding candidates. The surrounding suite also exercised termination recovery, photo-plus-voice capture, offline queueing, exact review and independent module approval, persisted delivery state, session-expiry capture, and area-change restoration.

Static and build proof:

```text
/Users/chrisohalloran/.codex/skills/design-md/scripts/design_md.sh lint DESIGN.md
# 0 errors, 0 warnings

pnpm lint
# 22 package lint tasks, formatting, repository quality and foundation validation passed

pnpm test
# 87 test files, 436 tests passed

pnpm typecheck
# 22 package typecheck tasks passed

pnpm build
# 22 package build tasks passed; Expo produced the iOS bundle from current workspace source

pnpm test:submission-readiness
# 66 tests passed

pnpm test:eval
# 3 test files, 36 tests passed

pnpm test:security
# static and dependency audit passed; 7 test files / 63 tests and Postgres 9 migrations / 6 SQL tests passed

pnpm test:soak
# 1 test file, 1 test passed
```

The dependency audit reports two non-blocking known advisories in transitive/locked packages (`postcss@8.4.31` and `uuid@7.0.3`), with no high, critical, or unknown-severity finding.

## Evidence locations

- Domain aggregate and coverage ledger: `packages/domain/src/inspection/`
- Platform-safe mobile domain surface: `packages/domain/src/inspection/mobile.ts`
- Field control dock and interaction contracts: `apps/mobile/src/investigations/`
- Local SQLite snapshots, revision fencing, checksums, and redacted event log: `apps/mobile/src/investigations/local-inspection-repository.ts` and `apps/mobile/src/investigations/sqlite-inspection-snapshot-port.ts`
- Coverage close-out/presentation: `apps/mobile/src/areas/`
- Structured measurement input: `apps/mobile/src/measurements/`
- Cracked-tile and mixed-module fixtures: `packages/test-fixtures/src/investigations/`
- Accessibility-large sent-state screenshot showing exact accepted authority, literal sent status, independent module approval, and a disabled confirmed-package action: `artifacts/validation/u5-investigations/ios-26.3-accessibility-large-completed.png`
- Accessibility-large completion screenshot showing the open-investigation blocker, separate module status, reachable field-work return, and disabled package action: `artifacts/validation/u5-investigations/ios-26.3-accessibility-large-checklist.png`

## Required physical validation still outside this automated proof

This validation proves the integrated U5 flow on a signed iOS simulator at the iOS accessibility-large text setting. It does not claim a physical-device timing, VoiceOver/TalkBack, wet-hand, glove, sunlight, or exact 200% Dynamic Type session. Those named checks require the Build Week physical iPhone/Android run and measured evidence described by the global physical-field validation contract. Simulator and TypeScript evidence are not substitutes for physical-device proof.
