import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { canonicalJson, sha256 } from "../demo-seed/generate.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const commitPattern = /^[a-f0-9]{40,64}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const descriptionSourcePath = "docs/submission/devpost-copy.md";
const descriptionSectionSpecs = Object.freeze({
  oneLine: Object.freeze({
    heading: "One-line description",
    minimumLength: 50,
    maximumLength: 600,
    minimumWords: 10,
  }),
  whatWeBuilt: Object.freeze({
    heading: "What we built",
    minimumLength: 250,
    maximumLength: 6_000,
    minimumWords: 40,
  }),
  codexAndGpt: Object.freeze({
    heading: "How we used Codex and GPT-5.6",
    minimumLength: 120,
    maximumLength: 4_000,
    minimumWords: 20,
  }),
});
export const SUBMISSION_PERIOD_START = "2026-07-13T16:00:00.000Z";
export const SUBMISSION_PERIOD_END = "2026-07-22T00:00:00.000Z";
export const JUDGING_ACCESS_END = "2026-08-06T00:00:00.000Z";

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

const runKeys = new Set(["startedAt", "endedAt", "commitSha"]);
const evidenceKeys = new Set([
  "id",
  "kind",
  "claim",
  "provenance",
  "artifact",
  "details",
]);
const provenanceKeys = new Set(["mode", "observer", "observedAt"]);
const artifactKeys = new Set(["path", "sha256"]);
const requirementKeys = new Set(["id", "status", "evidenceIds", "reason"]);
const skippedCheckKeys = new Set(["id", "reason"]);
const envelopeKeys = new Set([
  "schemaVersion",
  "evidenceId",
  "evidenceKind",
  "commitSha",
  "observedAt",
  "bindingSha256",
  "observation",
]);

const detailKeys = Object.freeze({
  project_run: new Set([
    "projectWorking",
    "installOrRunConsistently",
    "intendedPlatform",
    "commitSha",
    "ciRunUrl",
    "ciConclusion",
    "localStatuses",
  ]),
  technology_use: new Set([
    "codexMeaningfulUse",
    "gpt56MeaningfulLiveUse",
    "liveRunSucceeded",
    "model",
  ]),
  video_check: new Set([
    "url",
    "finalUrl",
    "public",
    "loggedOut",
    "status",
    "expectedContent",
    "expectedContentPresent",
    "durationSeconds",
    "workingProjectShown",
    "audioPresent",
    "coversWhatWasBuilt",
    "coversCodexUse",
    "coversGpt56Use",
    "englishOrTranslationProvided",
  ]),
  repository_check: new Set([
    "url",
    "finalUrl",
    "access",
    "loggedOut",
    "status",
    "sharedWith",
    "relevantLicensePresent",
    "readmeSetupInstructions",
    "readmeTestInstructions",
    "readmeSampleDataOrNotNeeded",
    "readmeCodexCollaborationAndDecisions",
    "readmeGpt56Integration",
    "commitSha",
  ]),
  judge_access_check: new Set([
    "kind",
    "url",
    "finalUrl",
    "loggedOut",
    "status",
    "expectedContentPresent",
    "instructions",
    "observedWorking",
    "freeOfCharge",
    "availableWithoutRestriction",
    "availableThrough",
    "credentialsRequired",
    "credentialsReferencePresent",
    "commitSha",
  ]),
  rights_review: new Set([
    "entrantOwnsSubmission",
    "thirdPartyUseAuthorized",
    "videoContainsNoUnlicensedAssets",
  ]),
});

