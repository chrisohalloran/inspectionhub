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
```

## Build Week manifest

```bash
pnpm milestone:build-week
```

No evidence input intentionally produces a `blocked` manifest under
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
