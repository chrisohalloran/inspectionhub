import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { canonicalJson, seedDocument } from "../demo-seed/generate.mjs";
import {
  defaultEvidenceInput,
  loadContracts,
  migrateEvidenceInput,
  validateAndBuildManifest,
} from "./validation.mjs";

const fixedNow = "2026-07-15T03:00:00.000Z";
const fixedCommitSha = "a".repeat(40);
const seed = seedDocument();

function clone(value) {
  return structuredClone(value);
}

async function fixture() {
  const contracts = await loadContracts();
  const input = defaultEvidenceInput({
    now: fixedNow,
    commitSha: fixedCommitSha,
    seedSha256: seed.integrity.canonicalPayloadSha256,
  });
  return { contracts, input };
}

test("the synthetic golden path has a stable checksum and no real-world claims", () => {
  assert.equal(
    seed.integrity.canonicalPayloadSha256,
    "b72db1cd929e2d99c6c5e0c574b24907551f1d8503e92d17541e2f42ba718dd1",
  );
  assert.equal(seed.classification, "synthetic_deidentified");
  assert.equal(seed.declarations.containsRealCustomerData, false);
  assert.equal(seed.declarations.provesProfessionalCredential, false);
  assert.equal(seed.declarations.provesStandardsCompliance, false);
  assert.equal(seed.declarations.usesLiveProviders, false);
  assert.deepEqual(seed.booking.modules, ["building", "timber_pest"]);
  assert.equal(
    seed.evidence.some((item) => item.linkedToFinding === false),
    true,
  );
});

test("the immutable 100-point rubric has every atomic id exactly once", async () => {
  const { rubric } = await loadContracts();
  assert.equal(rubric.items.length, 29);
  assert.equal(new Set(rubric.items.map((item) => item.id)).size, 29);
  assert.equal(
    rubric.items.reduce((sum, item) => sum + item.points, 0),
    100,
  );
  assert.deepEqual(
    Object.fromEntries(
      [...new Set(rubric.items.map((item) => item.area))].map((area) => [
        area,
        rubric.items
          .filter((item) => item.area === area)
          .reduce((sum, item) => sum + item.points, 0),
      ]),
    ),
    {
      evidence_integrity: 25,
      inspector_efficiency: 20,
      ai_control: 20,
      recipient_integrity: 15,
      accessibility: 10,
      security_operations: 10,
    },
  );
  assert.deepEqual(
    rubric.items.map((item) => item.id),
    [
      "EI1",
      "EI2",
      "EI3",
      "EI4",
      "EI5",
      "IF1",
      "IF2",
      "IF3",
      "IF4",
      "IF5",
      "AI1",
      "AI2",
      "AI3",
      "AI4",
      "AI5",
      "RC1",
      "RC2",
      "RC3",
      "RC4",
      "RC5",
      "AC1",
      "AC2",
      "AC3",
      "AC4",
      "SO1",
      "SO2",
      "SO3",
      "SO4",
      "SO5",
    ],
  );
});

test("no evidence emits a truthful blocked manifest with every U12 boundary unproven", async () => {
  const { contracts, input } = await fixture();
  const result = await validateAndBuildManifest(input, contracts, {
    expectedSeedSha256: seed.integrity.canonicalPayloadSha256,
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, true);
  assert.equal(result.complete, false);
  assert.equal(result.manifest.outcome, "blocked");
  assert.equal(result.manifest.completionEvent, null);
  assert.equal(result.manifest.rubric.percent, 0);
  assert.equal(result.manifest.rubric.results.length, 29);
  assert.equal(result.manifest.mustPassGates.length, 6);
  assert.equal(result.manifest.deferredBoundaries.length, 17);
  assert.equal(
    result.manifest.deferredBoundaries.every(
      (item) => item.status === "unproven",
    ),
    true,
  );
  assert.equal(
    result.manifest.blockers.includes(
      "physical_iphone_golden_and_recovery_path_unproven",
    ),
    true,
  );
  assert.equal(
    result.manifest.blockers.includes(
      "public_demo_https_and_recipient_security_unproven",
    ),
    true,
  );
  const {
    integrity,
    completionEvent: _completionEvent,
    ...payload
  } = result.manifest;
  assert.equal(
    integrity.canonicalPayloadSha256,
    createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  );
});

test("missing and duplicate atomic ids are rejected", async () => {
  const { contracts, input } = await fixture();
  input.rubricResults.pop();
  input.rubricResults.push(clone(input.rubricResults[0]));
  const result = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /Duplicate rubric id: EI1/u,
  );
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /Missing rubric id: SO5/u,
  );
});

