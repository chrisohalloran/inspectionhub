import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { canonicalJson } from "../demo-seed/generate.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const commitPattern = /^[a-f0-9]{40,64}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const judgingEndsAt = "2026-08-06T00:00:00.000Z";

export const requirementIds = Object.freeze([
  "working_project",
  "codex_and_gpt56",
  "track",
  "description",
  "video",
  "repository",
  "feedback_session",
  "judge_access",
  "provenance",
  "rights_and_safety",
  "devpost_form",
]);

const allowedKinds = Object.freeze({
  working_project: ["project_run"],
  codex_and_gpt56: ["technology_use"],
  track: ["submission_field"],
  description: ["submission_field"],
  video: ["video_check"],
  repository: ["repository_check"],
  feedback_session: ["submission_field"],
  judge_access: ["judge_access_check"],
  provenance: ["submission_field"],
  rights_and_safety: ["rights_review"],
  devpost_form: ["submission_field"],
});

const evidenceKinds = new Set([
  "project_run",
  "technology_use",
  "submission_field",
  "video_check",
  "repository_check",
  "judge_access_check",
  "rights_review",
]);

const topLevelKeys = new Set([
  "schemaVersion",
  "run",
  "evidence",
  "requirements",
  "skippedChecks",
]);

export function defaultSubmissionInput({ now, commitSha }) {
  return {
    schemaVersion: 1,
    run: {
      startedAt: now,
      endedAt: now,
      commitSha,
    },
    evidence: [],
    requirements: requirementIds.map((id) => ({
      id,
      status: "unproven",
      evidenceIds: [],
      reason: "No observed Devpost submission evidence has been supplied.",
    })),
    skippedChecks: [
      {
        id: "official-submission-observations",
        reason:
          "Working-project, GPT-5.6, video, repository, judge-access and Devpost form observations have not been supplied.",
      },
    ],
  };
}

export async function validateAndBuildSubmissionManifest(input, options = {}) {
  const errors = [];
  validateTopLevel(input, errors);
  validateRun(input?.run, errors);
  const evidenceById = validateEvidence(input?.evidence, errors);
  const requirements = validateRequirements(
    input?.requirements,
    evidenceById,
    errors,
  );
  validateSkippedChecks(input?.skippedChecks, errors);

  if (options.verifyArtifacts !== false) {
    await verifyEvidenceArtifacts(evidenceById, errors);
  }

  const unproven = requirements.filter((item) => item.status !== "pass");
  const immutableCommit = commitPattern.test(input?.run?.commitSha ?? "");
  const ready =
    errors.length === 0 &&
    options.verifyArtifacts !== false &&
    immutableCommit &&
    unproven.length === 0;
  const blockers = [];
  if (errors.length > 0) blockers.push("validation_errors_present");
  if (!immutableCommit) blockers.push("immutable_commit_sha_missing");
  if (options.verifyArtifacts === false)
    blockers.push("artifact_verification_bypassed");
  blockers.push(...unproven.map((item) => `${item.id}_unproven`));

  const payload = {
    schemaVersion: 1,
    milestone: "devpost_submission_preflight",
    outcome: ready ? "ready" : "blocked",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    officialJudgingEndsAt: judgingEndsAt,
    run: input?.run ?? null,
    evidence: input?.evidence ?? [],
    requirements,
    skippedChecks: input?.skippedChecks ?? [],
    blockers: [...new Set(blockers)].sort(),
    validationErrors: errors,
  };
  const payloadSha256 = sha256(canonicalJson(payload));
  return {
    valid: errors.length === 0,
    ready,
    manifest: {
      ...payload,
      integrity: {
        algorithm: "sha256",
        canonicalPayloadSha256: payloadSha256,
      },
      readinessEvent: ready
        ? {
            eventType: "devpost_submission.preflight.ready",
            occurredAt: payload.generatedAt,
            manifestPayloadSha256: payloadSha256,
          }
        : null,
    },
  };
}

