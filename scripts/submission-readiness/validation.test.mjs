import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { sha256 } from "../demo-seed/generate.mjs";

import {
  defaultSubmissionInput,
  deriveSubmissionDescriptionObservation,
  evidenceBindingSha256,
  requirementIds,
  validateAndBuildSubmissionManifest as validateAndBuildSubmissionManifestRaw,
} from "./validation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixedNow = "2026-07-16T03:00:00.000Z";
const commitSha = "a".repeat(40);
const verifiedExternalObservationsByInput = new WeakMap();

function validateAndBuildSubmissionManifest(input, options = {}) {
  const verifiedExternalObservations =
    verifiedExternalObservationsByInput.get(input);
  return validateAndBuildSubmissionManifestRaw(input, {
    ...options,
    ...(verifiedExternalObservations ? { verifiedExternalObservations } : {}),
  });
}

async function observedFixture(t) {
  const validationRoot = resolve(repositoryRoot, "artifacts", "validation");
  await mkdir(validationRoot, { recursive: true });
  const directory = await mkdtemp(resolve(validationRoot, "submission-test-"));
  const descriptionSourceText = await readFile(
    resolve(repositoryRoot, "docs/submission/devpost-copy.md"),
    "utf8",
  );
  const derivedDescription = deriveSubmissionDescriptionObservation(
    descriptionSourceText,
  );
  assert.ok(derivedDescription, "the committed Devpost copy must be bounded");
  t.after(async () => rm(directory, { force: true, recursive: true }));
  const base = (id, kind, claim, details) => ({
    id,
    kind,
    claim,
    provenance: {
      mode: "observed",
      observer: "release-reviewer",
      observedAt: fixedNow,
    },
    artifact: {
      path: relative(repositoryRoot, resolve(directory, `${id}.json`)),
      sha256: "0".repeat(64),
    },
    details,
  });
  const evidence = [
    base("project", "project_run", "The intended platform ran successfully.", {
      projectWorking: true,
      installOrRunConsistently: true,
      intendedPlatform: "web and iOS",
      commitSha,
      ciRunUrl: "https://github.com/example/inspectionhub/actions/runs/123",
      ciConclusion: "success",
      localStatuses: { root: 200, invitation: 303, otp: 303, report: 200 },
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
      url: "https://youtu.be/AbCdEf12345",
      finalUrl: "https://www.youtube.com/watch?v=AbCdEf12345",
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
        finalUrl: "https://github.com/example/inspectionhub/",
        access: "public",
        loggedOut: true,
        status: 200,
        relevantLicensePresent: true,
        readmeSetupInstructions: true,
        readmeTestInstructions: true,
        readmeSampleDataOrNotNeeded: true,
        readmeCodexCollaborationAndDecisions: true,
        readmeGpt56Integration: true,
        commitSha,
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
        finalUrl: "https://demo.inspectionhub.example/",
        loggedOut: true,
        status: 200,
        expectedContentPresent: true,
        observedWorking: true,
        freeOfCharge: true,
        availableWithoutRestriction: true,
        availableThrough: "2026-08-06T00:00:00.000Z",
        credentialsRequired: false,
        commitSha,
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
        rootCommitCount: 1,
        rootCommitSha: "c".repeat(40),
        rootCommitAt: "2026-07-15T01:00:00.000Z",
        publicRootCommitSha: "c".repeat(40),
        repositoryCreatedAt: "2026-07-15T00:59:00.000Z",
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
  const input = {
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
  };
  const artifactPathsByEvidenceId = new Map(
    evidence.map((record) => [
      record.id,
      resolve(repositoryRoot, record.artifact.path),
    ]),
  );
  const verifiedExternalObservations = {};
  verifiedExternalObservationsByInput.set(input, verifiedExternalObservations);
  const rebindEvidence = async (id, transform = (value) => value) => {
    const record = evidence.find((item) => item.id === id);
    assert.ok(record, `missing evidence ${id}`);
    const path = artifactPathsByEvidenceId.get(id);
    const envelope = transform({
      schemaVersion: 1,
      evidenceId: record.id,
      evidenceKind: record.kind,
      commitSha: input.run.commitSha,
      observedAt: record.provenance.observedAt,
      bindingSha256: evidenceBindingSha256(record, input.run.commitSha),
      observation: observationFor(record, input.run.commitSha),
    });
    const bytes = `${JSON.stringify(envelope, null, 2)}\n`;
    await writeFile(path, bytes);
    record.artifact = {
      path: relative(repositoryRoot, path),
      sha256: sha256(bytes),
    };
    const externalRequirementId =
      id === "access" ? "judge_access" : id === "provenance" ? id : null;
    if (externalRequirementId) {
      verifiedExternalObservations[externalRequirementId] = {
        evidenceId: record.id,
        evidenceKind: record.kind,
        commitSha: input.run.commitSha,
        observedAt: record.provenance.observedAt,
        artifactSha256: record.artifact.sha256,
        observation: envelope.observation,
      };
    }
  };

  const observationFor = (record, runCommitSha) => {
    if (record.kind === "project_run") {
      const command = (value) => ({
        command: value,
        exitCode: 0,
        stdout: "completed",
        outputTailSha256: "1".repeat(64),
      });
      return {
        commitSha: runCommitSha,
        ci: {
          headSha: runCommitSha,
          headBranch: "main",
          event: "push",
          workflowPath: ".github/workflows/ci.yml",
          conclusion: "success",
          status: "completed",
          runAttempt: 1,
          url: record.details.ciRunUrl,
          runId: 123,
        },
        cleanBuild: {
          install: command("pnpm install --frozen-lockfile"),
          build: command("pnpm build"),
        },
        judgeDemo: {
          statuses: { ...record.details.localStatuses },
          expectedContentPresent: true,
          exitCode: 0,
          outputTailSha256: "2".repeat(64),
        },
        runtime: { node: "v24.4.1", pnpm: "10.13.1" },
      };
    }
    if (record.kind === "technology_use") {
      return {
        provider: "openai",
        model: record.details.model,
        responseId: "resp_observed1234",
        outputArtifactSha256: "6".repeat(64),
        store: false,
        inspectorConfirmed: true,
        sessionId: "019f5dd7-1480-7ca1-8307-3ed24a80559d",
      };
    }
    if (record.kind === "video_check") return { ...record.details };
    if (record.kind === "repository_check") {
      const common = {
        url: record.details.url,
        finalUrl: record.details.finalUrl,
        status: record.details.status,
        loggedOut: record.details.loggedOut,
        headSha: runCommitSha,
        readmeStatus: 200,
        licenseStatus: 200,
        codexStoryStatus: 200,
        judgeGuideUrl: `https://github.com/example/inspectionhub/blob/${runCommitSha}/docs/submission/judge-demo.md`,
        judgeGuideStatus: 200,
        readmeSha256: "3".repeat(64),
        licenseSha256: "4".repeat(64),
        collaborationSectionLength: 240,
      };
      if (record.details.access === "private_shared") {
        return {
          ...common,
          access: "private_shared",
          sharedWith: [...record.details.sharedWith],
          sharingVerification: {
            method: "authenticated_repository_settings",
            verifiedAt: record.provenance.observedAt,
          },
        };
      }
      return common;
    }
    if (record.kind === "judge_access_check") {
      return {
        ...record.details,
        availabilityBasis: "public_deployment_observation",
      };
    }
    if (record.kind === "rights_review") {
      return {
        ...record.details,
        reviewer: "submission-rights-owner",
        reviewedAt: record.provenance.observedAt,
        attestationSha256: "7".repeat(64),
      };
    }
    if (record.details.field === "track") {
      return {
        sourcePath: "docs/submission/devpost-copy.md",
        sourceSha256: "5".repeat(64),
        track: "Work and Productivity",
      };
    }
    if (record.details.field === "description") {
      return {
        sourcePath: "docs/submission/devpost-copy.md",
        sourceText: descriptionSourceText,
        sourceSha256: sha256(descriptionSourceText),
        ...derivedDescription,
      };
    }
    if (record.details.field === "feedback_session") {
      return {
        sessionId: record.details.sessionId,
        source: "codex_feedback_command",
        fromPrimaryBuildThread: record.details.fromPrimaryBuildThread,
      };
    }
    if (record.details.field === "provenance") {
      return {
        rootCommitCount: record.details.rootCommitCount,
        rootCommitSha: record.details.rootCommitSha,
        rootCommitAt: record.details.rootCommitAt,
        publicRootCommitSha: record.details.publicRootCommitSha,
        publicRootCommitAt: record.details.rootCommitAt,
        repositoryCreatedAt: record.details.repositoryCreatedAt,
      };
    }
    if (record.details.field === "devpost_form") {
      return {
        url: "https://openai.devpost.com/submissions/inspectionhub",
        formId: "inspectionhub-build-week",
        formRevision: "observed-revision-1",
        requiredFieldsComplete: record.details.requiredFieldsComplete,
      };
    }
    assert.fail(`No observation fixture exists for ${record.id}`);
  };
  const rebindAll = async () => {
    await Promise.all(evidence.map(({ id }) => rebindEvidence(id)));
  };
  await rebindAll();
  return {
    input,
    directory,
    artifactPath: artifactPathsByEvidenceId.get("project"),
    artifactPathsByEvidenceId,
    rebindEvidence,
    rebindAll,
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
  assert.equal(
    result.valid,
    true,
    JSON.stringify(result.manifest.validationErrors),
  );
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
  assert.equal(
    result.valid,
    true,
    JSON.stringify(result.manifest.validationErrors),
  );
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

test("serialized evidence alone cannot authorize judge access or provenance", async (t) => {
  const { input } = await observedFixture(t);
  const result = await validateAndBuildSubmissionManifestRaw(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  for (const id of ["judge_access", "provenance"]) {
    assert.equal(
      result.manifest.validationErrors.includes(
        `Submission requirement ${id} requires non-serialized runtime verification context`,
      ),
      true,
      id,
    );
  }
  assert.equal("verifiedExternalObservations" in result.manifest, false);
});

test("serialized runtime-verification fields are rejected from candidate input", async (t) => {
  const { input } = await observedFixture(t);
  input.verifiedExternalObservations =
    verifiedExternalObservationsByInput.get(input);
  const result = await validateAndBuildSubmissionManifestRaw(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.includes(
      "Unknown top-level field: verifiedExternalObservations",
    ),
    true,
  );
});

test("runtime verification context must match the exact artifact and run", async (t) => {
  const { input } = await observedFixture(t);
  const context = verifiedExternalObservationsByInput.get(input);
  context.provenance = {
    ...context.provenance,
    artifactSha256: "f".repeat(64),
  };
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  assert.equal(
    result.manifest.validationErrors.includes(
      "Submission requirement provenance runtime verification context does not match its exact evidence run",
    ),
    true,
  );
});

test("description observations are derived from exact bounded section bodies", async (t) => {
  for (const [name, mutate] of [
    [
      "source hash",
      (observation) => {
        observation.sourceText = observation.sourceText.replace(
          "InspectionHub starts",
          "InspectionHub begins",
        );
      },
    ],
    [
      "section body",
      (observation) => {
        observation.sections.whatWeBuilt += " Fabricated feature claim.";
      },
    ],
    [
      "section counter",
      (observation) => {
        observation.sectionLengths.oneLine += 1;
      },
    ],
    [
      "semantic boolean",
      (observation) => {
        observation.featuresAndFunctionalityPresent = false;
      },
    ],
  ]) {
    await t.test(name, async (child) => {
      const { input, rebindEvidence } = await observedFixture(child);
      await rebindEvidence("description", (envelope) => {
        mutate(envelope.observation);
        return envelope;
      });
      const result = await validateAndBuildSubmissionManifest(input, {
        generatedAt: fixedNow,
      });
      assert.equal(result.valid, false);
      assert.equal(result.ready, false);
      assert.equal(
        result.manifest.validationErrors.some((error) =>
          error.includes("strict submission_field contract"),
        ),
        true,
      );
    });
  }
});

test("description derivation rejects featureless prose", async () => {
  const sourceText = await readFile(
    resolve(repositoryRoot, "docs/submission/devpost-copy.md"),
    "utf8",
  );
  const featureless = sourceText.replace(
    /(?<=## What we built\n\n)[\s\S]*?(?=\n## How we used Codex and GPT-5\.6)/u,
    `${"This paragraph is written in English, but it only repeats a general statement without concrete product behaviour. ".repeat(12).trim()}\n`,
  );
  const derived = deriveSubmissionDescriptionObservation(featureless);
  assert.ok(derived);
  assert.equal(derived.englishDescriptionPresent, true);
  assert.equal(derived.featuresAndFunctionalityPresent, false);
});

test("changing a claim invalidates its claim-bound artifact", async (t) => {
  const { input } = await observedFixture(t);
  input.evidence.find((item) => item.id === "track").claim =
    "A different track claim was substituted after observation.";
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("not bound to its claim and run"),
    ),
    true,
  );
});

test("changing valid details invalidates the original artifact binding", async (t) => {
  const { input } = await observedFixture(t);
  input.evidence.find((item) => item.id === "track").details.value =
    "developer_tools";
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("not bound to its claim and run"),
    ),
    true,
  );
});

test("envelope commit must match the evidence run", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  await rebindEvidence("track", (envelope) => ({
    ...envelope,
    commitSha: "d".repeat(40),
  }));
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("not bound to its claim and run"),
    ),
    true,
  );
});