test("the not-applicable cap and allowlist fail closed", async () => {
  const { contracts, input } = await fixture();
  const so4 = input.rubricResults.find((item) => item.id === "SO4");
  so4.status = "not_applicable";
  so4.reason =
    "Production lifecycle and measured restore remain a Revenue Activation boundary.";
  const strictContracts = {
    ...contracts,
    rubric: { ...contracts.rubric, maximumNotApplicablePoints: 1 },
  };
  const result = await validateAndBuildManifest(input, strictContracts, {
    verifyArtifacts: false,
  });
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /not_applicable points 2 exceed cap 1/u,
  );

  const ei1 = input.rubricResults.find((item) => item.id === "EI1");
  ei1.status = "not_applicable";
  ei1.reason =
    "This is deliberately invalid because Build Week evidence integrity cannot be deferred.";
  const mustPassResult = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });
  assert.match(
    mustPassResult.manifest.validationErrors.join("\n"),
    /Must-pass rubric EI1 cannot be not_applicable/u,
  );
  assert.match(
    mustPassResult.manifest.validationErrors.join("\n"),
    /EI1 is not eligible/u,
  );
});

test("a pass cannot be asserted without observed, checksum-backed evidence", async () => {
  const { contracts, input } = await fixture();
  const ei1 = input.rubricResults.find((item) => item.id === "EI1");
  ei1.status = "pass";
  const noEvidence = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });
  assert.match(
    noEvidence.manifest.validationErrors.join("\n"),
    /Rubric EI1 cannot pass without observed evidence/u,
  );

  input.evidence.push({
    id: "fabricated-physical",
    kind: "physical_device",
    commitSha: fixedCommitSha,
    claim: "A fabricated test claim must never become Build Week proof.",
    provenance: {
      mode: "test_fixture",
      observer: "unit test",
      observedAt: fixedNow,
    },
    artifact: {
      path: "artifacts/validation/fake/device.json",
      sha256: "a".repeat(64),
    },
    details: {
      platform: "ios",
      isPhysical: true,
      syntheticData: true,
      inspectorRole: "licensed_inspector",
      appCommitSha: fixedCommitSha,
      paths: ["complete_inspection", "offline_termination_recovery"],
    },
  });
  ei1.evidenceIds = ["fabricated-physical"];
  const fabricated = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });
  assert.equal(fabricated.complete, false);
  assert.match(
    fabricated.manifest.validationErrors.join("\n"),
    /is not observed evidence/u,
  );
});

test("the AI must-pass gate rejects deterministic-only or missing holdout evidence", async () => {
  const { contracts, input } = await fixture();
  input.evidence.push({
    id: "deterministic-agent-eval",
    kind: "automated_run",
    commitSha: fixedCommitSha,
    claim:
      "Only deterministic agent tests passed; no live model comparison ran.",
    provenance: {
      mode: "observed",
      observer: "CI runner",
      observedAt: fixedNow,
    },
    artifact: {
      path: "artifacts/validation/unit-test/agent-eval.json",
      sha256: "d".repeat(64),
    },
    details: {
      suite: "agent_eval",
      command: "pnpm test:eval",
      exitCode: 0,
      liveModel: false,
      developmentPassed: true,
      lockedHoldoutPassed: false,
      criticalFailures: 0,
    },
  });
  const gate = input.mustPassGates.find(
    (item) => item.id === "ai_safety_and_authority",
  );
  gate.status = "pass";
  gate.evidenceIds = ["deterministic-agent-eval"];
  const result = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });
  assert.equal(result.complete, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /cannot self-assert release-eval outcomes/u,
  );
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /requires a typed, checksum-verified, release-bound development and locked-holdout eval/u,
  );
});

