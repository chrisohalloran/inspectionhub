# U8 validation — inspector review, approval, and delivery

Date: 2026-07-15

## Outcome

The U8 Build Week slice is implemented behind explicit ports and in-memory
adapters. It provides investigation-scoped review, immutable module snapshots,
revision-fenced professional approvals, an exact commissioned-module package
gate, atomic package/outbox persistence, and literal delivery outcomes. The
implementation never combines approval and send authority.

Building and Timber Pest remain separate throughout review, snapshotting,
approval, invalidation, package binding, and field status. A change to one
module clears only that module's approval.

## Implemented boundaries

- `apps/mobile/src/review/` exposes AI origin, packet ID/revision/hash, source
  revision, evidence and transcript references, transcript uncertainty,
  assumptions, checks, verifier result, and stale/rejected state. Accept, edit,
  reject, exact reverify, and explicit inspector-authored conversion are
  distinct actions.
- Rejected or stale review versions cannot be accepted or confirmed. An edited
  AI version returns to verifier-pending and needs a verifier pass for the exact
  version and content hash. The manual path records human authorship and
  `not_required` verification explicitly.
- `packages/reporting/src/snapshot/` stores canonical, immutable module
  snapshots and advances each professional module through compare-and-set
  revisions.
- `packages/approvals/` permits only the assigned, currently eligible inspector
  with the current credential and refreshed authentication to approve the exact
  current snapshot ID and hash. Idempotency-key reuse and offline stale
  revisions fail closed.
- `packages/delivery/` verifies the complete canonical commissioned module set,
  exact current approvals, the durability manifest's canonical hash, and
  checksum-verified coverage of every snapshot evidence hash. Only then does
  one transaction freeze the module references and write one outbox record.
- Delivery workers read cancellation and withdrawal status twice, with the last
  read immediately before the provider call. Provider accepted, provider sent,
  retryable failed, terminal failed, unknown, and cancelled remain separate
  logged states. A provider result lost before local persistence becomes
  `unknown` and requires reconciliation rather than an unsafe retry.
- Field components consume the root design tokens, retain explicit module and
  operational labels, wrap controls at large text sizes, and use 48-pixel
  minimum action targets. AI outage copy and an inspector-authored completion
  path are explicit.

## Focused verification

The following focused run passed:

```text
pnpm exec vitest run \
  packages/reporting/src/snapshot/snapshot-store.test.ts \
  packages/approvals/src/approval-service.test.ts \
  packages/delivery/src/delivery-service.test.ts \
  apps/mobile/src/review/investigation-review.test.ts \
  apps/mobile/src/completion/completion-state.test.ts \
  apps/mobile/src/delivery/delivery-status.test.ts

Test Files  6 passed (6)
Tests       38 passed (38)
```

The focused ESLint run passed for every U8-owned source path. TypeScript passed
for `@inspection/approvals`, `@inspection/delivery`, the full
`@inspection/reporting` package, and the full `@inspection/mobile` app. Package
lint, typecheck and builds passed for `@inspection/reporting`,
`@inspection/approvals`, and `@inspection/delivery`; the Expo iOS export also
completed successfully. Root integration should still rerun the complete gates
after all remaining units settle.

## Adversarial scenarios covered

- accept, edit, reject, stale and exact-reverify review paths;
- blocking investigation check resolution;
- explicit human-authored conversion during complete AI outage;
- attempted Building-to-Timber-Pest taxonomy edit;
- stale verifier state loaded from persistence;
- stale offline approval after another device advances the module;
- wrong inspector, expired eligibility, stale credential and missing recent
  authentication;
- Building edited while Timber Pest approval remains current;
- withdrawal requiring a genuinely new replacement snapshot;
- combined package with one module pending and no partial frozen set;
- incomplete, omitted, mismatched and tampered durability evidence, including
  an attempted derivative-for-original substitution;
- idempotent exact package replay and a single outbox;
- current snapshot changed after approval;
- withdrawal and committed cancellation immediately before provider call;
- provider accepted versus sent;
- sent confirmation observed after cancellation remains audited provider truth
  and retains the cancellation reason;
- provider success lost before local logging;
- retryable versus terminal provider failure.

## Quality rubric

| Dimension              | Passing evidence                                                                                 | Status                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Professional authority | Exact snapshot hash/revision, assigned inspector, credential, eligibility and recent-auth checks | Passed in focused tests                                             |
| AI transparency        | Origin, packet, sources, uncertainty, assumptions and verifier/stale state are visible           | Passed in focused tests and component contract                      |
| Module independence    | Separate snapshots/approvals; edit invalidates only affected module                              | Passed in focused tests                                             |
| Package integrity      | Exact commissioned set plus verified evidence manifest frozen with one outbox transaction        | Passed in focused tests                                             |
| Provider truth         | Queued, accepted, sent, failed, unknown and cancelled are literal; intent never implies sent     | Passed in focused tests                                             |
| Field accessibility    | Token-based light UI, textual status, wrapping layout and 48-pixel targets                       | Static contract passed; physical assistive-technology proof pending |
| No-office fallback     | Evidence sync may remain durably queued; AI outage supports inspector-authored completion        | Passed in focused state tests; full physical journey pending        |

## Evidence still required before claiming full U8 verification

- Integrate the U8 cards/docks into the shared mobile journey and pass the
  cracked-tile Maestro flow on the physical Build Week iPhone.
- Measure the ten-finding human close-out against the five-minute target. Unit
  execution time is not a substitute for inspector task timing.
- Run VoiceOver, TalkBack, 200% text, sunlight, wet-hand and light-glove checks
  on the declared support devices.
- Replace the in-memory package transaction and professional-status reader with
  the U2/U6 durable server adapters, then rerun the same stale, cancellation,
  withdrawal and provider-result-loss scenarios at the integration boundary.
- Live provider truth and production operational exception handling remain the
  Revenue Activation addition. The Build Week slice intentionally uses the fake
  provider.
