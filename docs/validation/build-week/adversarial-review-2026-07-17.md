# Final adversarial implementation review

Reviewed on: 17 July 2026
Review target: the `codex/building-inspection-platform` change set after commit
`6929a94b0fbef5e022f941a11a73e10f101205a6`
Compound Engineering review run: `inspectionhub-20260717-1845`

## Review boundary

This was a model-assisted engineering review, not an external human audit,
penetration test, Standards review or legal opinion. The change set was reviewed
in parallel for agent architecture, API contracts, correctness, data migration,
maintainability, performance, project standards, reliability, security and
testing. A separate cross-model adversarial pass used `claude-opus-4-8`. Three
final read-only Codex passes then rechecked the mobile journey, evaluation and
milestone evidence boundary, and the public recipient/Supabase deployment
boundary.

The complete review artifacts are retained outside the repository under:

```text
/tmp/compound-engineering/ce-code-review/inspectionhub-20260717-1845/
```

They include the reviewed diff, file index, specialist findings and cross-model
result. This repository record summarises their disposition without claiming
that temporary files are durable release evidence.

## Confirmed findings resolved

The implementation and final audits confirmed and resolved the following
release-relevant defects:

1. AI finding candidates and their inspector-selected source scopes were not
   carried into the prepared request or enforced by the guard. Candidate IDs,
   source bounds and privacy-safe area lineage now cross the exact packet,
   prompt, tool and verification boundary.
2. Legacy mobile sessions could be rejected before migration, and a
   workflow-less session could report a misleading recipient-package failure.
   Migration now precedes strict parsing and the absent-workflow state remains
   a valid non-recipient state.
3. Concurrent mobile actions could overwrite one another. Field-session writes
   are now serialized and functional.
4. A failed reload could be reported as successful recovery. Failed action
   recovery now enters an explicit terminal state and preserves the underlying
   error cause.
5. An unrelated corrupt local snapshot could block the current job. Snapshot
   identity is now indexed and job-scoped, with legacy backfill/quarantine and
   real SQLite adapter contract tests.
6. The recipient rate-limit RPC could hang indefinitely. The boundary now has a
   bounded HTTP timeout and an exercised timeout path.
7. Duplicate participants could satisfy human-validation counts. Milestone
   validation now requires unique pseudonymous participants.
8. Withdrawing Timber Pest could hide an otherwise active Building report.
   Recipient authority, UI, PDF and contact behavior now preserve independent
   Building and Timber Pest withdrawal states.
9. A deterministic preflight or hand-authored aggregate could masquerade as a
   live locked-holdout release evaluation. Release evidence is now bound to the
   exact commit, model, prompt and skills, protected corpus identity, exact case
   set, immutable per-architecture trial evidence and blinded adjudication, and
   the validator recomputes the outcome instead of trusting caller booleans.
10. Recipient output omitted material limitations and could misattribute the
    inspector. The recipient projection now includes active-module limitations
    and derives inspector identity and credential authority from the approval
    binding rather than package-time caller input.
11. Audio preview cleanup did not cover natural completion. Playback state and
    listeners now reset and clean up deterministically.
12. Mutation quotas surfaced as generic access denial, and clients told users
    to retry a non-retryable lifetime cap. Database and HTTP boundaries now
    distinguish permanent grant caps from temporary report windows, including
    `Retry-After`, and both recipient clients render the distinct outcomes.
13. The recipient database contract preflight existed only as a runbook step.
    The protected production Vercel build path now fails closed unless the
    expected database contract is observed; local and preview builds remain
    credential-independent.
14. The evidence-input and evaluation-corpus v1 schemas had been changed in
    place. Historical schemas are retained, v2 is explicit, and migration
    produces a schema-valid v2 object while preserving literal blockers for
    facts that cannot be inferred.
15. The live scoring path, production SQLite snapshot adapter and recipient
    mutation routes lacked direct deterministic coverage. Those paths now have
    focused tests.
16. New mobile UI bypassed normative semantic tokens. Typography and component
    tokens from `DESIGN.md` now flow through the theme package and field cards.
17. The fresh mixed-module recipient Maestro flow did not prove process
    restoration. It now stops and relaunches the app before verifying the
    recipient-safe package.
18. Field runtime identity could fall back to synthetic identifiers outside the
    demo. Job, organisation, property and exact commissioned-module references
    now come from the durable assigned session, and a non-demo startup without
    that assignment fails closed.
19. Voice permission/preparation could race investigation completion. Voice
    start and completion now close one another synchronously while starting,
    recording or saving; photo capture remains independently available.
20. Source lineage checks admitted partial or duplicated packet identity.
    Candidate evidence now requires exact one-to-one artifact ID and content
    hash equality, unique authorship/provenance entries and an exact module ID
    drawn from the job commission. A candidate may correctly select one module
    from a combined Building and Timber Pest commission; it is not forced to
    manufacture a finding for every commissioned module.
21. Production approval could attribute a synthetic inspector when no verified
    profile was available. Synthetic authority is now demo-only; non-demo
    approval requires the verified inspector profile.
22. The simulator suite depended on inherited app state between independent
    scenarios. Independent flows now clear state explicitly, while only the
    investigation-to-recipient pair retains its intentional persisted lineage.

No confirmed P0, P1 or P2 finding remains open after remediation and focused
re-verification.

## Advisory design debt

The review also called out the size of `App.tsx` and the milestone validator,
feature-schema ownership in the field-workflow parser, and duplicated immutable
object helpers. Those are valid maintainability concerns, but they are not
release-boundary defects in this change set: behavior is protected by strict
contracts and focused tests, and extracting them during Build Week would create
a large refactor without changing professional authority or evidence safety.
They should be split behind existing contracts after the milestone rather than
allowed to grow further.

## Verification readback

The final local verification included:

- repository lint, Prettier, design-token lint and foundation validation;
- all 22 workspace package typechecks and production builds;
- the complete Vitest suite;
- deterministic agent evaluation and release-evidence contract tests;
- all 10 PostgreSQL migrations and six SQL integration suites, including
  recipient authority concurrency;
- mobile deterministic contracts, native-module validation and the six-flow
  iOS simulator/Maestro journey;
- web browser acceptance, recipient UI and quota outcomes;
- security/operations, soak, semantic PDF parity and raster baselines;
- truthful Build Week and Devpost validators, both blocked with zero validation
  errors rather than fabricating external evidence.

Exact final test counts and observed command outcomes are recorded in the
Build Week status and submission evidence documents.

## Residual evidence boundary

This review does not prove a physical-iPhone run, a live OpenAI model run, a
public production deployment, external recipient/client sessions,
accessibility audit, public video, Devpost submission, licensed Standards-matrix
review, privacy/legal review or first revenue. Those remain explicit blockers
or later Revenue Activation evidence. Simulator, deterministic and local
browser results are not relabelled as those external observations.