test("caller booleans plus an arbitrary checksum-backed artifact cannot pass the AI gate", async (t) => {
  const { contracts, input } = await fixture();
  configureAgentEvalRun(input);
  const artifactDirectory = await agentEvalArtifactDirectory(t);
  await addAgentEvalEvidence(
    input,
    artifactDirectory,
    "arbitrary.json",
    { status: "passed", note: "This is not a release-eval artifact." },
    {
      liveModel: true,
      developmentPassed: true,
      lockedHoldoutPassed: true,
      criticalFailures: 0,
      releaseEligible: true,
    },
  );
  passAgentEvalGate(input);

  const result = await validateAndBuildManifest(input, contracts);
  const errors = result.manifest.validationErrors.join("\n");

  assert.equal(result.valid, false);
  assert.equal(result.complete, false);
  assert.match(errors, /cannot self-assert release-eval outcomes/u);
  assert.match(errors, /release-eval artifact root must contain exactly/u);
  assert.match(
    errors,
    /requires a typed, checksum-verified, release-bound development and locked-holdout eval/u,
  );
});

test("the AI gate accepts only a typed release-eval artifact bound to this run", async (t) => {
  const { contracts, input } = await fixture();
  configureAgentEvalRun(input);
  const artifactDirectory = await agentEvalArtifactDirectory(t);
  await addAgentEvalEvidence(
    input,
    artifactDirectory,
    "bound-release-eval.json",
    validAgentReleaseEval(),
  );
  passAgentEvalGate(input);

  const result = await validateAndBuildManifest(input, contracts);

  assert.equal(result.valid, true);
  assert.equal(result.complete, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("ai_safety_and_authority"),
    ),
    false,
  );
});

test("the typed release-eval parser rejects unbound protocol and outcome claims", async (t) => {
  const cases = [
    {
      name: "commit",
      mutate: (artifact) => {
        artifact.releaseBinding.commitSha = "b".repeat(40);
      },
      expected: /releaseBinding\.commitSha must match/u,
    },
    {
      name: "model",
      mutate: (artifact) => {
        artifact.releaseBinding.model = "different-model";
      },
      expected: /releaseBinding\.model must exactly match/u,
    },
    {
      name: "prompt",
      mutate: (artifact) => {
        artifact.releaseBinding.promptVersions = ["different-prompt"];
      },
      expected: /releaseBinding\.promptVersions must exactly match/u,
    },
    {
      name: "skill",
      mutate: (artifact) => {
        artifact.releaseBinding.skillVersions = ["different-skill"];
      },
      expected: /releaseBinding\.skillVersions must exactly match/u,
    },
    {
      name: "fixed-trials",
      mutate: (artifact) => {
        artifact.protocol.fixedTrialsPerCase = 2;
      },
      expected: /protocol\.fixedTrialsPerCase must be 3/u,
    },
    {
      name: "protected-corpus",
      mutate: (artifact) => {
        artifact.corpus.protectedCorpusSha256 = "not-a-hash";
      },
      expected:
        /corpus\.protectedCorpusSha256 must be a lowercase SHA-256 hash/u,
    },
    {
      name: "development-case-identity",
      mutate: (artifact) => {
        artifact.corpus.developmentCaseIds[0] = "D99";
      },
      expected: /corpus\.developmentCaseIds must exactly match/u,
    },
    {
      name: "exposed-holdout-identity",
      mutate: (artifact) => {
        const protectedCaseId = artifact.corpus.lockedHoldoutCaseIds[0];
        artifact.corpus.lockedHoldoutCaseIds[0] = "H01";
        for (const trialResult of artifact.trialResults) {
          if (trialResult.caseId === protectedCaseId) {
            trialResult.caseId = "H01";
          }
        }
      },
      expected: /cannot use the exposed holdout-labelled fixtures/u,
    },
    {
      name: "missing-trial-result",
      mutate: (artifact) => {
        artifact.trialResults.pop();
      },
      expected: /trialResults must contain exactly 120 records/u,
    },
    {
      name: "duplicate-trial-result",
      mutate: (artifact) => {
        artifact.trialResults[1] = structuredClone(artifact.trialResults[0]);
      },
      expected: /Duplicate release-eval trial/u,
    },
    {
      name: "result-evidence",
      mutate: (artifact) => {
        artifact.trialResults[0].result.outputSha256 = "not-a-hash";
      },
      expected: /result\.outputSha256 must be a lowercase SHA-256 hash/u,
    },
    {
      name: "adjudication-evidence",
      mutate: (artifact) => {
        artifact.trialResults[0].adjudication.evidenceSha256 = "not-a-hash";
      },
      expected:
        /adjudication\.evidenceSha256 must be a lowercase SHA-256 hash/u,
    },
    {
      name: "blinding",
      mutate: (artifact) => {
        artifact.adjudication.lockedHoldoutBlinded = false;
      },
      expected: /adjudication\.lockedHoldoutBlinded must be true/u,
    },
    {
      name: "adjudicator",
      mutate: (artifact) => {
        artifact.adjudication.adjudicatorIdentityHash = "not-a-hash";
      },
      expected:
        /adjudication\.adjudicatorIdentityHash must be a lowercase SHA-256 hash/u,
    },
    {
      name: "development-outcome",
      mutate: (artifact) => {
        artifact.outcomes.development.criticalFailures = 1;
      },
      expected: /requires a typed, checksum-verified, release-bound/u,
    },
    {
      name: "locked-holdout-outcome",
      mutate: (artifact) => {
        artifact.outcomes.lockedHoldout.passed = false;
      },
      expected: /requires a typed, checksum-verified, release-bound/u,
    },
    {
      name: "release-eligibility",
      mutate: (artifact) => {
        artifact.outcomes.releaseEligible = false;
      },
      expected: /requires a typed, checksum-verified, release-bound/u,
    },
  ];
  const artifactDirectory = await agentEvalArtifactDirectory(t);
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const { contracts, input } = await fixture();
      configureAgentEvalRun(input);
      const artifact = validAgentReleaseEval();
      testCase.mutate(artifact);
      await addAgentEvalEvidence(
        input,
        artifactDirectory,
        `${testCase.name}.json`,
        artifact,
      );
      passAgentEvalGate(input);

      const result = await validateAndBuildManifest(input, contracts);

      assert.equal(result.valid, false);
      assert.equal(result.complete, false);
      assert.match(
        result.manifest.validationErrors.join("\n"),
        testCase.expected,
      );
    });
  }
});