test("envelope observation time must match observed provenance", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  await rebindEvidence("track", (envelope) => ({
    ...envelope,
    observedAt: "2026-07-16T02:59:59.999Z",
  }));
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("not bound to its claim and run"),
    ),
    true,
  );
});

test("generic envelope observations cannot authorize a pass", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  await rebindEvidence("track", (envelope) => ({
    ...envelope,
    observation: { observed: true, evidenceId: "track" },
  }));
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("strict submission_field contract"),
    ),
    true,
  );
});

test("echoed technology details cannot prove a live model run", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  const technology = input.evidence.find((item) => item.id === "technology");
  await rebindEvidence("technology", (envelope) => ({
    ...envelope,
    observation: { ...technology.details },
  }));
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(result.ready, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("strict technology_use contract"),
    ),
    true,
  );
});

test("a generic checksum-only artifact cannot prove a bounded claim", async (t) => {
  const { artifactPathsByEvidenceId, input } = await observedFixture(t);
  const path = artifactPathsByEvidenceId.get("track");
  const bytes = '{"observed":true}\n';
  await writeFile(path, bytes);
  input.evidence.find((item) => item.id === "track").artifact.sha256 =
    sha256(bytes);
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("not bound to its claim and run"),
    ),
    true,
  );
});

test("an evidence envelope cannot be reused for another record", async (t) => {
  const { input } = await observedFixture(t);
  const track = input.evidence.find((item) => item.id === "track");
  const description = input.evidence.find((item) => item.id === "description");
  track.artifact = { ...description.artifact };
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("not bound to its claim and run"),
    ),
    true,
  );
});

