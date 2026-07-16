# Agent runtime selection

**Status:** Decision pending observed comparison
**Date:** 2026-07-15
**Owner:** Product engineering

## Decision boundary

The application-owned runner and its authority boundary are selected. The inner model loop is not yet selected.

Both candidates now implement the same frozen-packet drafting contract:

- A planner-led OpenAI Agents SDK candidate with one planner, two narrow packet/skill tools, structured output, six-turn maximum, Responses API transport, `store: false`, disabled tracing and sensitive trace data excluded.
- A thin OpenAI Responses structured-output baseline with the complete authorised packet context supplied deterministically, `store: false` and the same draft schema.

The runner—not either model—owns time/cost limits, packet currency checks, compare-and-set provisional persistence, deterministic guards, verifier invocation, verdict persistence, crash recovery and manual fallback. Neither model can classify authoritatively, approve, manage recipients, send, book, charge or call provider-side-effect tools.

## Predeclared selection rule

The Agents SDK candidate is selected only if both candidates have zero critical failures over the same ten development cases and the planner produces at least 20% fewer inspector text-correction or missing-field interventions without exceeding twice the baseline p95 latency or cost. Any failed condition selects the thin baseline. A critical failure in either candidate blocks promotion entirely until corrected and rerun.

The executable rule is in `packages/agent/src/evaluation.ts`. It fails on the worst fixed trial rather than averaging a critical failure away.

## Current evidence

- The deterministic development gate passes 31 tests covering authority, provenance, qualification, module separation, privacy, architecture thresholds, exact packet/draft verification, crash replay, races, stale results and a 30-case corpus contract.
- The live ten-case, three-trial comparison runner is implemented at `evals/inspection-drafting/run-live-comparison.mjs` and records observed latency, token cost, interventions, critical failures, drafts and the resulting decision in an ignored evaluation artifact.
- The live comparison has not run. The secure OpenAI Platform key setup connector returned `This app connection requires reauthentication before other actions on this app can succeed.` No key was created or exposed, and no model metrics or architecture verdict have been fabricated.
- `REQUIRE_LIVE_MODEL_EVAL=1 pnpm test:eval` fails closed with exit code 5 while `OPENAI_API_KEY` is absent.

The current GPT-5.6 alias, capability and standard pricing pins were checked against the [official OpenAI model catalog](https://developers.openai.com/api/docs/models) on 2026-07-15: `gpt-5.6` routes to GPT-5.6 Sol, with standard text pricing of USD 5 per million input tokens and USD 30 per million output tokens. These pins must be refreshed before a later promotion if the catalog changes.

## Promotion procedure

1. Reauthenticate the OpenAI Platform connector and create a project-scoped server key without displaying it in logs or repository files.
2. Run `REQUIRE_LIVE_MODEL_EVAL=1 pnpm test:eval` with the key present only in the process environment.
3. Inspect the generated artifact, confirm both candidates have zero critical failures and verify cost/latency calculations.
4. Apply the deterministic decision to `release-config.json`, pin the observed evidence artifact checksum, and rerun the full development corpus.
5. Keep holdout cases unavailable to prompt iteration; a licensed inspector who did not author the promoted prompt adjudicates the holdout before Revenue Activation.