test("the AI gate recomputes release outcomes from immutable trial evidence", async (t) => {
  const { contracts, input } = await fixture();
  configureAgentEvalRun(input);
  const artifactDirectory = await agentEvalArtifactDirectory(t);
  const artifact = validAgentReleaseEval();
  artifact.trialResults[0].result.criticalFailures = 1;
  await addAgentEvalEvidence(
    input,
    artifactDirectory,
    "false-green-release-eval.json",
    artifact,
  );
  passAgentEvalGate(input);

  const result = await validateAndBuildManifest(input, contracts);
  const errors = result.manifest.validationErrors.join("\n");

  assert.equal(result.valid, false);
  assert.equal(result.complete, false);
  assert.match(
    errors,
    /outcomes\.development must equal the recomputed trial outcome/u,
  );
  assert.match(errors, /requires a typed, checksum-verified, release-bound/u);
});

test("distinct evidence ids cannot count the same human participant twice", async () => {
  const { contracts, input } = await fixture();
  const participantHash = "7".repeat(64);
  input.evidence.push(
    humanSession("recipient-session-one", "recipient", participantHash),
    humanSession("recipient-session-two", "recipient", participantHash),
  );

  const result = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });

  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /duplicates participant/u,
  );
  assert.equal(result.manifest.externalProof.observed.recipientSessions, 1);
  assert.equal(
    result.manifest.blockers.includes("two_recipient_sessions_unproven"),
    true,
  );
});

test("bypassing artifact readback can never emit a completion event", async () => {
  const { contracts, input } = await fixture();
  input.run.environmentType = "build_week_observed";
  input.run.commitSha = "a".repeat(40);
  const result = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });
  assert.equal(result.complete, false);
  assert.equal(result.manifest.completionEvent, null);
  assert.equal(
    result.manifest.blockers.includes("artifact_verification_bypassed"),
    true,
  );
});

test("observed validation rejects a dirty or mismatched runtime source", async () => {
  const { contracts, input } = await fixture();
  input.run.environmentType = "build_week_observed";

  const dirty = await validateAndBuildManifest(input, contracts, {
    runtimeCommitSha: fixedCommitSha,
    runtimeWorktreeClean: false,
    verifyArtifacts: false,
  });
  assert.match(
    dirty.manifest.validationErrors.join("\n"),
    /explicitly clean runtime worktree/u,
  );

  const mismatched = await validateAndBuildManifest(input, contracts, {
    runtimeCommitSha: "b".repeat(40),
    runtimeWorktreeClean: true,
    verifyArtifacts: false,
  });
  assert.match(
    mismatched.manifest.validationErrors.join("\n"),
    /run\.commitSha must exactly match the runtime HEAD commit/u,
  );
  assert.equal(dirty.complete, false);
  assert.equal(mismatched.complete, false);
});