test("unknown artifact-envelope fields fail closed", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  await rebindEvidence("track", (envelope) => ({
    ...envelope,
    unreviewed: true,
  }));
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("artifact envelope has unknown field: unreviewed"),
    ),
    true,
  );
});

test("valid skipped checks block a readiness event", async (t) => {
  const { input } = await observedFixture(t);
  input.skippedChecks = [
    { id: "manual-review", reason: "The manual review was not performed." },
  ];
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, true);
  assert.equal(result.ready, false);
  assert.equal(result.manifest.readinessEvent, null);
  assert.deepEqual(result.manifest.blockers, ["skipped_checks_present"]);
});

test("submission deadline boundaries fail closed", async (t) => {
  await t.test("the exact deadline is accepted", async (child) => {
    const { input, rebindAll } = await observedFixture(child);
    input.run.startedAt = "2026-07-21T23:59:59.000Z";
    input.run.endedAt = "2026-07-22T00:00:00.000Z";
    for (const record of input.evidence) {
      record.provenance.observedAt = input.run.endedAt;
    }
    await rebindAll();
    const result = await validateAndBuildSubmissionManifest(input, {
      generatedAt: input.run.endedAt,
    });
    assert.equal(result.valid, true);
    assert.equal(result.ready, true);
  });

  await t.test("a run after the deadline is blocked", async (child) => {
    const { input, rebindAll } = await observedFixture(child);
    input.run.startedAt = "2026-07-22T00:00:00.001Z";
    input.run.endedAt = "2026-07-22T00:00:00.001Z";
    for (const record of input.evidence) {
      record.provenance.observedAt = input.run.endedAt;
    }
    await rebindAll();
    const result = await validateAndBuildSubmissionManifest(input, {
      generatedAt: input.run.endedAt,
    });
    assert.equal(result.valid, true);
    assert.equal(result.ready, false);
    assert.equal(
      result.manifest.blockers.includes("submission_period_closed"),
      true,
    );
  });

  await t.test(
    "post-deadline manifest generation is blocked",
    async (child) => {
      const { input } = await observedFixture(child);
      const result = await validateAndBuildSubmissionManifest(input, {
        generatedAt: "2026-07-22T00:00:00.001Z",
      });
      assert.equal(result.valid, true);
      assert.equal(result.ready, false);
      assert.equal(
        result.manifest.blockers.includes("submission_period_closed"),
        true,
      );
    },
  );
});

