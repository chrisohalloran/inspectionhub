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

Snapshot the already-recorded logged-out repository check and parallel
model-assisted review into a checksum-backed input:

```bash
run_id="build-week-observed-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "artifacts/validation/$run_id"
node scripts/milestone-build-week/create-evidence-input.mjs \
  --observed-local \
  --artifact-directory "artifacts/validation/$run_id" \
  > "artifacts/validation/$run_id/evidence-input.json"
node scripts/milestone-build-week/run.mjs \
  --evidence "artifacts/validation/$run_id/evidence-input.json" \
  --output "artifacts/validation/$run_id/manifest.json"
```

This opt-in collector copies the exact observation records before hashing
them. It records the repository and separate Codex review as observed. The
review's local/simulator green-gate list remains bounded summary context: the
collector does not emit `automated_run` records without raw command artifacts.
It deliberately leaves all rubric items and must-pass gates `unproven`; it
cannot stand in for physical-iPhone, public-demo, human-session, accessibility,
live-model, video or submission-description evidence.

Do not use `--no-artifact-verification` outside focused validator tests. It
does not make a manifest complete when evidence is missing, but bypassing
checksum readback removes an important authenticity check.