test("every evidence envelope is bound to the exact run commit", async () => {
  const { contracts, input } = await fixture();
  input.evidence.push({
    id: "stale-automated-run",
    kind: "automated_run",
    commitSha: "b".repeat(40),
    claim: "A green command from another commit must not satisfy this run.",
    provenance: {
      mode: "observed",
      observer: "CI runner",
      observedAt: fixedNow,
    },
    artifact: {
      path: "artifacts/validation/unit-test/stale-automated-run.json",
      sha256: "c".repeat(64),
    },
    details: {
      suite: "foundation",
      command: "pnpm foundation:validate",
      exitCode: 0,
    },
  });

  const result = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });

  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /Evidence stale-automated-run commitSha must exactly match run\.commitSha/u,
  );
});

test("physical app builds and reviews cannot be relabelled onto another commit", async () => {
  const { contracts, input } = await fixture();
  input.evidence.push(
    {
      id: "stale-physical-build",
      kind: "physical_device",
      commitSha: fixedCommitSha,
      claim:
        "The physical observation envelope is current but its installed app is stale.",
      provenance: {
        mode: "observed",
        observer: "licensed inspector",
        observedAt: fixedNow,
      },
      artifact: {
        path: "artifacts/validation/unit-test/stale-physical-build.json",
        sha256: "d".repeat(64),
      },
      details: {
        platform: "ios",
        isPhysical: true,
        syntheticData: true,
        inspectorRole: "licensed_inspector",
        model: "iPhone 16 Pro",
        osVersion: "26.5.2",
        appBuild: "inspectionhub-build-week",
        appCommitSha: "b".repeat(40),
        freeStorageBytes: 10_000_000_000,
        batteryPercent: 80,
        thermalState: "nominal",
        benchmarkProfileSha256: "e".repeat(64),
        rawSampleSha256: "f".repeat(64),
        completedOnsite: true,
        desktopReconstruction: false,
        deliveryFakeSentOrDurablyQueued: true,
        paths: ["complete_inspection", "offline_termination_recovery"],
      },
    },
    {
      id: "stale-review",
      kind: "review",
      commitSha: fixedCommitSha,
      claim: "A review of an earlier implementation cannot clear this run.",
      provenance: {
        mode: "observed",
        observer: "review coordinator",
        observedAt: fixedNow,
      },
      artifact: {
        path: "artifacts/validation/unit-test/stale-review.json",
        sha256: "1".repeat(64),
      },
      details: {
        unresolvedP0: 0,
        unresolvedP1: 0,
        scopes: ["implementation", "security", "document"],
        reviewedCommitSha: "b".repeat(40),
      },
    },
  );

  const result = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });
  const errors = result.manifest.validationErrors.join("\n");

  assert.equal(result.valid, false);
  assert.match(
    errors,
    /Physical evidence stale-physical-build appCommitSha must exactly match run\.commitSha/u,
  );
  assert.match(
    errors,
    /Review evidence stale-review reviewedCommitSha must exactly match run\.commitSha/u,
  );
});

test("the command writes a blocked manifest and returns a blocking exit code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "build-week-milestone-"));
  const output = join(directory, "manifest.json");
  const run = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "run.mjs"), "--output", output],
    { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" },
  );
  assert.equal(run.status, 4, run.stderr);
  const manifest = JSON.parse(await readFile(output, "utf8"));
  assert.equal(manifest.outcome, "blocked");
  assert.equal(manifest.completionEvent, null);
  assert.equal(manifest.validationErrors.length, 0);
});

test("the evidence-input generator emits every required result and gate", () => {
  const run = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "create-evidence-input.mjs")],
    { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const input = JSON.parse(run.stdout);
  assert.equal(input.schemaVersion, 2);
  assert.equal(input.rubricResults.length, 29);
  assert.equal(input.mustPassGates.length, 6);
  assert.equal(input.deferredBoundaries.length, 17);
  assert.equal(input.evidence.length, 0);
});

