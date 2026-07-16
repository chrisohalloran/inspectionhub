# U7 planner, verifier and evaluation validation

**Validated:** 2026-07-15
**Scope:** local deterministic and synthetic evaluation slice
**Live model status:** blocked by OpenAI Platform connector reauthentication

## Implemented

- Strict structured schemas for packet-bound clause provenance, qualifications, inspector-attributed classifications, separate Building and Timber Pest module drafts, explicit no-finding state and exact verifier results.
- Hash-chained, append-only safe agent events for run/attempt, packet, skill, model, draft, deterministic guard, verifier, supersession, failure, completion and manual fallback transitions.
- A packet-bound evidence reader that rejects wrong-tenant, wrong-hash, unselected and unknown sources and exposes no booking, approval, recipient, delivery, payment, calendar or email tool.
- An allowlisted lazy skill registry with exact version pins, module compatibility and verified-source gating, plus concise Building, Timber Pest and report-language skills.
- A thin Responses structured-output adapter and planner-led Agents SDK adapter using GPT-5.6, low reasoning and `store: false`. The SDK runner disables tracing and excludes sensitive trace payloads.
- `gpt-4o-transcribe` request policy with `en` language guidance for Australian inspection notes, JSON token log probabilities and whole-note provenance. The code does not claim word timestamps that this request mode does not return.
- An application-owned durable runner with frozen packet checks, six-turn/time/cost budgets, compare-and-set provisional writes, exact skill/model/prompt pins, deterministic guards, a separate read-only verifier, exact draft/packet hashes, checkpoint recovery, stale-run rejection and explicit manual fallback.
- Independently worded candidate requirement matrices. Both remain `draft_unverified`; the Timber Pest matrix explicitly requires an authorised current standard review and licensed sign-off.
- Thirty de-identified, versioned case manifests: 20 development and 10 locked holdout. Exactly ten development cases are pinned to the planner-versus-thin comparison, and every critical case requires three fixed trials.
- An observed live-comparison runner and predeclared architecture selection function. No architecture is selected without recorded live evidence.

## Executed evidence

`pnpm --filter @inspection/agent typecheck`

- Passed.

`pnpm --filter @inspection/agent lint`

- Passed.

`pnpm test:eval`

- Passed 3 files and 31 tests.
- Covers clean and adversarial drafting, transaction/cost/legal/guarantee advice, taxonomy leakage, autonomous classification, unauthorized provenance, unbounded Timber Pest absence language, context parity, skill allowlisting, schema integrity, exact persistence, deterministic/verifier checkpoints, worst-trial selection, packet races and manual fallback.

`REQUIRE_LIVE_MODEL_EVAL=1 pnpm test:eval`

- Deterministic slice passed first.
- Then failed closed with exit code 5: `Live model evaluation is required but OPENAI_API_KEY is absent. The OpenAI Platform connector must be reauthenticated before an observed architecture verdict can be recorded.`

The live adapter was not called and no live latency, correction or cost result exists.

## Honest completion boundary

U7's implementation and deterministic gate are complete, but U7 is not accepted as a whole because the predeclared live ten-case comparison has not executed. Revenue Activation additionally requires licensed matrix/content sign-off, a locked-holdout adjudication by a licensed inspector who did not author the prompt, accepted live cost/privacy posture and broader regression evidence.