function validateTopLevel(input, errors) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push("Submission evidence input must be an object");
    return;
  }
  if (input.schemaVersion !== 1) errors.push("schemaVersion must be exactly 1");
  for (const key of Object.keys(input)) {
    if (!topLevelKeys.has(key)) {
      errors.push(`Unknown top-level field: ${key}`);
    }
  }
}

function validateRun(run, errors) {
  if (!run || typeof run !== "object") {
    errors.push("run is required");
    return;
  }
  for (const key of ["startedAt", "endedAt"]) {
    if (!isIsoDate(run[key]))
      errors.push(`run.${key} must be an ISO timestamp`);
  }
  if (
    isIsoDate(run.startedAt) &&
    isIsoDate(run.endedAt) &&
    Date.parse(run.endedAt) < Date.parse(run.startedAt)
  ) {
    errors.push("run.endedAt cannot precede run.startedAt");
  }
}

function validateEvidence(records, errors) {
  const byId = new Map();
  if (!Array.isArray(records)) {
    errors.push("evidence must be an array");
    return byId;
  }
  for (const record of records) {
    if (!record || typeof record !== "object") {
      errors.push("Every evidence record must be an object");
      continue;
    }
    if (typeof record.id !== "string" || record.id.length < 3) {
      errors.push("Every evidence record requires an id");
      continue;
    }
    if (byId.has(record.id)) {
      errors.push(`Duplicate evidence id: ${record.id}`);
      continue;
    }
    byId.set(record.id, record);
    if (!evidenceKinds.has(record.kind))
      errors.push(`Evidence ${record.id} has an invalid kind`);
    if (typeof record.claim !== "string" || record.claim.length < 10)
      errors.push(`Evidence ${record.id} requires a bounded claim`);
    if (
      record.provenance?.mode !== "observed" ||
      typeof record.provenance?.observer !== "string" ||
      record.provenance.observer.length < 3 ||
      !isIsoDate(record.provenance?.observedAt)
    ) {
      errors.push(`Evidence ${record.id} requires observed provenance`);
    }
    if (!isSafeArtifact(record.artifact))
      errors.push(
        `Evidence ${record.id} requires a safe checksum-backed artifact`,
      );
    validateEvidenceDetails(record, errors);
  }
  return byId;
}