test("evidence provenance must fall within its run", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  const project = input.evidence.find((item) => item.id === "project");
  project.provenance.observedAt = "2026-07-16T02:59:59.999Z";
  await rebindEvidence("project");
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("must fall within the evidence run"),
    ),
    true,
  );
});

test("manifest generation cannot predate the evidence run", async (t) => {
  const { input } = await observedFixture(t);
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: "2026-07-16T02:59:59.999Z",
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.includes(
      "generatedAt cannot precede run.endedAt",
    ),
    true,
  );
});

test("nested unknown fields are rejected", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  const project = input.evidence.find((item) => item.id === "project");
  input.run.extra = true;
  project.extra = true;
  project.provenance.extra = true;
  project.details.misspelledProof = true;
  input.requirements[0].extra = true;
  input.skippedChecks = [
    { id: "manual-review", reason: "Not performed.", extra: true },
  ];
  await rebindEvidence("project");
  project.artifact.extra = true;
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  for (const field of [
    "run has unknown field: extra",
    "Evidence project has unknown field: extra",
    "Evidence project provenance has unknown field: extra",
    "Evidence project artifact has unknown field: extra",
    "Evidence project details has unknown field: misspelledProof",
    "Submission requirement working_project has unknown field: extra",
    "skippedChecks record has unknown field: extra",
  ]) {
    assert.equal(
      result.manifest.validationErrors.some((error) => error.includes(field)),
      true,
      field,
    );
  }
});

