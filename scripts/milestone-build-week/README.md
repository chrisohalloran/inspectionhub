# Build Week milestone validator

This validator derives `blocked` or `complete`; callers cannot choose the
outcome. With no evidence input it writes a truthful blocked manifest and exits
with status 4. A completion event is emitted only when:

- all 29 fixed atomic IDs in the 100-point rubric are present, unique and meet
  the 90% threshold;
- every area is at least 70%, every atomic must-pass and all six milestone
  gates pass;
- every passing result links to an observed, checksum-verified local artifact;
- the physical iPhone journey, two recipient sessions, two client sessions,
  accessibility audit, public HTTPS demo and logged-out public submission
  assets are observed;
- no unresolved P0/P1 exists and the run names an immutable commit;
- all 17 U12 boundaries are explicitly `unproven` or separately evidenced.

Create a blocked manifest:

```bash
node scripts/milestone-build-week/run.mjs
```

Evaluate collected evidence:

```bash
node scripts/milestone-build-week/create-evidence-input.mjs \
  > artifacts/validation/<run-id>/evidence-input.json

node scripts/milestone-build-week/run.mjs \
  --evidence artifacts/validation/<run-id>/evidence-input.json
```

Do not use `--no-artifact-verification` outside focused validator tests. It
does not make a manifest complete when evidence is missing, but bypassing
checksum readback removes an important authenticity check.
