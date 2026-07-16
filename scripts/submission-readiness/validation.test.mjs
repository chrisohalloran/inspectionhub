import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  defaultSubmissionInput,
  requirementIds,
  validateAndBuildSubmissionManifest,
} from "./validation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixedNow = "2026-07-16T03:00:00.000Z";
const commitSha = "a".repeat(40);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function observedFixture(t) {
  const validationRoot = resolve(repositoryRoot, "artifacts", "validation");
  await mkdir(validationRoot, { recursive: true });
  const directory = await mkdtemp(resolve(validationRoot, "submission-test-"));
  t.after(async () => rm(directory, { force: true, recursive: true }));
  const artifactPath = resolve(directory, "observed.json");
  const artifactBytes = JSON.stringify({ observed: true, at: fixedNow });
  await writeFile(artifactPath, artifactBytes);
  const artifact = {
    path: relative(repositoryRoot, artifactPath),
    sha256: sha256(artifactBytes),
  };
  const base = (id, kind, claim, details) => ({
    id,
    kind,
    claim,
    provenance: {
      mode: "observed",
      observer: "release-reviewer",
      observedAt: fixedNow,
    },
    artifact,
    details,
  });
  const evidence = [
    base("project", "project_run", "The intended platform ran successfully.", {
      projectWorking: true,
      installOrRunConsistently: true,
      intendedPlatform: "web and iOS",
    }),
    base(
      "technology",
      "technology_use",
      "Codex and GPT-5.6 are meaningful to the observed project.",
      {
        codexMeaningfulUse: true,
        gpt56MeaningfulLiveUse: true,
        liveRunSucceeded: true,
        model: "gpt-5.6",
      },
    ),
    base("track", "submission_field", "The selected track was observed.", {
      field: "track",
      value: "work_and_productivity",
    }),
    base(
      "description",
      "submission_field",
      "The English project description was observed.",
      {
        field: "description",
        present: true,
        explainsFeaturesAndFunctionality: true,
        englishOrTranslationProvided: true,
      },
    ),
    base("video", "video_check", "The public demo video was observed.", {
      url: "https://www.youtube.com/watch?v=inspectionhub",
      finalUrl: "https://www.youtube.com/watch?v=inspectionhub",
      public: true,
      loggedOut: true,
      status: 200,
      expectedContent: "InspectionHub",
      expectedContentPresent: true,
      durationSeconds: 179,
      workingProjectShown: true,
      audioPresent: true,
      coversWhatWasBuilt: true,
      coversCodexUse: true,
      coversGpt56Use: true,
      englishOrTranslationProvided: true,
    }),
    base(
      "repository",
      "repository_check",
      "The public repository and README were observed logged out.",
      {
        url: "https://github.com/example/inspectionhub",
        access: "public",
        loggedOut: true,
        status: 200,
        relevantLicensePresent: true,
        readmeSetupInstructions: true,
        readmeTestInstructions: true,
        readmeSampleDataOrNotNeeded: true,
        readmeCodexCollaborationAndDecisions: true,
        readmeGpt56Integration: true,
      },
    ),
    base(
      "feedback",
      "submission_field",
      "The primary Codex feedback Session ID field was observed.",
      {
        field: "feedback_session",
        sessionId: "019f5dd7-1480-7ca1-8307-3ed24a80559d",
        fromPrimaryBuildThread: true,
      },
    ),
    base(
      "access",
      "judge_access_check",
      "A free working judge-access path was observed.",
      {
        kind: "functioning_demo",
        url: "https://demo.inspectionhub.example",
        observedWorking: true,
        freeOfCharge: true,
        availableWithoutRestriction: true,
        availableThrough: "2026-08-06T00:00:00.000Z",
        credentialsRequired: false,
      },
    ),
    base(
      "provenance",
      "submission_field",
      "Creation during the submission period was observed.",
      {
        field: "provenance",
        createdDuringSubmissionPeriod: true,
        preexistingExtensionDocumented: false,
      },
    ),
    base("rights", "rights_review", "Submission rights were reviewed.", {
      entrantOwnsSubmission: true,
      thirdPartyUseAuthorized: true,
      videoContainsNoUnlicensedAssets: true,
    }),
    base(
      "form",
      "submission_field",
      "All required pre-submission Devpost fields were observed.",
      {
        field: "devpost_form",
        requiredFieldsComplete: true,
      },
    ),
  ];
  const evidenceByRequirement = {
    working_project: "project",
    codex_and_gpt56: "technology",
    track: "track",
    description: "description",
    video: "video",
    repository: "repository",
    feedback_session: "feedback",
    judge_access: "access",
    provenance: "provenance",
    rights_and_safety: "rights",
    devpost_form: "form",
  };
  return {
    artifactPath,
    input: {
      schemaVersion: 1,
      run: { startedAt: fixedNow, endedAt: fixedNow, commitSha },
      evidence,
      requirements: requirementIds.map((id) => ({
        id,
        status: "pass",
        evidenceIds: [evidenceByRequirement[id]],
        reason: "Observed and checksum-backed.",
      })),
      skippedChecks: [],
    },
  };
}