test("video and repository redirects must preserve resource identity", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  input.evidence.find((item) => item.id === "video").details.finalUrl =
    "https://www.youtube.com/watch?v=ZyXwVu98765";
  input.evidence.find((item) => item.id === "repository").details.finalUrl =
    "https://github.com/another/inspectionhub";
  await rebindEvidence("video");
  await rebindEvidence("repository");
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("official public demo contract"),
    ),
    true,
  );
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("official access and README contract"),
    ),
    true,
  );
});

test("repository and judge URLs reject query parameters and fragments", async (t) => {
  for (const [name, mutate] of [
    [
      "repository query",
      (input) => {
        input.evidence.find((item) => item.id === "repository").details.url +=
          "?tab=readme";
      },
    ],
    [
      "repository fragment",
      (input) => {
        input.evidence.find(
          (item) => item.id === "repository",
        ).details.finalUrl += "#readme";
      },
    ],
    [
      "judge query",
      (input) => {
        input.evidence.find((item) => item.id === "access").details.url +=
          "?preview=true";
      },
    ],
    [
      "judge fragment",
      (input) => {
        input.evidence.find((item) => item.id === "access").details.finalUrl +=
          "#report";
      },
    ],
  ]) {
    await t.test(name, async (child) => {
      const { input, rebindEvidence } = await observedFixture(child);
      mutate(input);
      const id = name.startsWith("repository") ? "repository" : "access";
      await rebindEvidence(id);
      const result = await validateAndBuildSubmissionManifest(input, {
        generatedAt: fixedNow,
      });
      assert.equal(result.valid, false);
      assert.equal(result.ready, false);
    });
  }
});