test("historical evidence-input v1 is migrated only from verified provenance", async () => {
  const { input } = await fixture();
  input.schemaVersion = 1;
  delete input.run.skillVersions;
  const blocked = migrateEvidenceInput(input, {
    runtimeCommitSha: fixedCommitSha,
    runtimeWorktreeClean: true,
  });
  assert.equal(blocked.input.schemaVersion, 2);
  assert.deepEqual(blocked.input.run.skillVersions, []);
  assert.match(
    blocked.errors.join("\n"),
    /run\.skillVersions was not observed/u,
  );
  const inputSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "evidence-input.schema.json"),
      "utf8",
    ),
  );
  assertClosedRequiredObject(blocked.input, inputSchema, "migrated input");
  assertClosedRequiredObject(
    blocked.input.run,
    inputSchema.$defs.run,
    "migrated input run",
  );

  input.run.skillVersions = [];
  const migrated = migrateEvidenceInput(input, {
    runtimeCommitSha: fixedCommitSha,
    runtimeWorktreeClean: true,
  });
  assert.deepEqual(migrated.errors, []);
  assert.equal(migrated.input.schemaVersion, 2);

  input.evidence.push({
    id: "legacy-review",
    kind: "review",
    claim: "Historical review claim with no commit binding.",
    provenance: {
      mode: "observed",
      observer: "historical reviewer",
      observedAt: fixedNow,
    },
    artifact: {
      path: "artifacts/validation/legacy/review.json",
      sha256: "7".repeat(64),
    },
    details: {},
  });
  const unsafe = migrateEvidenceInput(input, {
    runtimeCommitSha: "b".repeat(40),
    runtimeWorktreeClean: true,
  });
  assert.match(
    unsafe.errors.join("\n"),
    /commit migration requires a clean runtime at the exact run commit/u,
  );
  assert.match(
    unsafe.errors.join("\n"),
    /requires an observed reviewedCommitSha and cannot be inferred/u,
  );
});

test("the observed-local collector binds current observations or rejects stale source commits", async (t) => {
  const artifactDirectory = `artifacts/validation/build-week-observed-test-${process.pid}`;
  t.after(async () => {
    await rm(resolve(import.meta.dirname, "../..", artifactDirectory), {
      force: true,
      recursive: true,
    });
  });
  const run = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, "create-evidence-input.mjs"),
      "--observed-local",
      "--artifact-directory",
      artifactDirectory,
    ],
    { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" },
  );
  if (run.status !== 0) {
    assert.equal(run.status, 2, run.stderr);
    assert.match(
      run.stderr,
      /(?:Observed evidence requires a clean Git worktree|Observed (?:repository|review) commit [a-f0-9]{40} does not match run commit [a-f0-9]{40})/u,
    );
    return;
  }
  assert.equal(run.status, 0, run.stderr);
  const input = JSON.parse(run.stdout);
  assert.equal(input.evidence.length, 2);
  assert.equal(
    input.evidence.some((record) => record.kind === "automated_run"),
    false,
  );
  assert.deepEqual(input.run.commands, []);
  assert.equal(
    input.evidence.every((record) => record.commitSha === input.run.commitSha),
    true,
  );
  assert.equal(
    input.evidence.every((record) =>
      record.artifact.path.startsWith(`${artifactDirectory}/observations/`),
    ),
    true,
  );
  assert.equal(
    input.rubricResults.every((result) => result.status === "unproven"),
    true,
  );
  assert.equal(
    input.mustPassGates.every((gate) => gate.status === "unproven"),
    true,
  );

  const contracts = await loadContracts();
  const result = await validateAndBuildManifest(input, contracts, {
    expectedSeedSha256: seed.integrity.canonicalPayloadSha256,
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, true);
  assert.equal(result.complete, false);
  assert.equal(result.manifest.completionEvent, null);
  assert.equal(
    result.manifest.blockers.includes("logged_out_repository_link_unproven"),
    false,
  );
  assert.equal(
    result.manifest.blockers.includes("independent_p0_p1_review_unproven"),
    false,
  );
  for (const blocker of [
    "physical_iphone_golden_and_recovery_path_unproven",
    "two_recipient_sessions_unproven",
    "two_client_sessions_unproven",
    "accessibility_audit_unproven",
    "public_demo_https_and_recipient_security_unproven",
    "logged_out_video_link_unproven",
    "logged_out_submission_description_link_unproven",
  ]) {
    assert.equal(result.manifest.blockers.includes(blocker), true, blocker);
  }
});

