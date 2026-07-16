# Devpost submission preflight

This fail-closed gate covers only the current official OpenAI Build Week
submission contract. It does not replace or weaken
`pnpm milestone:build-week`, which remains the stricter internal product
validation gate.

Run a truthful blocked preflight:

```bash
pnpm milestone:submission
```

Evaluate observed evidence:

```bash
pnpm milestone:submission -- \
  --evidence artifacts/validation/<run-id>/submission-evidence.json \
  --output artifacts/validation/<run-id>/submission-manifest.json
```

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
