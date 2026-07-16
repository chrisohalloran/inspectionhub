import {
  requirementIds,
  SUBMISSION_PERIOD_END,
  SUBMISSION_PERIOD_START,
} from "./validation.mjs";

const passedRequirementDescriptors = Object.freeze([
  {
    requirementId: "working_project",
    evidenceId: "working-project",
    artifactKey: "workingProject",
  },
  { requirementId: "track", evidenceId: "track", artifactKey: "track" },
  {
    requirementId: "description",
    evidenceId: "description",
    artifactKey: "description",
  },
  {
    requirementId: "repository",
    evidenceId: "public-repository",
    artifactKey: "repository",
  },
  {
    requirementId: "provenance",
    evidenceId: "submission-period-provenance",
    artifactKey: "provenance",
  },
]);

const descriptorByEvidenceId = new Map(
  passedRequirementDescriptors.map((descriptor) => [
    descriptor.evidenceId,
    descriptor,
  ]),
);
const descriptorByRequirementId = new Map(
  passedRequirementDescriptors.map((descriptor) => [
    descriptor.requirementId,
    descriptor,
  ]),
);

const unprovenReasons = Object.freeze({
  codex_and_gpt56:
    "Codex use is observed, but no successful meaningful live GPT-5.6 product run has been supplied.",
  video: "No logged-out public YouTube observation has been supplied.",
  feedback_session:
    "The actual /feedback Session ID has not been observed from the primary build task.",
  judge_access:
    "The local judge flow works at the observed commit, but future free availability through the full judging period cannot be observed yet.",
  rights_and_safety:
    "Repository rights are documented, but final video asset rights cannot be reviewed before the video exists.",
  devpost_form:
    "The required Devpost fields have not been observed in the external form.",
});

export const observedExpectedBlockers = Object.freeze([
  ...Object.keys(unprovenReasons).map((id) => `${id}_unproven`),
  "skipped_checks_present",
]);

export function createObservedSubmissionEvidence(input) {
  assertObservation(input);
  const provenance = () => ({
    mode: "observed",
    observer: input.observer,
    observedAt: input.endedAt,
  });
  return [
    {
      id: "working-project",
      kind: "project_run",
      claim:
        "The clean public commit passed CI and its local synthetic web test build completed the named-recipient flow.",
      provenance: provenance(),
      details: {
        projectWorking: true,
        installOrRunConsistently: true,
        intendedPlatform: "web judge test build",
        commitSha: input.commitSha,
        ciRunUrl: input.ci.url,
        ciConclusion: input.ci.conclusion,
        localStatuses: input.judgeDemo.statuses,
      },
    },
    {
      id: "track",
      kind: "submission_field",
      claim:
        "The Work and Productivity track is selected in the submission pack.",
      provenance: provenance(),
      details: { field: "track", value: "work_and_productivity" },
    },
    {
      id: "description",
      kind: "submission_field",
      claim:
        "The English submission copy explains InspectionHub features and functionality.",
      provenance: provenance(),
      details: {
        field: "description",
        present: true,
        explainsFeaturesAndFunctionality: true,
        englishOrTranslationProvided: true,
      },
    },
    {
      id: "public-repository",
      kind: "repository_check",
      claim:
        "The public repository, README and AGPL-3.0-only license were observed logged out at the exact commit.",
      provenance: provenance(),
      details: {
        url: input.repository.url,
        finalUrl: input.repository.finalUrl,
        access: "public",
        loggedOut: true,
        status: input.repository.status,
        relevantLicensePresent: true,
        readmeSetupInstructions: true,
        readmeTestInstructions: true,
        readmeSampleDataOrNotNeeded: true,
        readmeCodexCollaborationAndDecisions: true,
        readmeGpt56Integration: true,
        commitSha: input.commitSha,
      },
    },
    {
      id: "submission-period-provenance",
      kind: "submission_field",
      claim:
        "The public repository creation time and public root commit identity place the project inside the official submission period.",
      provenance: provenance(),
      details: {
        field: "provenance",
        createdDuringSubmissionPeriod: true,
        preexistingExtensionDocumented: false,
        rootCommitCount: input.provenance.rootCommitCount,
        rootCommitSha: input.provenance.rootCommitSha,
        rootCommitAt: input.provenance.rootCommitAt,
        publicRootCommitSha: input.provenance.publicRootCommitSha,
        repositoryCreatedAt: input.provenance.repositoryCreatedAt,
      },
    },
  ];
}