function validateEvidenceDetails(record, errors) {
  const details = record.details ?? {};
  if (record.kind === "project_run") {
    if (
      details.projectWorking !== true ||
      details.installOrRunConsistently !== true ||
      typeof details.intendedPlatform !== "string" ||
      details.intendedPlatform.length < 2
    ) {
      errors.push(
        `Project evidence ${record.id} does not prove a working project`,
      );
    }
  }
  if (record.kind === "technology_use") {
    if (
      details.codexMeaningfulUse !== true ||
      details.gpt56MeaningfulLiveUse !== true ||
      details.liveRunSucceeded !== true ||
      details.model !== "gpt-5.6"
    ) {
      errors.push(
        `Technology evidence ${record.id} does not prove meaningful Codex and GPT-5.6 use`,
      );
    }
  }
  if (record.kind === "submission_field") {
    validateSubmissionField(record, errors);
  }
  if (record.kind === "video_check") {
    if (
      !isYouTubeUrl(details.url) ||
      !isYouTubeUrl(details.finalUrl) ||
      details.public !== true ||
      details.loggedOut !== true ||
      !Number.isInteger(details.status) ||
      details.status < 200 ||
      details.status >= 300 ||
      typeof details.expectedContent !== "string" ||
      details.expectedContent.length < 3 ||
      details.expectedContentPresent !== true ||
      !Number.isFinite(details.durationSeconds) ||
      details.durationSeconds <= 0 ||
      details.durationSeconds >= 180 ||
      details.workingProjectShown !== true ||
      details.audioPresent !== true ||
      details.coversWhatWasBuilt !== true ||
      details.coversCodexUse !== true ||
      details.coversGpt56Use !== true ||
      details.englishOrTranslationProvided !== true
    ) {
      errors.push(
        `Video evidence ${record.id} does not meet the official public demo contract`,
      );
    }
  }
  if (record.kind === "repository_check") {
    const privateShared =
      details.access === "private_shared" &&
      Array.isArray(details.sharedWith) &&
      ["testing@devpost.com", "build-week-event@openai.com"].every((email) =>
        details.sharedWith.includes(email),
      );
    const publicObserved =
      details.access === "public" &&
      details.loggedOut === true &&
      Number.isInteger(details.status) &&
      details.status >= 200 &&
      details.status < 400;
    if (
      !isHttpsUrl(details.url) ||
      (!privateShared && !publicObserved) ||
      (details.access === "public" &&
        details.relevantLicensePresent !== true) ||
      details.readmeSetupInstructions !== true ||
      details.readmeTestInstructions !== true ||
      details.readmeSampleDataOrNotNeeded !== true ||
      details.readmeCodexCollaborationAndDecisions !== true ||
      details.readmeGpt56Integration !== true
    ) {
      errors.push(
        `Repository evidence ${record.id} does not meet the official access and README contract`,
      );
    }
  }
  if (record.kind === "judge_access_check") {
    const accessKinds = new Set([
      "website",
      "functioning_demo",
      "test_build",
      "sandbox",
      "test_account",
    ]);
    if (
      !accessKinds.has(details.kind) ||
      (typeof details.url !== "string" &&
        typeof details.instructions !== "string") ||
      (typeof details.url === "string" && !isHttpsUrl(details.url)) ||
      details.observedWorking !== true ||
      details.freeOfCharge !== true ||
      details.availableWithoutRestriction !== true ||
      !isIsoDate(details.availableThrough) ||
      Date.parse(details.availableThrough) < Date.parse(judgingEndsAt) ||
      (details.credentialsRequired === true &&
        details.credentialsReferencePresent !== true)
    ) {
      errors.push(
        `Judge-access evidence ${record.id} does not prove a working free path through judging`,
      );
    }
  }
  if (record.kind === "rights_review") {
    if (
      details.entrantOwnsSubmission !== true ||
      details.thirdPartyUseAuthorized !== true ||
      details.videoContainsNoUnlicensedAssets !== true
    ) {
      errors.push(
        `Rights evidence ${record.id} does not prove the submission rights contract`,
      );
    }
  }
}

function validateSubmissionField(record, errors) {
  const details = record.details ?? {};
  const valid =
    (details.field === "track" &&
      new Set([
        "apps_for_your_life",
        "work_and_productivity",
        "developer_tools",
        "education",
      ]).has(details.value)) ||
    (details.field === "description" &&
      details.present === true &&
      details.explainsFeaturesAndFunctionality === true &&
      details.englishOrTranslationProvided === true) ||
    (details.field === "feedback_session" &&
      typeof details.sessionId === "string" &&
      /^[A-Za-z0-9-]{8,}$/u.test(details.sessionId) &&
      details.fromPrimaryBuildThread === true) ||
    (details.field === "provenance" &&
      (details.createdDuringSubmissionPeriod === true ||
        details.preexistingExtensionDocumented === true)) ||
    (details.field === "devpost_form" &&
      details.requiredFieldsComplete === true);
  if (!valid)
    errors.push(
      `Submission-field evidence ${record.id} is incomplete or unsupported`,
    );
}

