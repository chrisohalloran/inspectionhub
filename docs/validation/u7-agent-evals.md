# U7 planner, verifier and evaluation validation

**Validated:** 2026-07-17
**Scope:** local deterministic and synthetic evaluation slice
**Live model status:** not run; `OPENAI_API_KEY` is not configured in this workspace

## Implemented

- Strict structured schemas for packet-bound clause provenance, qualifications, inspector-attributed classifications, separate Building and Timber Pest module drafts, explicit no-finding state and exact verifier results.
- Hash-chained, append-only safe agent events for run/attempt, packet, skill, model, draft, deterministic guard, verifier, supersession, failure, completion and manual fallback transitions.
- A packet-bound evidence reader that rejects wrong-tenant, wrong-hash, unselected and unknown sources and exposes no booking, approval, recipient, delivery, payment, calendar or email tool.
- An allowlisted lazy skill registry with exact version pins, module compatibility and verified-source gating, plus concise Building, Timber Pest and report-language skills.
- A thin Responses structured-output adapter and planner-led Agents SDK adapter using GPT-5.6, low reasoning and `store: false`. The SDK runner disables tracing and excludes sensitive trace payloads.
- `gpt-4o-transcribe` request policy with `en` language guidance for Australian inspection notes, JSON token log probabilities and whole-note provenance. The code does not claim word timestamps that this request mode does not return.
- An application-owned durable runner with frozen packet checks, six-turn/time/cost budgets, compare-and-set provisional writes, exact skill/model/prompt pins, deterministic guards, a separate read-only verifier, exact draft/packet hashes, checkpoint recovery, stale-run rejection and explicit manual fallback.
- Independently worded candidate requirement matrices. Both remain `draft_unverified`; the Timber Pest matrix explicitly requires an authorised current standard review and licensed sign-off.
- Thirty de-identified, versioned case manifests: 20 development and 10 holdout-labelled fixtures. Exactly ten development cases are pinned to the planner-versus-thin comparison, and every critical case requires three fixed trials. The committed holdout-labelled outcomes are exposed and therefore cannot satisfy a blinded promotion gate; a licensed independent reviewer must replace/adjudicate a protected set before promotion.
- A live-comparison runner and predeclared architecture selection function. Its ten model inputs are stored separately from required-fact, forbidden-claim, inspector-decision and verifier scoring fields.
- The ten fixed development trials declare typed photo, voice-transcript, manual-note and measurement inputs plus executable required-fact, forbidden-claim, decision-authority and verifier oracles. Semantic prohibited claims are evaluated separately from operational error/status codes so a system code cannot create a false quality pass or failure.
- The runner prepares every case through the same branded `PreparedAiRequest` boundary as production. `pnpm test:eval` always executes this preflight, so an undeclared OpenAI dependency, raw-packet model call, malformed packet identity or scoring-oracle key in the prepared payload fails before any paid call.
- Development comparison artifacts identify themselves as development-only and always emit `lockedHoldoutPassed: false` and `releaseEligible: false`. No architecture or release result is selected without recorded live evidence.
- The Build Week AI gate no longer trusts caller-authored pass booleans or aggregate outcome claims. It requires a checksum-verified `inspectionhub.agent_release_eval` JSON artifact bound to the exact commit, model, prompt and skill versions, protected-corpus digest, exact development and protected-holdout identities, fixed three-trial protocol and immutable result/adjudication hashes for both architectures across all 120 trials. The validator recomputes split outcomes and release eligibility, rejects the exposed `H01`-`H10` fixtures as blinded evidence, and requires a blinded adjudicator identity hash. No such artifact has been created, so this hardening does not promote the current milestone.

## Executed evidence

`pnpm --filter @inspection/agent typecheck`

- Passed.

`pnpm --filter @inspection/agent lint`

- Passed.

`pnpm test:eval`

- Passed 5 files and 51 tests.
- Covers clean and adversarial drafting, transaction/cost/legal/guarantee advice, taxonomy leakage, autonomous classification, unauthorized provenance, unbounded Timber Pest absence language, context parity, skill allowlisting, schema integrity, exact persistence, deterministic/verifier checkpoints, worst-trial selection, packet races and manual fallback.
- Prepared all ten development comparison cases as `prepared-ai-request-v2` and confirmed the scoring oracle was absent from each model payload. The preflight explicitly reported `lockedHoldoutEvaluated: false` and `releaseEligible: false`.

`env -u OPENAI_API_KEY REQUIRE_LIVE_MODEL_EVAL=1 node scripts/verification/run-agent-evals.mjs`

- Deterministic slice passed first.
- Then failed closed with exit code 5: `Live model evaluation is required but OPENAI_API_KEY is not configured. Configure a project API key before an observed architecture verdict can be recorded.`

The live adapter was not called and no live latency, correction or cost result exists. The preflight is implementation proof, not model-quality or holdout evidence.

## Honest completion boundary

U7's deterministic implementation and development-comparison preflight are complete, but U7 is not accepted as a whole because the predeclared live ten-case comparison has not executed. Revenue Activation additionally requires licensed matrix/content sign-off, a genuinely blinded locked-holdout adjudication by a licensed inspector who did not author the promoted prompt, accepted live cost/privacy posture and broader regression evidence. The exposed holdout-labelled fixtures cannot be relabelled as that proof.