test("the JSON contracts encode the full strict output envelope", async () => {
  const inputSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "evidence-input.schema.json"),
      "utf8",
    ),
  );
  const historicalInputSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "evidence-input-v1.schema.json"),
      "utf8",
    ),
  );
  const manifestSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "manifest.schema.json"),
      "utf8",
    ),
  );
  const agentReleaseEvalSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "agent-release-eval.schema.json"),
      "utf8",
    ),
  );
  for (const file of ["rubric.json", "deferred-boundaries.json"]) {
    assert.equal(
      typeof JSON.parse(
        await readFile(resolve(import.meta.dirname, file), "utf8"),
      ),
      "object",
    );
  }

  assert.equal(inputSchema.additionalProperties, false);
  assert.equal(inputSchema.properties.schemaVersion.const, 2);
  assert.match(inputSchema.$id, /evidence-input-v2/u);
  assert.equal(historicalInputSchema.properties.schemaVersion.const, 1);
  assert.match(historicalInputSchema.$id, /evidence-input-v1/u);
  assert.equal(manifestSchema.additionalProperties, false);
  assert.deepEqual(inputSchema.$defs.run, manifestSchema.$defs.run);
  assert.deepEqual(inputSchema.$defs.evidence, manifestSchema.$defs.evidence);
  assert.equal(manifestSchema.properties.run.$ref, "#/$defs/run");
  assert.equal(
    manifestSchema.properties.evidence.items.$ref,
    "#/$defs/evidence",
  );
  for (const schema of [
    manifestSchema.$defs.run,
    manifestSchema.$defs.evidence,
    manifestSchema.$defs.evidence.properties.provenance,
    manifestSchema.$defs.evidence.properties.artifact,
  ]) {
    assert.equal(schema.additionalProperties, false);
  }
  assert.deepEqual(manifestSchema.$defs.evidence.required, [
    "id",
    "kind",
    "commitSha",
    "claim",
    "provenance",
    "artifact",
    "details",
  ]);
  const commitPattern = new RegExp(
    manifestSchema.$defs.run.properties.commitSha.pattern,
    "u",
  );
  assert.equal(commitPattern.test("a".repeat(40)), true);
  assert.equal(commitPattern.test("a".repeat(64)), true);
  assert.equal(commitPattern.test("a".repeat(41)), false);
  assert.equal(
    manifestSchema.$defs.evidence.allOf.every(
      (rule) => rule.then.properties.details.required.length === 1,
    ),
    true,
  );
  assert.equal(
    agentReleaseEvalSchema.properties.artifactKind.const,
    "inspectionhub.agent_release_eval",
  );
  assert.equal(
    agentReleaseEvalSchema.properties.protocol.properties.fixedTrialsPerCase
      .const,
    3,
  );
  assert.equal(
    agentReleaseEvalSchema.properties.adjudication.properties
      .lockedHoldoutBlinded.const,
    true,
  );
  assert.equal(agentReleaseEvalSchema.required.includes("corpus"), true);
  assert.equal(agentReleaseEvalSchema.required.includes("trialResults"), true);
  assert.equal(agentReleaseEvalSchema.properties.trialResults.minItems, 120);
  assert.equal(
    agentReleaseEvalSchema.$defs.trialResult.additionalProperties,
    false,
  );
});

function configureAgentEvalRun(input) {
  input.run.modelVersions = ["gpt-5.6"];
  input.run.promptVersions = [
    "inspection-draft-agent-v1",
    "inspection-draft-thin-v1",
    "inspection-draft-v1",
  ];
  input.run.skillVersions = [
    "building-inspection@1.0.0",
    "report-language@1.0.0",
    "timber-pest-inspection@1.0.0",
  ];
}