const submissionFieldDetailKeys = Object.freeze({
  track: new Set(["field", "value"]),
  description: new Set([
    "field",
    "present",
    "explainsFeaturesAndFunctionality",
    "englishOrTranslationProvided",
  ]),
  feedback_session: new Set(["field", "sessionId", "fromPrimaryBuildThread"]),
  provenance: new Set([
    "field",
    "createdDuringSubmissionPeriod",
    "preexistingExtensionDocumented",
    "rootCommitCount",
    "rootCommitSha",
    "rootCommitAt",
    "publicRootCommitSha",
    "repositoryCreatedAt",
  ]),
  devpost_form: new Set(["field", "requiredFieldsComplete"]),
});

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
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  validateTopLevel(input, errors);
  validateRun(input?.run, errors);
  validateGeneratedAt(generatedAt, input?.run, errors);
  const evidenceById = validateEvidence(
    input?.evidence,
    input?.run,
    generatedAt,
    errors,
  );
  const requirements = validateRequirements(
    input?.requirements,
    evidenceById,
    errors,
  );
  validateSkippedChecks(input?.skippedChecks, errors);

  const artifactObservations =
    options.verifyArtifacts !== false
      ? await verifyEvidenceArtifacts(evidenceById, input?.run, errors)
      : new Map();
  validateVerifiedExternalObservations(
    requirements,
    evidenceById,
    artifactObservations,
    input?.run,
    options.verifiedExternalObservations,
    errors,
  );

  const unproven = requirements.filter((item) => item.status !== "pass");
  const immutableCommit = commitPattern.test(input?.run?.commitSha ?? "");
  const skippedChecksPresent = (input?.skippedChecks?.length ?? 0) > 0;
  const submissionPeriodClosed =
    (isIsoDate(input?.run?.endedAt) &&
      Date.parse(input.run.endedAt) > Date.parse(SUBMISSION_PERIOD_END)) ||
    (isIsoDate(generatedAt) &&
      Date.parse(generatedAt) > Date.parse(SUBMISSION_PERIOD_END));
  const ready =
    errors.length === 0 &&
    options.verifyArtifacts !== false &&
    immutableCommit &&
    !skippedChecksPresent &&
    !submissionPeriodClosed &&
    unproven.length === 0;
  const blockers = [];
  if (errors.length > 0) blockers.push("validation_errors_present");
  if (!immutableCommit) blockers.push("immutable_commit_sha_missing");
  if (options.verifyArtifacts === false)
    blockers.push("artifact_verification_bypassed");
  if (skippedChecksPresent) blockers.push("skipped_checks_present");
  if (submissionPeriodClosed) blockers.push("submission_period_closed");
  blockers.push(...unproven.map((item) => `${item.id}_unproven`));

  const payload = {
    schemaVersion: 2,
    milestone: "devpost_submission_preflight",
    outcome: ready ? "ready" : "blocked",
    generatedAt,
    officialSubmissionEndsAt: SUBMISSION_PERIOD_END,
    officialJudgingEndsAt: JUDGING_ACCESS_END,
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
  if (!isPlainObject(run)) {
    errors.push("run is required");
    return;
  }
  rejectUnknownKeys(run, runKeys, "run", errors);
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
  if (!commitPattern.test(run.commitSha ?? "")) {
    errors.push("run.commitSha must be an immutable commit SHA");
  }
}

function validateGeneratedAt(generatedAt, run, errors) {
  if (!isIsoDate(generatedAt)) {
    errors.push("generatedAt must be an ISO timestamp");
    return;
  }
  if (
    isIsoDate(run?.endedAt) &&
    Date.parse(generatedAt) < Date.parse(run.endedAt)
  ) {
    errors.push("generatedAt cannot precede run.endedAt");
  }
}

function validateEvidence(records, run, generatedAt, errors) {
  const byId = new Map();
  if (!Array.isArray(records)) {
    errors.push("evidence must be an array");
    return byId;
  }
  for (const record of records) {
    if (!isPlainObject(record)) {
      errors.push("Every evidence record must be an object");
      continue;
    }
    rejectUnknownKeys(record, evidenceKeys, `Evidence ${record.id}`, errors);
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
      !isPlainObject(record.provenance) ||
      record.provenance.mode !== "observed" ||
      typeof record.provenance?.observer !== "string" ||
      record.provenance.observer.length < 3 ||
      !isIsoDate(record.provenance?.observedAt)
    ) {
      errors.push(`Evidence ${record.id} requires observed provenance`);
    } else {
      rejectUnknownKeys(
        record.provenance,
        provenanceKeys,
        `Evidence ${record.id} provenance`,
        errors,
      );
      const observedAt = Date.parse(record.provenance.observedAt);
      if (
        isIsoDate(run?.startedAt) &&
        isIsoDate(run?.endedAt) &&
        (observedAt < Date.parse(run.startedAt) ||
          observedAt > Date.parse(run.endedAt))
      ) {
        errors.push(
          `Evidence ${record.id} observedAt must fall within the evidence run`,
        );
      }
      if (isIsoDate(generatedAt) && observedAt > Date.parse(generatedAt)) {
        errors.push(`Evidence ${record.id} observedAt cannot be in the future`);
      }
    }
    if (!isSafeArtifact(record.artifact)) {
      errors.push(
        `Evidence ${record.id} requires a safe checksum-backed artifact`,
      );
    } else {
      rejectUnknownKeys(
        record.artifact,
        artifactKeys,
        `Evidence ${record.id} artifact`,
        errors,
      );
    }
    validateEvidenceDetails(record, run, errors);
  }
  return byId;
}

