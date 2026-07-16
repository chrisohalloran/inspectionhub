# Setup and verification

## Prerequisites

- Node.js 22 or later
- pnpm 10.29.3 through Corepack
- Docker for the local Postgres integration gate
- Xcode and an Expo development build for iOS device work
- Optional: an OpenAI API key for the live GPT-5.6 comparison

## Install

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Keep `PROVIDER_MODE=fake` for the Build Week synthetic path. Local Supabase
credentials belong only in the ignored `.env.local`. `OPENAI_STORE=false` is a
hard privacy default. A missing OpenAI key must leave drafting on the complete
manual path and the live eval gate blocked; it must not be replaced with a
fabricated result.

As of 16 July 2026, the approved OpenAI Platform key-setup connector requires
reauthentication, so no live key has been created for this project. Do not work
around that boundary by placing a secret in source, shell history or a public
artifact.

## Run

```bash
pnpm dev
```

The web and mobile packages expose their local development surfaces through the
workspace runner. Consult app-specific logs for the assigned local URLs and
Expo QR/development-build instructions.

## Generate the deterministic demo

```bash
node scripts/demo-seed/generate.mjs --output /tmp/build-week-demo-seed.json
```

The output checksum for `build-week-golden-path-v1` is
`b72db1cd929e2d99c6c5e0c574b24907551f1d8503e92d17541e2f42ba718dd1`.
It contains no real customer, address, credential or live-provider result.

## Automated gates

```bash
pnpm design:lint
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm test:e2e:web
pnpm test:e2e:mobile
pnpm test:soak
pnpm test:eval
pnpm test:pdf
pnpm test:security
```

Run the focused milestone machinery tests with:

```bash
node --test scripts/milestone-build-week/validation.test.mjs
pnpm test:submission-readiness
```

## Devpost submission preflight

From a clean public commit, first capture the evidence that can be observed
without external form or video claims:

```bash
pnpm submission:evidence:observe
```

The observer requires a clean worktree with `HEAD` equal to `origin/main`. It
checks the exact public `main` SHA and requires the latest matching CI
`main`/`push` attempt for that SHA to be completed successfully, verifies
substantive README and Devpost-copy sections,
then creates a temporary detached worktree at the exact commit. Inside that
isolated checkout it runs `pnpm install --frozen-lockfile`, the full build and
the one-command judge flow through invitation, OTP and recipient report. The
temporary checkout is always removed.

Each of the five bounded passes (`working_project`, `track`, `description`,
`repository` and `provenance`) receives its own claim-specific, checksum-bound
JSON envelope. Any collection or validation failure cleans up the newly owned
output directory rather than retaining a partial packet. The evidence-input and
artifact-envelope contracts are version 1; the emitted manifest contract is
version 2.

The public-provenance pass is additionally bound to runtime-only verification
context from the live observer. That context is never serialized into candidate
evidence or the manifest. Replaying the JSON can check its structure and
checksum but cannot self-authorize provenance or future judge access; those
external facts must be observed again by the trusted harness.

```bash
pnpm milestone:submission
```

With no evidence, this writes a truthful `blocked` manifest and exits 4. It
checks only the official competition submission contract. Passing evidence must
be observed and checksum-backed; see
`scripts/submission-readiness/README.md`. The required judge-access path must
remain free and working through `2026-08-06T00:00:00.000Z`, the UTC equivalent
of 5:00 PM Pacific Time on 5 August 2026. The local observer leaves
`judge_access` unproven because a local run cannot demonstrate that future
availability.

The preflight does not contain or infer a submitted status, receipt or final
Devpost project URL. Verify those separately after the external submission.

## Internal Build Week product-validation manifest

```bash
pnpm milestone:build-week
```

This stricter internal gate does not determine Devpost eligibility. No evidence
input intentionally produces a `blocked` manifest under
`artifacts/validation/<run-id>/manifest.json` and exits non-zero. To evaluate a
real run, collect observed evidence following `evidence-guide.md`, populate all
29 atomic rubric results and six must-pass gates, then pass the evidence file to
the validator. A completion event is derived only after all gates pass; callers
cannot request or force `outcome: complete`.

Create a schema-complete blocked input before adding observations:

```bash
node scripts/milestone-build-week/create-evidence-input.mjs \
  > artifacts/validation/<run-id>/evidence-input.json
```