test("no evidence is valid but blocked with no fabricated passes", async () => {
  const input = defaultSubmissionInput({
    now: fixedNow,
    commitSha,
  });
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, true);
  assert.equal(result.ready, false);
  assert.equal(result.manifest.outcome, "blocked");
  assert.equal(result.manifest.readinessEvent, null);
  assert.deepEqual(
    result.manifest.requirements.map(({ id, status }) => ({ id, status })),
    requirementIds.map((id) => ({ id, status: "unproven" })),
  );
  assert.equal(
    result.manifest.blockers.includes("physical_iphone_unproven"),
    false,
  );
  assert.equal(
    result.manifest.blockers.includes("accessibility_audit_unproven"),
    false,
  );
});

test("all official preflight evidence produces a checksum-bound ready event", async (t) => {
  const { input } = await observedFixture(t);
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, true);
  assert.equal(result.ready, true);
  assert.equal(result.manifest.outcome, "ready");
  assert.deepEqual(result.manifest.blockers, []);
  assert.equal(
    result.manifest.readinessEvent.manifestPayloadSha256,
    result.manifest.integrity.canonicalPayloadSha256,
  );
  assert.equal("submitted" in result.manifest, false);
  assert.equal("submissionReceipt" in result.manifest, false);
});

test("tampered observed evidence fails closed", async (t) => {
  const { artifactPath, input } = await observedFixture(t);
  await writeFile(artifactPath, "tampered");
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  assert.equal(result.manifest.outcome, "blocked");
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("checksum does not match"),
    ),
    true,
  );
});

test("post-submit receipt fields are rejected from preflight", async (t) => {
  const { input } = await observedFixture(t);
  input.submissionReceipt = {
    submitted: true,
    devpostProjectUrl: "https://devpost.com/software/inspectionhub",
  };
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  assert.equal(
    result.manifest.validationErrors.includes(
      "Unknown top-level field: submissionReceipt",
    ),
    true,
  );
});

test("three-minute video and early-expiring judge access fail closed", async (t) => {
  const { input } = await observedFixture(t);
  input.evidence.find((item) => item.id === "video").details.durationSeconds =
    180;
  input.evidence.find((item) => item.id === "access").details.availableThrough =
    "2026-08-05T23:59:59.999Z";
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("official public demo contract"),
    ),
    true,
  );
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("through judging"),
    ),
    true,
  );
});

test("self-asserted video visibility and boolean-only feedback fail closed", async (t) => {
  const { input } = await observedFixture(t);
  const video = input.evidence.find((item) => item.id === "video");
  delete video.details.loggedOut;
  delete video.details.status;
  delete video.details.finalUrl;
  delete video.details.expectedContentPresent;
  const feedback = input.evidence.find((item) => item.id === "feedback");
  delete feedback.details.sessionId;
  feedback.details.present = true;
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("official public demo contract"),
    ),
    true,
  );
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("Submission-field evidence feedback"),
    ),
    true,
  );
});

test("the CLI default exits blocked and writes a truthful manifest", async (t) => {
  const directory = await mkdtemp(
    resolve(repositoryRoot, "artifacts", "submission-cli-"),
  );
  t.after(async () => rm(directory, { force: true, recursive: true }));
  const output = resolve(directory, "manifest.json");
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "run.mjs"), "--output", output],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 4, result.stderr);
  const manifest = JSON.parse(await readFile(output, "utf8"));
  assert.equal(manifest.outcome, "blocked");
  assert.equal(manifest.readinessEvent, null);
  assert.equal(
    manifest.requirements.every((item) => item.status === "unproven"),
    true,
  );
});

test("the JSON contracts are parseable and exclude post-submit state", async () => {
  const inputSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "evidence-input.schema.json"),
      "utf8",
    ),
  );
  const manifestSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "manifest.schema.json"),
      "utf8",
    ),
  );
  assert.equal(inputSchema.properties.submissionReceipt, undefined);
  assert.equal(manifestSchema.properties.submitted, undefined);
  assert.equal(manifestSchema.properties.submissionReceipt, undefined);
  assert.equal(
    manifestSchema.properties.officialJudgingEndsAt.const,
    "2026-08-06T00:00:00.000Z",
  );
});