function validAgentReleaseEval() {
  const developmentCaseIds = Array.from(
    { length: 10 },
    (_, index) => `D${String(index + 1).padStart(2, "0")}`,
  );
  const lockedHoldoutCaseIds = Array.from(
    { length: 10 },
    (_, index) => `P${String(index + 1).padStart(2, "0")}`,
  );
  const trialResults = [
    ...releaseEvalTrials("development", developmentCaseIds),
    ...releaseEvalTrials("locked_holdout", lockedHoldoutCaseIds),
  ];
  return {
    schemaVersion: 1,
    artifactKind: "inspectionhub.agent_release_eval",
    observedAt: fixedNow,
    releaseBinding: {
      commitSha: fixedCommitSha,
      model: "gpt-5.6",
      promptVersions: [
        "inspection-draft-agent-v1",
        "inspection-draft-thin-v1",
        "inspection-draft-v1",
      ],
      skillVersions: [
        "building-inspection@1.0.0",
        "report-language@1.0.0",
        "timber-pest-inspection@1.0.0",
      ],
    },
    protocol: {
      liveModel: true,
      fixedTrialsPerCase: 3,
      developmentCaseCount: 10,
      lockedHoldoutCaseCount: 10,
    },
    corpus: {
      protectedCorpusSha256: createHash("sha256")
        .update("unit-test-protected-corpus-v1")
        .digest("hex"),
      developmentCaseIds,
      lockedHoldoutCaseIds,
    },
    adjudication: {
      lockedHoldoutBlinded: true,
      adjudicatorIdentityHash: "9".repeat(64),
    },
    trialResults,
    outcomes: {
      development: { passed: true, criticalFailures: 0 },
      lockedHoldout: { passed: true, criticalFailures: 0 },
      releaseEligible: true,
    },
  };
}

function releaseEvalTrials(split, caseIds) {
  return caseIds.flatMap((caseId) =>
    ["agents_sdk", "thin_responses"].flatMap((architecture) =>
      [1, 2, 3].map((trial) => {
        const identity = `${split}:${caseId}:${architecture}:${String(trial)}`;
        return {
          split,
          caseId,
          architecture,
          trial,
          result: {
            criticalFailures: 0,
            outputSha256: createHash("sha256")
              .update(`result:${identity}`)
              .digest("hex"),
          },
          adjudication: {
            passed: true,
            criticalFailures: 0,
            evidenceSha256: createHash("sha256")
              .update(`adjudication:${identity}`)
              .digest("hex"),
          },
        };
      }),
    ),
  );
}

function assertClosedRequiredObject(value, schema, label) {
  assert.equal(schema.additionalProperties, false, `${label} schema is open`);
  assert.deepEqual(
    Object.keys(value).sort(),
    [...schema.required].sort(),
    `${label} does not satisfy its closed required-property contract`,
  );
}

async function agentEvalArtifactDirectory(t) {
  const directory = await mkdtemp(
    resolve(
      import.meta.dirname,
      "../..",
      "artifacts/validation/milestone-agent-eval-test-",
    ),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  return directory;
}

async function addAgentEvalEvidence(
  input,
  artifactDirectory,
  fileName,
  artifact,
  assertedDetails = {},
) {
  const absolutePath = join(artifactDirectory, fileName);
  const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(absolutePath, bytes, "utf8");
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  input.evidence.push({
    id: `agent-eval-${fileName.replaceAll(/[^a-z0-9]+/giu, "-")}`,
    kind: "automated_run",
    commitSha: fixedCommitSha,
    claim: "A unit-test release evaluation artifact exercises the AI gate.",
    provenance: {
      mode: "observed",
      observer: "unit test runner",
      observedAt: fixedNow,
    },
    artifact: {
      path: relative(repositoryRoot, absolutePath),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    details: {
      suite: "agent_eval",
      command: "pnpm test:eval:release",
      exitCode: 0,
      ...assertedDetails,
    },
  });
}

function passAgentEvalGate(input) {
  const gate = input.mustPassGates.find(
    (item) => item.id === "ai_safety_and_authority",
  );
  gate.status = "pass";
  gate.evidenceIds = [input.evidence.at(-1).id];
}

function humanSession(id, cohort, participantHash) {
  return {
    id,
    kind: "human_session",
    commitSha: fixedCommitSha,
    claim: "A pseudonymous participant attempted the recipient task.",
    provenance: {
      mode: "observed",
      observer: "moderated test runner",
      observedAt: fixedNow,
    },
    artifact: {
      path: `artifacts/validation/unit-test/${id}.json`,
      sha256: "8".repeat(64),
    },
    details: {
      cohort,
      participantHash,
      success: true,
      task: "Understand the report condition overview",
      durationSeconds: 75,
      assistance: "none",
    },
  };
}