function validateEvidenceDetails(record, run, errors) {
  const details = record.details ?? {};
  if (!isPlainObject(details)) {
    errors.push(`Evidence ${record.id} details must be an object`);
    return;
  }
  const allowedDetailKeys =
    record.kind === "submission_field"
      ? submissionFieldDetailKeys[details.field]
      : detailKeys[record.kind];
  if (allowedDetailKeys) {
    rejectUnknownKeys(
      details,
      allowedDetailKeys,
      `Evidence ${record.id} details`,
      errors,
    );
  }
  if (record.kind === "project_run") {
    if (
      details.projectWorking !== true ||
      details.installOrRunConsistently !== true ||
      typeof details.intendedPlatform !== "string" ||
      details.intendedPlatform.length < 2 ||
      details.commitSha !== run?.commitSha
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
    validateSubmissionField(record, run, errors);
  }
  if (record.kind === "video_check") {
    const sourceVideoId = youtubeVideoId(details.url);
    const finalVideoId = youtubeVideoId(details.finalUrl);
    if (
      sourceVideoId === null ||
      finalVideoId === null ||
      sourceVideoId !== finalVideoId ||
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
    const cleanRepositoryIdentity =
      isCleanHttpsUrl(details.url) &&
      isCleanHttpsUrl(details.finalUrl) &&
      sameUrlIdentity(details.url, details.finalUrl);
    const privateShared =
      details.access === "private_shared" &&
      cleanRepositoryIdentity &&
      details.loggedOut === false &&
      details.status === 200 &&
      Array.isArray(details.sharedWith) &&
      exactReviewerEmails(details.sharedWith);
    const publicObserved =
      details.access === "public" &&
      cleanRepositoryIdentity &&
      details.loggedOut === true &&
      Number.isInteger(details.status) &&
      details.status === 200;
    if (
      details.commitSha !== run?.commitSha ||
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
    const hasInstructions =
      typeof details.instructions === "string" &&
      details.instructions.trim().length >= 20;
    const hasObservedUrl =
      isCleanHttpsUrl(details.url) &&
      isCleanHttpsUrl(details.finalUrl) &&
      sameUrlIdentity(details.url, details.finalUrl) &&
      details.loggedOut === true &&
      Number.isInteger(details.status) &&
      details.status >= 200 &&
      details.status < 300 &&
      details.expectedContentPresent === true;
    if (
      !accessKinds.has(details.kind) ||
      (!hasInstructions && !hasObservedUrl) ||
      (typeof details.url === "string" && !hasObservedUrl) ||
      (typeof details.instructions === "string" && !hasInstructions) ||
      details.commitSha !== run?.commitSha ||
      details.observedWorking !== true ||
      details.freeOfCharge !== true ||
      details.availableWithoutRestriction !== true ||
      !isIsoDate(details.availableThrough) ||
      Date.parse(details.availableThrough) < Date.parse(JUDGING_ACCESS_END) ||
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

function validateSubmissionField(record, run, errors) {
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
      details.createdDuringSubmissionPeriod === true &&
      details.preexistingExtensionDocumented === false &&
      details.rootCommitCount === 1 &&
      commitPattern.test(details.rootCommitSha ?? "") &&
      details.publicRootCommitSha === details.rootCommitSha &&
      isIsoDate(details.rootCommitAt) &&
      isIsoDate(details.repositoryCreatedAt) &&
      Date.parse(details.rootCommitAt) >= Date.parse(SUBMISSION_PERIOD_START) &&
      Date.parse(details.rootCommitAt) <= Date.parse(SUBMISSION_PERIOD_END) &&
      Date.parse(details.repositoryCreatedAt) >=
        Date.parse(SUBMISSION_PERIOD_START) &&
      Date.parse(details.repositoryCreatedAt) <=
        Date.parse(SUBMISSION_PERIOD_END) &&
      (!isIsoDate(run?.endedAt) ||
        (Date.parse(details.rootCommitAt) <= Date.parse(run.endedAt) &&
          Date.parse(details.repositoryCreatedAt) <=
            Date.parse(run.endedAt)))) ||
    (details.field === "devpost_form" &&
      details.requiredFieldsComplete === true);
  if (!valid)
    errors.push(
      `Submission-field evidence ${record.id} is incomplete or unsupported`,
    );
}

export function deriveSubmissionDescriptionObservation(sourceText) {
  if (
    typeof sourceText !== "string" ||
    sourceText.length < 400 ||
    sourceText.length > 30_000 ||
    sourceText.includes("\0")
  ) {
    return null;
  }
  const headings = [
    ...sourceText.matchAll(/^##[ \t]+([^\r\n]+?)[ \t]*\r?$/gmu),
  ];
  const sections = {};
  for (const [key, spec] of Object.entries(descriptionSectionSpecs)) {
    const matches = headings.filter(
      (match) => match[1].trim() === spec.heading,
    );
    if (matches.length !== 1) return null;
    const [match] = matches;
    const nextHeading = headings.find(
      (candidate) => candidate.index > match.index,
    );
    const bodyStart = match.index + match[0].length;
    const body = sourceText
      .slice(bodyStart, nextHeading?.index ?? sourceText.length)
      .trim();
    if (
      body.length < spec.minimumLength ||
      body.length > spec.maximumLength ||
      markdownWordCount(body) < spec.minimumWords
    ) {
      return null;
    }
    sections[key] = body;
  }
  const sectionLengths = Object.fromEntries(
    Object.entries(sections).map(([key, body]) => [key, body.length]),
  );
  return {
    sections,
    sectionLengths,
    englishDescriptionPresent: Object.values(sections).every(
      conservativeEnglishText,
    ),
    featuresAndFunctionalityPresent: describesConcreteProduct(sections),
  };
}

function markdownWords(text) {
  return text.match(/[A-Za-z]+(?:[-'][A-Za-z0-9]+)*|GPT-5\.6/gu) ?? [];
}

function markdownWordCount(text) {
  return markdownWords(text).length;
}

function conservativeEnglishText(text) {
  const letters = text.match(/\p{L}/gu) ?? [];
  const asciiLetters = text.match(/[A-Za-z]/gu) ?? [];
  if (letters.length === 0 || asciiLetters.length / letters.length < 0.95) {
    return false;
  }
  const commonEnglishWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "inside",
    "is",
    "it",
    "not",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "was",
    "where",
    "with",
  ]);
  const words = markdownWords(text).map((word) => word.toLowerCase());
  const commonCount = words.filter((word) =>
    commonEnglishWords.has(word),
  ).length;
  return words.length >= 10 && commonCount >= 2 && /[.!?](?:\s|$)/u.test(text);
}

function describesConcreteProduct(sections) {
  const oneLine = sections.oneLine.toLowerCase();
  const whatWeBuilt = sections.whatWeBuilt.toLowerCase();
  const codexAndGpt = sections.codexAndGpt.toLowerCase();
  const featureTerms = [
    "approval",
    "capture",
    "evidence",
    "field",
    "inspector",
    "photo",
    "recipient",
    "report",
    "review",
    "voice",
    "workflow",
  ];
  const behaviourTerms = [
    "approve",
    "capture",
    "check",
    "deliver",
    "describe",
    "investigate",
    "render",
    "review",
    "save",
    "suggest",
  ];
  const featureCount = featureTerms.filter((term) =>
    whatWeBuilt.includes(term),
  ).length;
  const behaviourCount = behaviourTerms.filter((term) =>
    whatWeBuilt.includes(term),
  ).length;
  return (
    /\binspection\b/u.test(oneLine) &&
    /\b(?:app|platform|system|tool|workflow)\b/u.test(oneLine) &&
    /\b(?:capture|evidence|investigate|report|deliver)\w*\b/u.test(oneLine) &&
    featureCount >= 5 &&
    behaviourCount >= 3 &&
    /\bcodex\b/u.test(codexAndGpt) &&
    /\bgpt-?5\.6\b/u.test(codexAndGpt) &&
    /\b(?:architecture|draft|engineering|implementation|model|planning|responses|tests|verifier)\w*\b/u.test(
      codexAndGpt,
    )
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
    if (!isPlainObject(record)) {
      errors.push("Every submission requirement must be an object");
      continue;
    }
    rejectUnknownKeys(
      record,
      requirementKeys,
      `Submission requirement ${record.id}`,
      errors,
    );
    if (!expected.has(record.id)) {
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
    if (new Set(record.evidenceIds).size !== record.evidenceIds.length) {
      errors.push(
        `Submission requirement ${record.id} has duplicate evidenceIds`,
      );
    }
    if (typeof record.reason !== "string" || record.reason.trim().length < 3) {
      errors.push(`Submission requirement ${record.id} requires a reason`);
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
    if (!isPlainObject(record)) {
      errors.push("skippedChecks records require id and reason");
      continue;
    }
    rejectUnknownKeys(record, skippedCheckKeys, "skippedChecks record", errors);
    if (
      typeof record.id !== "string" ||
      record.id.trim().length < 3 ||
      typeof record.reason !== "string" ||
      record.reason.trim().length < 3
    )
      errors.push("skippedChecks records require id and reason");
  }
}

export function evidenceBindingSha256(evidence, commitSha) {
  return sha256(
    canonicalJson({
      id: evidence?.id,
      kind: evidence?.kind,
      claim: evidence?.claim,
      provenance: evidence?.provenance,
      details: evidence?.details,
      commitSha,
    }),
  );
}

async function verifyEvidenceArtifacts(evidenceById, run, errors) {
  const verifiedObservations = new Map();
  const repositoryRealPath = await realpath(repositoryRoot);
  const validationRealPath = await realpath(
    resolve(repositoryRoot, "artifacts", "validation"),
  ).catch(() => null);
  for (const evidence of evidenceById.values()) {
    if (!isSafeArtifact(evidence.artifact)) continue;
    const path = resolve(repositoryRoot, evidence.artifact.path);
    const relativeToRepository = relative(repositoryRoot, path);
    if (
      relativeToRepository.startsWith(`..${sep}`) ||
      relativeToRepository === ".." ||
      isAbsolute(relativeToRepository)
    ) {
      errors.push(`Evidence ${evidence.id} artifact escapes the repository`);
      continue;
    }
    try {
      await rejectSymlinkPath(path);
      const info = await lstat(path);
      if (!info.isFile()) throw new Error("not a file");
      const realPath = await realpath(path);
      const relativeToRealRepository = relative(repositoryRealPath, realPath);
      const relativeToValidationRoot = validationRealPath
        ? relative(validationRealPath, realPath)
        : "..";
      if (
        relativeToRealRepository.startsWith(`..${sep}`) ||
        relativeToRealRepository === ".." ||
        isAbsolute(relativeToRealRepository) ||
        relativeToValidationRoot.startsWith(`..${sep}`) ||
        relativeToValidationRoot === ".." ||
        isAbsolute(relativeToValidationRoot)
      ) {
        errors.push(`Evidence ${evidence.id} artifact escapes validation root`);
        continue;
      }
      const bytes = await readFile(path);
      if (sha256(bytes) !== evidence.artifact.sha256) {
        errors.push(`Evidence ${evidence.id} artifact checksum does not match`);
        continue;
      }
      let envelope;
      try {
        envelope = JSON.parse(bytes.toString("utf8"));
      } catch {
        errors.push(
          `Evidence ${evidence.id} artifact envelope is invalid JSON`,
        );
        continue;
      }
      if (!isPlainObject(envelope)) {
        errors.push(`Evidence ${evidence.id} artifact envelope is invalid`);
        continue;
      }
      rejectUnknownKeys(
        envelope,
        envelopeKeys,
        `Evidence ${evidence.id} artifact envelope`,
        errors,
      );
      const expectedBinding = evidenceBindingSha256(evidence, run?.commitSha);
      const envelopeBindingInvalid =
        envelope.schemaVersion !== 1 ||
        envelope.evidenceId !== evidence.id ||
        envelope.evidenceKind !== evidence.kind ||
        envelope.commitSha !== run?.commitSha ||
        envelope.observedAt !== evidence.provenance?.observedAt ||
        envelope.bindingSha256 !== expectedBinding ||
        !isPlainObject(envelope.observation);
      if (envelopeBindingInvalid) {
        errors.push(
          `Evidence ${evidence.id} artifact is not bound to its claim and run`,
        );
      }
      const observationIsValid = validateEvidenceObservation(
        evidence,
        envelope.observation,
        run,
        errors,
      );
      if (!envelopeBindingInvalid && observationIsValid) {
        verifiedObservations.set(evidence.id, envelope.observation);
      }
    } catch {
      errors.push(
        `Evidence ${evidence.id} artifact is unreadable: ${evidence.artifact.path}`,
      );
    }
  }
  return verifiedObservations;
}

const externallyVerifiedRequirementKinds = Object.freeze({
  judge_access: Object.freeze({
    kind: "judge_access_check",
    field: null,
  }),
  provenance: Object.freeze({
    kind: "submission_field",
    field: "provenance",
  }),
});

function validateVerifiedExternalObservations(
  requirements,
  evidenceById,
  artifactObservations,
  run,
  context,
  errors,
) {
  const passingExternalRequirements = Object.keys(
    externallyVerifiedRequirementKinds,
  ).filter(
    (id) =>
      requirements.find((requirement) => requirement.id === id)?.status ===
      "pass",
  );
  if (context === undefined) {
    for (const id of passingExternalRequirements) {
      errors.push(
        `Submission requirement ${id} requires non-serialized runtime verification context`,
      );
    }
    return;
  }
  if (!isPlainObject(context)) {
    errors.push("verifiedExternalObservations must be a runtime-only object");
    return;
  }
  rejectUnknownKeys(
    context,
    new Set(Object.keys(externallyVerifiedRequirementKinds)),
    "verifiedExternalObservations",
    errors,
  );

  for (const [id, expected] of Object.entries(
    externallyVerifiedRequirementKinds,
  )) {
    const requirement = requirements.find((item) => item.id === id);
    const supplied = context[id];
    if (requirement?.status !== "pass") {
      if (supplied !== undefined) {
        errors.push(
          `verifiedExternalObservations.${id} cannot authorize a requirement that is not marked pass`,
        );
      }
      continue;
    }
    const candidates = requirement.evidenceIds
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter(
        (evidence) =>
          evidence?.kind === expected.kind &&
          (expected.field === null ||
            evidence?.details?.field === expected.field),
      );
    if (
      candidates.length !== 1 ||
      !validExternalObservationContextRecord(supplied)
    ) {
      errors.push(
        `Submission requirement ${id} lacks exact runtime verification context`,
      );
      continue;
    }
    const [evidence] = candidates;
    const artifactObservation = artifactObservations.get(evidence.id);
    if (
      supplied.evidenceId !== evidence.id ||
      supplied.evidenceKind !== evidence.kind ||
      supplied.commitSha !== run?.commitSha ||
      supplied.observedAt !== evidence.provenance?.observedAt ||
      supplied.artifactSha256 !== evidence.artifact?.sha256 ||
      !artifactObservation ||
      !sameJsonValue(supplied.observation, artifactObservation)
    ) {
      errors.push(
        `Submission requirement ${id} runtime verification context does not match its exact evidence run`,
      );
    }
  }
}

function validExternalObservationContextRecord(record) {
  return (
    exactObject(record, [
      "evidenceId",
      "evidenceKind",
      "commitSha",
      "observedAt",
      "artifactSha256",
      "observation",
    ]) &&
    nonEmptyString(record.evidenceId) &&
    evidenceKinds.has(record.evidenceKind) &&
    commitPattern.test(record.commitSha ?? "") &&
    isIsoDate(record.observedAt) &&
    hashPattern.test(record.artifactSha256 ?? "") &&
    isPlainObject(record.observation)
  );
}

const observationValidatorByKind = Object.freeze({
  project_run: validProjectRunObservation,
  technology_use: validTechnologyUseObservation,
  submission_field: validateSubmissionFieldObservation,
  video_check: validVideoObservation,
  repository_check: validRepositoryObservation,
  judge_access_check: validJudgeAccessObservation,
  rights_review: validRightsReviewObservation,
});

function validateEvidenceObservation(evidence, observation, run, errors) {
  const validator = observationValidatorByKind[evidence.kind];
  const valid =
    typeof validator === "function" &&
    validator(evidence.details ?? {}, observation, run);
  if (!valid) {
    errors.push(
      `Evidence ${evidence.id} artifact observation does not satisfy its strict ${evidence.kind} contract`,
    );
  }
  return valid;
}

function validProjectRunObservation(details, observation, run) {
  return (
    exactObject(observation, [
      "commitSha",
      "ci",
      "cleanBuild",
      "judgeDemo",
      "runtime",
    ]) &&
    observation.commitSha === run?.commitSha &&
    exactObject(observation.ci, [
      "headSha",
      "headBranch",
      "event",
      "workflowPath",
      "conclusion",
      "status",
      "runAttempt",
      "url",
      "runId",
    ]) &&
    observation.ci.headSha === run?.commitSha &&
    observation.ci.headBranch === "main" &&
    observation.ci.event === "push" &&
    observation.ci.workflowPath === ".github/workflows/ci.yml" &&
    observation.ci.conclusion === "success" &&
    observation.ci.status === "completed" &&
    Number.isInteger(observation.ci.runAttempt) &&
    observation.ci.runAttempt > 0 &&
    Number.isInteger(observation.ci.runId) &&
    observation.ci.runId > 0 &&
    isCleanHttpsUrl(observation.ci.url) &&
    details.ciRunUrl === observation.ci.url &&
    details.ciConclusion === observation.ci.conclusion &&
    exactObject(observation.cleanBuild, ["install", "build"]) &&
    validCommandObservation(observation.cleanBuild.install) &&
    validCommandObservation(observation.cleanBuild.build) &&
    exactObject(observation.judgeDemo, [
      "statuses",
      "expectedContentPresent",
      "exitCode",
      "outputTailSha256",
    ]) &&
    exactObject(observation.judgeDemo.statuses, [
      "root",
      "invitation",
      "otp",
      "report",
    ]) &&
    observation.judgeDemo.statuses.root === 200 &&
    observation.judgeDemo.statuses.invitation === 303 &&
    observation.judgeDemo.statuses.otp === 303 &&
    observation.judgeDemo.statuses.report === 200 &&
    observation.judgeDemo.expectedContentPresent === true &&
    observation.judgeDemo.exitCode === 0 &&
    hashPattern.test(observation.judgeDemo.outputTailSha256 ?? "") &&
    sameJsonValue(details.localStatuses, observation.judgeDemo.statuses) &&
    exactObject(observation.runtime, ["node", "pnpm"]) &&
    nonEmptyString(observation.runtime.node) &&
    nonEmptyString(observation.runtime.pnpm)
  );
}

function validTechnologyUseObservation(details, observation) {
  return (
    exactObject(observation, [
      "provider",
      "model",
      "responseId",
      "outputArtifactSha256",
      "store",
      "inspectorConfirmed",
      "sessionId",
    ]) &&
    observation.provider === "openai" &&
    observation.model === details.model &&
    /^resp_[A-Za-z0-9_-]{8,}$/u.test(observation.responseId ?? "") &&
    hashPattern.test(observation.outputArtifactSha256 ?? "") &&
    observation.store === false &&
    observation.inspectorConfirmed === true &&
    /^[A-Za-z0-9-]{8,}$/u.test(observation.sessionId ?? "") &&
    details.codexMeaningfulUse === true &&
    details.gpt56MeaningfulLiveUse === true &&
    details.liveRunSucceeded === true
  );
}

function validVideoObservation(details, observation) {
  return (
    exactObject(observation, [...detailKeys.video_check]) &&
    sameJsonValue(observation, details)
  );
}

function validRepositoryObservation(details, observation, run) {
  const commonKeys = [
    "url",
    "finalUrl",
    "status",
    "loggedOut",
    "headSha",
    "readmeStatus",
    "licenseStatus",
    "codexStoryStatus",
    "judgeGuideUrl",
    "judgeGuideStatus",
    "readmeSha256",
    "licenseSha256",
    "collaborationSectionLength",
  ];
  const commonValid =
    observation.url === details.url &&
    observation.finalUrl === details.finalUrl &&
    isCleanHttpsUrl(observation.url) &&
    isCleanHttpsUrl(observation.finalUrl) &&
    sameUrlIdentity(observation.url, observation.finalUrl) &&
    observation.status === details.status &&
    observation.loggedOut === details.loggedOut &&
    observation.headSha === run?.commitSha &&
    [
      observation.readmeStatus,
      observation.licenseStatus,
      observation.codexStoryStatus,
      observation.judgeGuideStatus,
    ].every((status) => status === 200) &&
    isCleanHttpsUrl(observation.judgeGuideUrl) &&
    hashPattern.test(observation.readmeSha256 ?? "") &&
    hashPattern.test(observation.licenseSha256 ?? "") &&
    Number.isInteger(observation.collaborationSectionLength) &&
    observation.collaborationSectionLength >= 120;
  if (!commonValid) return false;
  if (details.access === "public") {
    return (
      exactObject(observation, commonKeys) &&
      observation.status === 200 &&
      observation.loggedOut === true
    );
  }
  if (details.access === "private_shared") {
    return (
      exactObject(observation, [
        ...commonKeys,
        "access",
        "sharedWith",
        "sharingVerification",
      ]) &&
      observation.access === "private_shared" &&
      observation.status === 200 &&
      observation.loggedOut === false &&
      exactReviewerEmails(observation.sharedWith) &&
      exactReviewerEmails(details.sharedWith) &&
      sameReviewerEmails(observation.sharedWith, details.sharedWith) &&
      exactObject(observation.sharingVerification, ["method", "verifiedAt"]) &&
      observation.sharingVerification.method ===
        "authenticated_repository_settings" &&
      isIsoDate(observation.sharingVerification.verifiedAt) &&
      isIsoDate(run?.startedAt) &&
      isIsoDate(run?.endedAt) &&
      Date.parse(observation.sharingVerification.verifiedAt) >=
        Date.parse(run.startedAt) &&
      Date.parse(observation.sharingVerification.verifiedAt) <=
        Date.parse(run.endedAt)
    );
  }
  return false;
}

const requiredReviewerEmails = Object.freeze([
  "testing@devpost.com",
  "build-week-event@openai.com",
]);

function exactReviewerEmails(value) {
  return (
    Array.isArray(value) &&
    value.length === requiredReviewerEmails.length &&
    requiredReviewerEmails.every((email) => value.includes(email))
  );
}

function sameReviewerEmails(left, right) {
  return (
    exactReviewerEmails(left) &&
    exactReviewerEmails(right) &&
    left.every((email) => right.includes(email))
  );
}

function validJudgeAccessObservation(details, observation) {
  return (
    exactObject(observation, [...Object.keys(details), "availabilityBasis"]) &&
    observation.availabilityBasis === "public_deployment_observation" &&
    sameJsonValue(
      Object.fromEntries(
        Object.keys(details).map((key) => [key, observation[key]]),
      ),
      details,
    ) &&
    isCleanHttpsUrl(observation.url) &&
    isCleanHttpsUrl(observation.finalUrl) &&
    sameUrlIdentity(observation.url, observation.finalUrl) &&
    observation.loggedOut === true &&
    Number.isInteger(observation.status) &&
    observation.status >= 200 &&
    observation.status < 300 &&
    observation.expectedContentPresent === true
  );
}

function validRightsReviewObservation(details, observation, run) {
  return (
    exactObject(observation, [
      ...detailKeys.rights_review,
      "reviewer",
      "reviewedAt",
      "attestationSha256",
    ]) &&
    [...detailKeys.rights_review].every(
      (key) => observation[key] === details[key],
    ) &&
    nonEmptyString(observation.reviewer) &&
    isIsoDate(observation.reviewedAt) &&
    isIsoDate(run?.startedAt) &&
    isIsoDate(run?.endedAt) &&
    Date.parse(observation.reviewedAt) >= Date.parse(run.startedAt) &&
    Date.parse(observation.reviewedAt) <= Date.parse(run.endedAt) &&
    hashPattern.test(observation.attestationSha256 ?? "")
  );
}

function validateSubmissionFieldObservation(details, observation) {
  if (details.field === "track") {
    return (
      exactObject(observation, ["sourcePath", "sourceSha256", "track"]) &&
      nonEmptyString(observation.sourcePath) &&
      hashPattern.test(observation.sourceSha256 ?? "") &&
      observation.track === "Work and Productivity" &&
      details.value === "work_and_productivity"
    );
  }
  if (details.field === "description") {
    const derived = deriveSubmissionDescriptionObservation(
      observation?.sourceText,
    );
    return (
      exactObject(observation, [
        "sourcePath",
        "sourceText",
        "sourceSha256",
        "sections",
        "sectionLengths",
        "englishDescriptionPresent",
        "featuresAndFunctionalityPresent",
      ]) &&
      observation.sourcePath === descriptionSourcePath &&
      observation.sourceSha256 === sha256(observation.sourceText) &&
      derived !== null &&
      sameJsonValue(observation.sections, derived.sections) &&
      sameJsonValue(observation.sectionLengths, derived.sectionLengths) &&
      observation.englishDescriptionPresent ===
        derived.englishDescriptionPresent &&
      observation.featuresAndFunctionalityPresent ===
        derived.featuresAndFunctionalityPresent &&
      derived.englishDescriptionPresent === true &&
      derived.featuresAndFunctionalityPresent === true &&
      details.present === true &&
      details.explainsFeaturesAndFunctionality === true &&
      details.englishOrTranslationProvided === true
    );
  }
  if (details.field === "feedback_session") {
    return (
      exactObject(observation, [
        "sessionId",
        "source",
        "fromPrimaryBuildThread",
      ]) &&
      observation.sessionId === details.sessionId &&
      observation.source === "codex_feedback_command" &&
      observation.fromPrimaryBuildThread === details.fromPrimaryBuildThread
    );
  }
  if (details.field === "provenance") {
    return (
      exactObject(observation, [
        "rootCommitCount",
        "rootCommitSha",
        "rootCommitAt",
        "publicRootCommitSha",
        "publicRootCommitAt",
        "repositoryCreatedAt",
      ]) &&
      observation.rootCommitCount === details.rootCommitCount &&
      observation.rootCommitSha === details.rootCommitSha &&
      observation.rootCommitAt === details.rootCommitAt &&
      observation.publicRootCommitSha === details.publicRootCommitSha &&
      Date.parse(observation.publicRootCommitAt ?? "") ===
        Date.parse(details.rootCommitAt ?? "") &&
      observation.repositoryCreatedAt === details.repositoryCreatedAt
    );
  }
  if (details.field === "devpost_form") {
    return (
      exactObject(observation, [
        "url",
        "formId",
        "formRevision",
        "requiredFieldsComplete",
      ]) &&
      isCleanDevpostUrl(observation.url) &&
      nonEmptyString(observation.formId) &&
      nonEmptyString(observation.formRevision) &&
      observation.requiredFieldsComplete === details.requiredFieldsComplete
    );
  }
  return false;
}

function validCommandObservation(observation) {
  return (
    exactObject(observation, [
      "command",
      "exitCode",
      "stdout",
      "outputTailSha256",
    ]) &&
    nonEmptyString(observation.command) &&
    observation.exitCode === 0 &&
    typeof observation.stdout === "string" &&
    hashPattern.test(observation.outputTailSha256 ?? "")
  );
}

function exactObject(value, requiredKeys) {
  if (!isPlainObject(value)) return false;
  const expected = new Set(requiredKeys);
  return (
    Object.keys(value).length === expected.size &&
    [...expected].every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function sameJsonValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function rejectSymlinkPath(path) {
  const root = resolve(repositoryRoot, "artifacts", "validation");
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("outside validation root");
  }
  let cursor = repositoryRoot;
  const relativeToRepository = relative(repositoryRoot, path);
  for (const segment of relativeToRepository.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error("symlink not allowed");
  }
}

function isSafeArtifact(artifact) {
  return Boolean(
    isPlainObject(artifact) &&
    typeof artifact.path === "string" &&
    artifact.path.startsWith("artifacts/validation/") &&
    !isAbsolute(artifact.path) &&
    !artifact.path.includes("\\") &&
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

function isCleanHttpsUrl(raw) {
  if (!isHttpsUrl(raw)) return false;
  const url = new URL(raw);
  return url.search === "" && url.hash === "";
}

function isCleanDevpostUrl(raw) {
  if (!isCleanHttpsUrl(raw)) return false;
  const url = new URL(raw);
  return (
    (url.hostname === "devpost.com" || url.hostname.endsWith(".devpost.com")) &&
    url.pathname !== "/"
  );
}

function youtubeVideoId(raw) {
  if (!isHttpsUrl(raw)) return null;
  const url = new URL(raw);
  if (url.hash !== "") return null;
  const hostname = url.hostname.toLowerCase();
  let id = null;
  if (hostname === "youtu.be") {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1 || url.search !== "") return null;
    [id] = segments;
  } else if (hostname === "youtube.com" || hostname === "www.youtube.com") {
    if (url.pathname === "/watch") {
      const keys = [...url.searchParams.keys()];
      if (
        keys.length !== 1 ||
        keys[0] !== "v" ||
        url.searchParams.getAll("v").length !== 1
      ) {
        return null;
      }
      id = url.searchParams.get("v");
    } else {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length !== 2 || url.search !== "") return null;
      const [prefix, candidate] = segments;
      if (["embed", "live", "shorts"].includes(prefix)) id = candidate;
    }
  }
  return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
}

function sameUrlIdentity(left, right) {
  const leftIdentity = normalizedUrlIdentity(left);
  return leftIdentity !== null && leftIdentity === normalizedUrlIdentity(right);
}

function normalizedUrlIdentity(raw) {
  if (!isCleanHttpsUrl(raw)) return null;
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  const host = url.host.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (hostname === "github.com" || hostname === "www.github.com") {
    if (segments.length !== 2) return null;
    const [owner, repository] = segments;
    return `github.com/${owner.toLowerCase()}/${repository
      .replace(/\.git$/iu, "")
      .toLowerCase()}`;
  }
  const pathname = `/${segments.join("/")}`;
  return `${host}${pathname === "/" ? "" : pathname}`;
}

function rejectUnknownKeys(value, allowed, label, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} has unknown field: ${key}`);
  }
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype,
  );
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}