test("private repository URLs must be clean and preserve repository identity", async (t) => {
  for (const [name, mutate] of [
    ["source query", (details) => (details.url += "?token=secret")],
    ["final fragment", (details) => (details.finalUrl += "#readme")],
    [
      "identity change",
      (details) =>
        (details.finalUrl = "https://github.com/another/inspectionhub"),
    ],
  ]) {
    await t.test(name, async (child) => {
      const { input, rebindEvidence } = await observedFixture(child);
      const repository = input.evidence.find(
        (item) => item.id === "repository",
      );
      repository.details.access = "private_shared";
      repository.details.loggedOut = false;
      repository.details.status = 200;
      repository.details.sharedWith = [
        "testing@devpost.com",
        "build-week-event@openai.com",
      ];
      mutate(repository.details);
      await rebindEvidence("repository");
      const result = await validateAndBuildSubmissionManifest(input, {
        generatedAt: fixedNow,
      });
      assert.equal(result.valid, false);
      assert.equal(result.ready, false);
      assert.equal(
        result.manifest.validationErrors.some((error) =>
          error.includes("official access and README contract"),
        ),
        true,
      );
    });
  }
});

test("private repository evidence has one strict runtime and schema shape", async (t) => {
  const { input, rebindEvidence } = await observedFixture(t);
  const repository = input.evidence.find((item) => item.id === "repository");
  repository.details.access = "private_shared";
  repository.details.loggedOut = false;
  repository.details.status = 200;
  repository.details.sharedWith = [
    "testing@devpost.com",
    "build-week-event@openai.com",
  ];
  await rebindEvidence("repository");
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.deepEqual(result.manifest.validationErrors, []);
  assert.equal(result.ready, true);

  const envelopeSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "artifact-envelope.schema.json"),
      "utf8",
    ),
  );
  assert.equal(envelopeSchema.$defs.repositoryObservation.oneOf.length, 2);
  assert.deepEqual(
    envelopeSchema.$defs.privateRepositoryObservation.required.slice(-3),
    ["access", "sharedWith", "sharingVerification"],
  );
  assert.equal(
    envelopeSchema.$defs.privateRepositoryObservation.properties.loggedOut
      .const,
    false,
  );
});

test("private repository evidence rejects incomplete or self-asserted sharing", async (t) => {
  await t.test("missing required reviewer", async (child) => {
    const { input, rebindEvidence } = await observedFixture(child);
    const repository = input.evidence.find((item) => item.id === "repository");
    repository.details.access = "private_shared";
    repository.details.loggedOut = false;
    repository.details.status = 200;
    repository.details.sharedWith = ["testing@devpost.com"];
    await rebindEvidence("repository");
    const result = await validateAndBuildSubmissionManifest(input, {
      generatedAt: fixedNow,
    });
    assert.equal(result.valid, false);
    assert.equal(result.ready, false);
  });

  await t.test("unverified sharing method", async (child) => {
    const { input, rebindEvidence } = await observedFixture(child);
    const repository = input.evidence.find((item) => item.id === "repository");
    repository.details.access = "private_shared";
    repository.details.loggedOut = false;
    repository.details.status = 200;
    repository.details.sharedWith = [
      "testing@devpost.com",
      "build-week-event@openai.com",
    ];
    await rebindEvidence("repository", (envelope) => ({
      ...envelope,
      observation: {
        ...envelope.observation,
        sharingVerification: {
          ...envelope.observation.sharingVerification,
          method: "self_attested",
        },
      },
    }));
    const result = await validateAndBuildSubmissionManifest(input, {
      generatedAt: fixedNow,
    });
    assert.equal(result.valid, false);
    assert.equal(result.ready, false);
  });
});

