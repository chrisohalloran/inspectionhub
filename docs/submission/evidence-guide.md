# Internal product-validation evidence collection guide

This guide supports `pnpm milestone:build-week`, the internal product-quality
gate. The smaller official Devpost preflight is documented in
`scripts/submission-readiness/README.md`. Physical-device, human-session and
accessibility observations below improve product confidence but do not block an
otherwise compliant Devpost submission.

The milestone result is computed from observed evidence. Do not edit an output
manifest to change its outcome; create a new input and run the validator.

## Artifact rules

1. Save raw logs, screenshots, recordings, probes and review reports beneath a
   unique `artifacts/validation/<run-id>/` directory.
2. Record the observer, exact UTC observation time, bounded claim, relative
   artifact path and lowercase SHA-256.
3. Do not place media, transcript, report prose, names, email addresses, street
   addresses, tokens or secrets in the manifest.
4. Use pseudonymous participant hashes for human sessions. Keep consent and
   contact records outside the submission artifact store.
5. Record provider/test mode literally. A fake adapter result cannot prove a
   live provider.
6. Never reuse a Build Week output path. The validator writes with exclusive
   creation and a later Revenue Activation run must reference, not overwrite,
   Build Week evidence.

## Required observed groups

- One licensed-inspector session on the physical Build Week iPhone covering the
  full synthetic combined inspection and airplane-mode termination/recovery.
- Two non-expert recipient 30-second overview/explanation sessions.
- Two representative client fake/test quote-to-access sessions.
- One moderated assistive-technology session or named specialist audit of the
  complete critical demo journeys with no blocking finding.
- One public HTTPS demo probe from logged out, including final URL, status,
  title, expected product text, named-recipient auth, exact module/version
  capability, private-media denial and post-revocation denial.
- Logged-out public checks for the video, repository and submission
  description.
- Automated command artifacts for the fixed rubric and all must-pass gates.
- A document/code/security review with zero unresolved P0/P1.

## Result model

Every one of the 29 atomic IDs is `pass`, `fail`, `unproven` or, only where the
Build Week contract permits, `not_applicable`. Each pass must reference observed
evidence. Scoring is binary: zero or full points. N/A is capped at 10 points, a
must-pass can never be N/A, total applicable score must be at least 90% and each
area at least 70%.

Run:

```bash
node scripts/milestone-build-week/create-evidence-input.mjs \
  > artifacts/validation/<run-id>/evidence-input.json

node scripts/milestone-build-week/run.mjs \
  --evidence artifacts/validation/<run-id>/evidence-input.json
```

Exit 0 and `build_week.milestone.completed` appear only after every requirement
is proven. Exit 4 is a valid, truthful blocked result. Exit 2 means the evidence
input itself is invalid.