export function createObservedSubmissionInput(input) {
  assertArtifacts(input?.artifacts);
  const evidence = createObservedSubmissionEvidence(input).map((record) => ({
    ...record,
    artifact:
      input.artifacts[descriptorByEvidenceId.get(record.id).artifactKey],
  }));
  return assembleObservedSubmissionInput(input, evidence);
}

export function assembleObservedSubmissionInput(input, evidence) {
  assertObservation(input);
  assertMaterializedEvidence(evidence);
  return {
    schemaVersion: 1,
    run: {
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      commitSha: input.commitSha,
    },
    evidence,
    requirements: requirementIds.map((id) => {
      const descriptor = descriptorByRequirementId.get(id);
      if (descriptor) {
        return {
          id,
          status: "pass",
          evidenceIds: [descriptor.evidenceId],
          reason: "Observed and checksum-backed by the bounded evidence run.",
        };
      }
      return {
        id,
        status: "unproven",
        evidenceIds: [],
        reason: unprovenReasons[id],
      };
    }),
    skippedChecks: Object.entries(unprovenReasons).map(([id, reason]) => ({
      id,
      reason,
    })),
  };
}

function assertObservation(input) {
  if (!/^[a-f0-9]{40,64}$/u.test(input?.commitSha ?? "")) {
    throw new Error(
      "Observed submission input requires an immutable commit SHA",
    );
  }
  if (
    input?.ci?.conclusion !== "success" ||
    input.ci.headSha !== input.commitSha
  ) {
    throw new Error("Public CI must succeed for the exact observed commit");
  }
  if (
    input?.repository?.status !== 200 ||
    input.repository.loggedOut !== true ||
    input.repository.headSha !== input.commitSha ||
    typeof input.repository.finalUrl !== "string"
  ) {
    throw new Error(
      "The exact public repository commit must be observed logged out",
    );
  }
  for (const status of ["root", "invitation", "otp", "report"]) {
    const expected = status === "root" || status === "report" ? 200 : 303;
    if (input?.judgeDemo?.statuses?.[status] !== expected) {
      throw new Error(`Judge demo ${status} status must be ${expected}`);
    }
  }
  if (
    input?.judgeDemo?.expectedContentPresent !== true ||
    input?.judgeDemo?.exitCode !== 0
  ) {
    throw new Error("Judge demo content and clean shutdown must be observed");
  }
  const rootCommitAt = Date.parse(input?.provenance?.rootCommitAt ?? "");
  const repositoryCreatedAt = Date.parse(
    input?.provenance?.repositoryCreatedAt ?? "",
  );
  if (
    !Number.isFinite(rootCommitAt) ||
    rootCommitAt < Date.parse(SUBMISSION_PERIOD_START) ||
    rootCommitAt > Date.parse(SUBMISSION_PERIOD_END) ||
    !Number.isFinite(repositoryCreatedAt) ||
    repositoryCreatedAt < Date.parse(SUBMISSION_PERIOD_START) ||
    repositoryCreatedAt > Date.parse(SUBMISSION_PERIOD_END) ||
    input?.provenance?.publicRootCommitSha !==
      input?.provenance?.rootCommitSha ||
    input?.provenance?.rootCommitCount !== 1
  ) {
    throw new Error(
      "Public repository creation and root commit provenance must match the official submission period",
    );
  }
}

function assertArtifacts(artifacts) {
  for (const descriptor of passedRequirementDescriptors) {
    const artifact = artifacts?.[descriptor.artifactKey];
    if (!isArtifactReference(artifact)) {
      throw new Error(
        `Observed ${descriptor.artifactKey} artifact is missing or unsafe`,
      );
    }
  }
}

function assertMaterializedEvidence(evidence) {
  if (
    !Array.isArray(evidence) ||
    evidence.length !== descriptorByEvidenceId.size
  ) {
    throw new Error(
      "Observed evidence must contain every bounded pass exactly once",
    );
  }
  const seen = new Set();
  for (const record of evidence) {
    if (
      !descriptorByEvidenceId.has(record?.id) ||
      seen.has(record.id) ||
      !isArtifactReference(record.artifact)
    ) {
      throw new Error(
        "Observed evidence is missing, duplicated or unmaterialized",
      );
    }
    seen.add(record.id);
  }
}

function isArtifactReference(artifact) {
  return Boolean(
    typeof artifact?.path === "string" &&
    artifact.path.startsWith("artifacts/validation/") &&
    /^[a-f0-9]{64}$/u.test(artifact.sha256 ?? ""),
  );
}