test("YouTube URLs allow only canonical video-ID forms", async (t) => {
  for (const [name, url] of [
    ["short-link query", "https://youtu.be/AbCdEf12345?si=tracking"],
    [
      "watch query",
      "https://www.youtube.com/watch?v=AbCdEf12345&feature=shared",
    ],
    ["fragment", "https://www.youtube.com/watch?v=AbCdEf12345#comments"],
    ["extra path", "https://youtu.be/AbCdEf12345/extra"],
    ["noncanonical host", "https://m.youtube.com/watch?v=AbCdEf12345"],
  ]) {
    await t.test(name, async (child) => {
      const { input, rebindEvidence } = await observedFixture(child);
      input.evidence.find((item) => item.id === "video").details.url = url;
      await rebindEvidence("video");
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
    });
  }
});

test("provenance requires one matching public root inside the period", async (t) => {
  for (const [name, mutate] of [
    ["multiple roots", (details) => (details.rootCommitCount = 2)],
    [
      "public root mismatch",
      (details) => (details.publicRootCommitSha = "d".repeat(40)),
    ],
    [
      "repository predates period",
      (details) => (details.repositoryCreatedAt = "2026-07-13T15:59:59.999Z"),
    ],
    [
      "root postdates run",
      (details) => (details.rootCommitAt = "2026-07-16T03:00:00.001Z"),
    ],
  ]) {
    await t.test(name, async (child) => {
      const { input, rebindEvidence } = await observedFixture(child);
      mutate(input.evidence.find((item) => item.id === "provenance").details);
      await rebindEvidence("provenance");
      const result = await validateAndBuildSubmissionManifest(input, {
        generatedAt: fixedNow,
      });
      assert.equal(result.valid, false);
      assert.equal(result.ready, false);
      assert.equal(
        result.manifest.validationErrors.some((error) =>
          error.includes("Submission-field evidence provenance"),
        ),
        true,
      );
    });
  }
});

