# Build Week milestone validator

This validator derives `blocked` or `complete`; callers cannot choose the
outcome. With no evidence input it writes a truthful blocked manifest and exits
with status 4. A completion event is emitted only when:

- all 29 fixed atomic IDs in the 100-point rubric are present, unique and meet
  the 90% threshold;
- every area is at least 70%, every atomic must-pass and all six milestone
  gates pass;
- every passing result links to an observed, checksum-verified local artifact;
- the AI must-pass gate parses a strict
  [`agent-release-eval.schema.json`](./agent-release-eval.schema.json) artifact
  instead of trusting booleans in the evidence envelope; the artifact must bind
  the exact commit, model, prompt and skill versions, fixed three-trial protocol,
  protected-corpus digest, exact development and protected-holdout case IDs,
  blinded holdout adjudicator identity hash and all 120 architecture/trial result
  and adjudication evidence hashes to the milestone run. The validator derives
  split outcomes and release eligibility from those trial records and rejects
  mismatched aggregate claims;
- every evidence record names the exact `run.commitSha`; physical-device proof
  additionally names the installed app commit and review proof names the
  reviewed commit, with both required to match the run exactly;
- the physical iPhone journey, two recipient sessions, two client sessions,
  accessibility audit, public HTTPS demo and logged-out public submission
  assets are observed;
- no unresolved P0/P1 exists and the run names an immutable commit;
- all 17 U12 boundaries are explicitly `unproven` or separately evidenced.

New evidence files use `build-week-evidence-input-v2`. The historical v1
contract remains available as `evidence-input-v1.schema.json`; ingestion only
derives missing record commit bindings from a clean runtime at the exact run
commit. A missing historical skill-version list is represented as the
schema-valid empty list while remaining an explicit migration blocker; missing
physical app commits or reviewed commits also stay blocked because they cannot
be inferred safely.

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
collector fails instead of relabelling either record when its recorded commit
does not exactly match the current run commit. Refresh both observations after
the final code change before collecting them.

The review's local/simulator green-gate list remains bounded summary context: the
collector does not emit `automated_run` records without raw command artifacts.
It deliberately leaves all rubric items and must-pass gates `unproven`; it
cannot stand in for physical-iPhone, public-demo, human-session, accessibility,
live-model, video or submission-description evidence.

An `automated_run` with `details.suite: "agent_eval"` may record only command
metadata in `details`. Fields such as `liveModel`, `developmentPassed`,
`lockedHoldoutPassed`, `criticalFailures` and `releaseEligible` are rejected
there. Those claims count only after the referenced artifact passes checksum
readback, strict JSON parsing and release binding. No qualifying artifact is
committed today, so the current milestone remains blocked.

Do not use `--no-artifact-verification` outside focused validator tests. It
does not make a manifest complete when evidence is missing, but bypassing
checksum readback removes an important authenticity check.
