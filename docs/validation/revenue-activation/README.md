# Revenue Activation validation status

**Current status: blocked — production evidence has not been supplied.**

The U12 software evidence gate is implemented under
`scripts/release-validate/`. Its adversarial fixture passes locally, but that
fixture is synthetic validator coverage, not proof that the product is ready
for a real customer.

## What remains externally unproven

| Boundary                   | Required observed proof                                                                                                           | Current evidence                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Build Week handoff         | Completed immutable Build Week manifest, read back and internally checksummed                                                     | Not supplied to U12                                                                     |
| Live providers             | Authorised live Stripe, Google Calendar, Resend and OpenAI results, including replay/failure/unknown reconciliation               | Not observed                                                                            |
| Worker production adapter  | Deployed durable Postgres/private-object-store worker accepts live mode                                                           | Not implemented in the current worker; it intentionally throws for `PROVIDER_MODE=live` |
| Privileged production auth | TOTP AAL2, recent step-up, idle/absolute bounds, session/device/grant revocation and alternate-device denial                      | Not observed on production identity infrastructure                                      |
| Service secrets            | Environment separation, least scope, managed-runtime confinement, dual-key/decrypt-only rotation, retirement and emergency revoke | Not observed                                                                            |
| Professional review        | Licensed-inspector review of both matrices, report/agreement content and credentials; privacy/terms/business-identity approval    | Not recorded                                                                            |
| Full human sample          | Three complete inspector jobs, five non-expert recipients, five clients, one locked no-exclusion census                           | Not run                                                                                 |
| Restore                    | Measured RPO/RTO in isolated no-egress restore with all eight reconciliation checks and zero resurrection/repeat                  | Not run                                                                                 |
| Device floors              | iPhone 12-or-slower physical run and Pixel 6-or-slower physical/managed-cloud run through the full durability oracle              | Not run                                                                                 |
| Accessibility floor        | Complete web, iOS and Android journeys with assistive technology and no blocking finding                                          | Not run                                                                                 |
| Canonical production URLs  | Logged-out HTTPS/content/auth/private-media proof and screenshots for every canonical and alias host                              | Not deployed or observed                                                                |
| First paid booking         | One legitimate live paid and confirmed booking, recorded without customer data                                                    | Awaiting a customer; not a software-completion gate                                     |

No row in this table may be changed to “proved” from a local build, platform
dashboard, DNS record alone, deterministic provider fake, synthetic unit test,
or reviewer assertion without the linked artifact bytes.

## Canonical and alias contract

The source-controlled host matrix is
`scripts/release-validate/production-domains.json`. It requires direct HTTPS
content for:

- `inspectionhub.co`
- `seeitinspections.com.au`
- `buildingpestinspectiongoldcoast.com.au`

It also requires observed HTTPS redirect/content proof for their `www` forms
and the owned legacy domains:

- `buildinginspectiongoldcoast.com` and `.com.au`
- `buildingpestinspectiongoldcoast.com`
- `houseinspect.co`
- `seeitinspections.com`

Every apex and `www` alias is tested with the same query-bearing probe path.
The final URL must preserve that path/query, return the intended branded
content, keep private report identifiers absent, enforce the logged-out auth
boundary and provide a checksummed screenshot plus HTTP observation.

## Evidence capture workflow

1. Freeze one immutable commit and assign one release UUID.
2. Record exact Vercel deployment, Fly deployment, iOS build and Android build
   identifiers in the input.
3. Set a release evidence window broad enough to contain every named
   observation; do not move its start after seeing failures.
4. Copy only redacted, non-sensitive result files into one new
   `artifacts/validation/<run-id>/` directory. Keep raw sensitive media in the
   authorised artifact store and reference only hashes/opaque IDs.
5. Record failed human sessions and provider outcomes as well as successes.
   The validator requires one predeclared human census and literal provider
   states.
6. Run every stable release command against the frozen commit and link its
   exit-zero log artifact.
7. Populate all 29 rubric results and all 19 must-pass gates with observed
   evidence IDs. Revenue Activation cannot use `not_applicable`.
8. Run `node scripts/release-validate/run.mjs --evidence <path>` and preserve
   the create-only output manifest.
9. Independently recompute artifact and manifest hashes before user approval.

## Current local validator evidence

Focused command:

```text
node --test scripts/release-validate/validation.test.mjs
```

The test suite covers a fully populated contract, default blocked output,
artifact tampering, artifact-verification bypass, N/A rejection, evidence-free
passes, incomplete provider reconciliation, human-sample omission, restore
egress/resurrection, missing aliases/query drift and the separate first-paid
commercial event. The exact observed result belongs in the parent goal's final
verification run; it does not replace the external rows above.