test("artifact symlinks fail closed even when their bytes match", async (t) => {
  const { artifactPath, input } = await observedFixture(t);
  const target = resolve(`${artifactPath}.target`);
  await writeFile(target, await readFile(artifactPath));
  await rm(artifactPath);
  try {
    await symlink(target, artifactPath);
  } catch (error) {
    if (["EACCES", "ENOTSUP", "EPERM"].includes(error.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("artifact is unreadable"),
    ),
    true,
  );
});

test("artifact parent-directory symlinks cannot escape validation", async (t) => {
  const { artifactPath, directory, input } = await observedFixture(t);
  const outside = await mkdtemp(
    resolve(repositoryRoot, "artifacts", "submission-outside-"),
  );
  t.after(async () => rm(outside, { force: true, recursive: true }));
  const outsideArtifact = resolve(outside, "project.json");
  await writeFile(outsideArtifact, await readFile(artifactPath));
  const linkedDirectory = resolve(directory, "linked");
  try {
    await symlink(outside, linkedDirectory, "dir");
  } catch (error) {
    if (["EACCES", "ENOTSUP", "EPERM"].includes(error.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  input.evidence.find((item) => item.id === "project").artifact.path = relative(
    repositoryRoot,
    resolve(linkedDirectory, "project.json"),
  );
  const result = await validateAndBuildSubmissionManifest(input, {
    generatedAt: fixedNow,
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.manifest.validationErrors.some((error) =>
      error.includes("artifact is unreadable"),
    ),
    true,
  );
});

test("unsafe lexical artifact paths are rejected", async (t) => {
  for (const [name, path] of [
    ["absolute", "/tmp/proof.json"],
    ["traversal", "artifacts/validation/../outside.json"],
    ["backslash traversal", "artifacts/validation\\..\\outside.json"],
    ["prefix collision", "artifacts/validation-evil/proof.json"],
  ]) {
    await t.test(name, async (child) => {
      const { input } = await observedFixture(child);
      input.evidence.find((item) => item.id === "project").artifact.path = path;
      const result = await validateAndBuildSubmissionManifest(input, {
        generatedAt: fixedNow,
      });
      assert.equal(result.valid, false);
      assert.equal(
        result.manifest.validationErrors.some((error) =>
          error.includes("requires a safe checksum-backed artifact"),
        ),
        true,
      );
    });
  }
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
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.readinessEvent, null);
  assert.equal(
    manifest.requirements.every((item) => item.status === "unproven"),
    true,
  );
});

test("the JSON contracts are strict, discriminated, and versioned", async () => {
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
  const envelopeSchema = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "artifact-envelope.schema.json"),
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
  assert.equal(
    manifestSchema.properties.officialSubmissionEndsAt.const,
    "2026-07-22T00:00:00.000Z",
  );
  assert.equal(
    manifestSchema.required.includes("officialSubmissionEndsAt"),
    true,
  );
  assert.equal(inputSchema.$defs.skippedCheck.additionalProperties, false);
  assert.equal(inputSchema.properties.schemaVersion.const, 1);
  assert.equal(inputSchema.$defs.evidence.oneOf.length, 7);
  assert.equal(inputSchema.$defs.submissionFieldDetails.oneOf.length, 5);
  for (const name of [
    "projectDetails",
    "technologyDetails",
    "trackDetails",
    "descriptionDetails",
    "feedbackDetails",
    "provenanceDetails",
    "devpostDetails",
    "videoDetails",
    "repositoryDetails",
    "judgeAccessDetails",
    "rightsDetails",
  ]) {
    assert.equal(inputSchema.$defs[name].additionalProperties, false, name);
  }
  assert.equal(manifestSchema.$id.endsWith("manifest-v2.json"), true);
  assert.equal(manifestSchema.properties.schemaVersion.const, 2);
  assert.equal(envelopeSchema.additionalProperties, false);
  assert.equal(envelopeSchema.required.includes("bindingSha256"), true);
  assert.equal(envelopeSchema.allOf.length, 7);
  assert.equal(
    envelopeSchema.$defs.technologyObservation.required.includes("responseId"),
    true,
  );
  assert.equal(envelopeSchema.$defs.submissionFieldObservation.oneOf.length, 5);
  assert.equal(envelopeSchema.$defs.observation.oneOf.length, 11);
  const observationShapes = envelopeSchema.$defs.observation.oneOf.flatMap(
    ({ $ref }) => {
      const schema = envelopeSchema.$defs[$ref.split("/").at(-1)];
      return schema.oneOf
        ? schema.oneOf.map(
            (nested) => envelopeSchema.$defs[nested.$ref.split("/").at(-1)],
          )
        : [schema];
    },
  );
  assert.equal(
    observationShapes.every((schema) => schema.additionalProperties === false),
    true,
  );
  const canonicalTrack = {
    sourcePath: "docs/submission/devpost-copy.md",
    sourceSha256: "a".repeat(64),
    track: "Work and Productivity",
  };
  assert.equal(
    satisfiesRequiredShape(
      envelopeSchema.$defs.trackObservation,
      canonicalTrack,
    ),
    true,
  );
  assert.equal(
    observationShapes.some((schema) =>
      satisfiesRequiredShape(schema, {
        observed: true,
        evidenceId: "track",
      }),
    ),
    false,
  );
});

function satisfiesRequiredShape(schema, value) {
  const keys = Object.keys(value);
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    schema.required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => Object.hasOwn(schema.properties, key)) &&
    Object.entries(schema.properties).every(
      ([key, property]) =>
        !Object.hasOwn(value, key) ||
        property.const === undefined ||
        value[key] === property.const,
    )
  );
}
