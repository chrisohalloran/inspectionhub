# Revenue Activation validator

This directory implements the U12 release-evidence contract. It validates
evidence; it does not deploy, change DNS, enable provider egress, contact a
customer, create an API key, or turn a synthetic run into production proof.

## Outcomes and exit codes

- Exit `0`: the release candidate has a checksummed `complete` manifest.
- Exit `4`: the input is structurally valid but one or more release proofs are
  unproven, failed, skipped or below threshold.
- Exit `2`: the input, artifact, contract or claimed evidence is invalid.

The default command intentionally exits `4` and writes a blocked manifest:

```sh
node scripts/release-validate/run.mjs
```

Generate an evidence-input template, preserving the completed Build Week
manifest by reference and checksum:

```sh
node scripts/release-validate/create-evidence-input.mjs \
  --build-week-manifest artifacts/validation/<build-week-run>/manifest.json \
  > artifacts/validation/revenue-activation-evidence.json
```

After named observers have populated that file from authorised production
work, validate it:

```sh
node scripts/release-validate/run.mjs \
  --evidence artifacts/validation/revenue-activation-evidence.json
```

`--no-artifact-verification` exists only for validator unit tests. It always
blocks completion.

## Evidence rules

Every evidence record must:

1. be observed in the production evidence window;
2. bind the exact release UUID and immutable commit SHA;
3. contain no customer data or secrets;
4. reference one or more files below `artifacts/validation/` by relative path,
   byte length, media type and SHA-256;
5. survive local readback of those bytes and hashes; and
6. satisfy its kind-specific assertions.

The validator rejects missing or duplicate rubric/gate IDs, unsupported N/A
claims, evidence-free passes, stale release bindings, symlinks, path escapes,
unreadable/tampered artifacts, incomplete samples and unresolved P0/P1
findings. Declaring an artifact redacted is not enough: manifest fields and
text/JSON artifacts are also scanned for customer/contact fields and common
credential forms. The output manifest is itself SHA-256 bound to a canonical
JSON payload and is written with create-only semantics.

## Fixed release contract

- The plan's 29 atomic checks remain a fixed 100-point rubric.
- Revenue Activation has no N/A allowance.
- Completion requires at least 90/100, at least 70% in every area, every
  atomic must-pass and all 19 production gates.
- The exact required production-domain and alias set is versioned in
  `production-domains.json`.
- Live Stripe, Google Calendar, Resend and OpenAI results must include observed
  idempotency and failure/unknown reconciliation.
- TOTP/AAL2/recent-auth, bounded sessions, device/session/grant revocation and
  secret rotation/emergency revocation require separate observed records.
- Human evidence uses one predeclared census covering at least three inspector
  jobs, five recipients and five clients. Undeclared or omitted sessions fail.
- Restore proof must be measured in an isolated no-egress environment and pass
  every reconciliation check without resurrecting access, data, sessions,
  current pointers or side effects.
- iPhone 12-or-slower and Pixel 6-or-slower support-floor records must pass the
  same local-durability oracle and complete field journey.

## First paid booking

Software release validation and commercial validation are deliberately
separate. A release may be technically complete while
`commercialOutcome.status` remains `awaiting_first_paid_booking`. A
`revenue_activation.first_paid_booking.observed` event is emitted only when one
checksummed, redacted record proves a legitimate customer, a live paid state,
confirmed booking state, positive AUD amount and provider/funnel/authority
references. Synthetic bookings and provider screenshots cannot satisfy it.

## Tests

```sh
node --test scripts/release-validate/validation.test.mjs
```

The passing unit-test fixture proves the validator can distinguish a complete
evidence set from a blocked one. It is not production evidence and is deleted
after each test.