function validateRequirements(records, evidenceById, errors) {
  const expected = new Set(requirementIds);
  const seen = new Set();
  if (!Array.isArray(records)) {
    errors.push("requirements must be an array");
    records = [];
  }
  for (const record of records) {
    if (!record || !expected.has(record.id)) {
      errors.push(
        `Unknown submission requirement: ${record?.id ?? "<missing>"}`,
      );
      continue;
    }
    if (seen.has(record.id))
      errors.push(`Duplicate submission requirement: ${record.id}`);
    seen.add(record.id);
    if (!new Set(["pass", "fail", "unproven"]).has(record.status))
      errors.push(`Submission requirement ${record.id} has an invalid status`);
    if (!Array.isArray(record.evidenceIds)) {
      errors.push(`Submission requirement ${record.id} requires evidenceIds`);
      continue;
    }
    for (const evidenceId of record.evidenceIds) {
      if (!evidenceById.has(evidenceId))
        errors.push(
          `Submission requirement ${record.id} references missing evidence ${evidenceId}`,
        );
    }
    if (record.status === "pass") {
      const observedKinds = new Set(
        record.evidenceIds.map((id) => evidenceById.get(id)?.kind),
      );
      if (
        !(allowedKinds[record.id] ?? []).some((kind) => observedKinds.has(kind))
      ) {
        errors.push(
          `Submission requirement ${record.id} lacks allowed observed evidence`,
        );
      }
      if (record.id === "track")
        requireSubmissionField(record, evidenceById, "track", errors);
      if (record.id === "description")
        requireSubmissionField(record, evidenceById, "description", errors);
      if (record.id === "feedback_session")
        requireSubmissionField(
          record,
          evidenceById,
          "feedback_session",
          errors,
        );
      if (record.id === "provenance")
        requireSubmissionField(record, evidenceById, "provenance", errors);
      if (record.id === "devpost_form")
        requireSubmissionField(record, evidenceById, "devpost_form", errors);
    }
  }
  for (const id of requirementIds) {
    if (!seen.has(id)) errors.push(`Missing submission requirement: ${id}`);
  }
  return requirementIds.map((id) => {
    const record = records.find((item) => item?.id === id);
    return {
      id,
      status: record?.status ?? "unproven",
      evidenceIds: record?.evidenceIds ?? [],
      reason: record?.reason ?? "Missing requirement result",
    };
  });
}

function requireSubmissionField(record, evidenceById, field, errors) {
  if (
    !record.evidenceIds.some(
      (id) =>
        evidenceById.get(id)?.kind === "submission_field" &&
        evidenceById.get(id)?.details?.field === field,
    )
  ) {
    errors.push(
      `Submission requirement ${record.id} lacks ${field} field evidence`,
    );
  }
}

function validateSkippedChecks(records, errors) {
  if (!Array.isArray(records)) {
    errors.push("skippedChecks must be an array");
    return;
  }
  for (const record of records) {
    if (typeof record?.id !== "string" || typeof record?.reason !== "string")
      errors.push("skippedChecks records require id and reason");
  }
}

async function verifyEvidenceArtifacts(evidenceById, errors) {
  for (const evidence of evidenceById.values()) {
    if (!isSafeArtifact(evidence.artifact)) continue;
    const path = resolve(repositoryRoot, evidence.artifact.path);
    if (relative(repositoryRoot, path).startsWith("..")) {
      errors.push(`Evidence ${evidence.id} artifact escapes the repository`);
      continue;
    }
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("not a file");
      const bytes = await readFile(path);
      if (sha256(bytes) !== evidence.artifact.sha256)
        errors.push(`Evidence ${evidence.id} artifact checksum does not match`);
    } catch {
      errors.push(
        `Evidence ${evidence.id} artifact is unreadable: ${evidence.artifact.path}`,
      );
    }
  }
}

function isSafeArtifact(artifact) {
  return Boolean(
    artifact &&
    typeof artifact.path === "string" &&
    artifact.path.startsWith("artifacts/validation/") &&
    !isAbsolute(artifact.path) &&
    !artifact.path.split("/").includes("..") &&
    hashPattern.test(artifact.sha256 ?? ""),
  );
}

function isHttpsUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isYouTubeUrl(raw) {
  if (!isHttpsUrl(raw)) return false;
  const hostname = new URL(raw).hostname.toLowerCase();
  return (
    hostname === "youtu.be" ||
    hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com")
  );
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
