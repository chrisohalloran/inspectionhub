# U1 Foundation Validation

- Validation date: 2026-07-14 (Australia/Brisbane)
- Environment: local development; synthetic fixtures only
- Scope: repository, design, compile, provider fakes, deployment/benchmark records and initial rendered shell
- Production/public deployment proof: not attempted and not claimed

## Automated results

The following commands completed with exit code 0 after a frozen-lockfile install:

- `pnpm install --frozen-lockfile`
- `pnpm design:lint` — zero errors and zero warnings
- `pnpm foundation:validate`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` — 5 files and 11 tests passed at the time of this record
- `pnpm build` — Next.js production build, worker TypeScript output and Expo iOS bundle completed

The foundation validator has a witnessed proof-first failure before implementation: its focused test initially failed because `foundation-validation.mjs` did not exist, then passed 3/3 after implementation. It rejects result-bearing benchmark profiles with undeclared physical-device facts and rejects an unpinned worker base image.

## In-app browser result

The built-in Codex In-app browser loaded `http://127.0.0.1:3000/` from the local Next.js development server.

- Accessible structure exposed one level-one heading, one level-two demo heading, a named primary button and a named commissioned-modules list.
- The rendered page showed distinct text-labelled Building and Timber Pest modules without a combined score or traffic-light signal.
- At a 320 by 720 viewport, document `scrollWidth` equalled `clientWidth` (320 pixels), `horizontalOverflow` was false and the primary button measured 61 pixels high.
- Browser console inspection returned no warnings or errors.
- This is local shell proof only. It is not the U3/U9 Playwright journey suite, a public URL check or recipient comprehension evidence.

## Remaining U1 external evidence

The physical Build Week iPhone native-storage oracle remains pending. A simulator, TypeScript bundle or `close`/`rename` API is not accepted as durable-storage proof. U4 stays blocked until the exact development-build oracle in `docs/validation/native-storage-spike.md` is run and its predeclared device/workload facts are recorded.
