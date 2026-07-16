# Devpost submission preflight

This fail-closed gate covers only the current official OpenAI Build Week
submission contract. It does not replace or weaken
`pnpm milestone:build-week`, which remains the stricter internal product
validation gate.

Run a truthful blocked preflight:

```bash
pnpm milestone:submission
```

Collect the currently observable public/local proof from a clean commit that is
already pushed to `origin/main`:

```bash
pnpm submission:evidence:observe
```

The observer refuses to start unless the worktree is clean and `HEAD` exactly
matches `origin/main`. It then checks that GitHub exposes that exact commit on
public `main`, and that the latest matching `.github/workflows/ci.yml` attempt
for that SHA is a completed, successful `push` run on `main`. It also observes the logged-out
repository, raw README and AGPL licence, the public root commit and repository
creation time, and the committed track and description.

The public Markdown checks are substantive rather than presence-only. The
README must contain setup, test, sample-data and licensing instructions plus a
bounded Codex and GPT-5.6 section. The committed Devpost copy must contain the
selected track and bounded one-line, product, and Codex/GPT sections.

For the working-project proof, the observer creates a temporary detached
worktree at the exact commit, inherits only a bounded environment, runs
`pnpm install --frozen-lockfile`, runs the full build, starts
`pnpm demo:judge`, and probes the invitation, OTP and recipient-report flow. It
always removes the detached worktree and temporary directory afterward.

The resulting manifest remains deliberately blocked. The observer passes
exactly these five currently observable requirements:

- `working_project`;
- `track`;
- `description`;
- `repository`; and
- `provenance`.

`judge_access` remains unproven: a successful local judge run cannot
self-attest that free access will remain available through the future judging
deadline. Live GPT-5.6, public YouTube, `/feedback`, final video rights and
Devpost-form requirements also remain unproven rather than being inferred.

Every passing evidence record has its own JSON envelope. The envelope binds the
record ID, kind, bounded claim, provenance, details and exact commit to the raw
observation; the input then binds the envelope bytes by SHA-256. Generic or
shared checksum-only files, symlinked artifacts, post-deadline runs and any
non-empty skipped-check list fail closed. The envelope contract is published in
`artifact-envelope.schema.json`. The observer creates its output directory
exclusively and cleans it up on any failure, so it does not leave a partial
evidence packet that could be mistaken for a valid run.

Public provenance and judge-access passes also require exact runtime-only
verification context from the trusted observer. That context is bound to the
evidence ID, kind, commit, observation time, artifact checksum and raw
observation, and is deliberately never accepted from or written into candidate
JSON. Replaying a serialized packet can validate its structure and checksum,
but cannot manufacture those live external passes; collect them again through
the observer harness.

The evidence-input and artifact-envelope contracts remain schema version 1.
The emitted submission-manifest contract is schema version 2.

Run the focused submission-readiness test suite with:

```bash
pnpm test:submission-readiness
```

Evaluate observed evidence:

```bash
pnpm milestone:submission -- \
  --evidence artifacts/validation/<run-id>/submission-evidence.json \
  --output artifacts/validation/<run-id>/submission-manifest.json
```

This replay remains fail-closed for public provenance or judge access because
their runtime verification context is intentionally non-serialized. The
manifest emitted by the observer invocation records the result from the same
live observation process.

The preflight requires exactly these evidence-backed results:

- a working project on its intended platform;
- meaningful Codex use and a successful meaningful live GPT-5.6 run;
- one selected track and an English description of features and function;
- a logged-out public YouTube response with expected content, a final YouTube
  URL, successful HTTP status, duration under 180 seconds, a working demo and
  audio covering the product, Codex and GPT-5.6;
- an accessible repository with relevant licensing and the required README
  content; a private repository must be shared with both official reviewer
  addresses;
- the actual nonempty `/feedback` Session ID from the primary build task;
- a free, observed-working website, functioning demo, test build, sandbox or
  test account available through **2026-08-06T00:00:00.000Z**. This is the UTC
  equivalent of the official judging-period end, 5:00 PM Pacific Time on
  5 August 2026;
- creation-period or documented pre-existing-project provenance;
- ownership, third-party authorization and video rights review; and
- all required pre-submission Devpost form fields completed.

Every pass references an observed artifact under `artifacts/validation/` and
the validator re-reads its SHA-256 before emitting
`devpost_submission.preflight.ready`. With no evidence, every requirement is
`unproven`, the manifest is `blocked`, no readiness event is emitted and the
command exits 4.

Submission receipt, submitted status and the final Devpost project URL are
deliberately absent. Record and verify those only after the external submission
has succeeded.

Physical-iPhone testing, representative human sessions, an accessibility
audit, full recipient-security production proof, independent review and the
internal score threshold remain in `pnpm milestone:build-week`. They strengthen
the product and entry, but they are not official Devpost preflight fields.
