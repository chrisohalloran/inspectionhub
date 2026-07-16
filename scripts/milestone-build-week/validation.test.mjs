import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { canonicalJson, seedDocument } from "../demo-seed/generate.mjs";
import {
  defaultEvidenceInput,
  loadContracts,
  validateAndBuildManifest,
} from "./validation.mjs";

const fixedNow = "2026-07-15T03:00:00.000Z";
const seed = seedDocument();

function clone(value) {
  return structuredClone(value);
}

async function fixture() {
  const contracts = await loadContracts();
  const input = defaultEvidenceInput({
    now: fixedNow,
    commitSha: "uncommitted",
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
    /requires a live development and locked-holdout eval/u,
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
  assert.equal(input.rubricResults.length, 29);
  assert.equal(input.mustPassGates.length, 6);
  assert.equal(input.deferredBoundaries.length, 17);
  assert.equal(input.evidence.length, 0);
});

test("the observed-local collector checksums bounded evidence without promoting unproven gates", async (t) => {
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
  assert.equal(run.status, 0, run.stderr);
  const input = JSON.parse(run.stdout);
  assert.equal(input.evidence.length, 2);
  assert.equal(
    input.evidence.some((record) => record.kind === "automated_run"),
    false,
  );
  assert.deepEqual(input.run.commands, []);
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

test("the JSON contracts are parseable", async () => {
  for (const file of [
    "evidence-input.schema.json",
    "manifest.schema.json",
    "rubric.json",
    "deferred-boundaries.json",
  ]) {
    const parsed = JSON.parse(
      await readFile(resolve(import.meta.dirname, file), "utf8"),
    );
    assert.equal(typeof parsed, "object");
  }
});
