import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../demo-seed/generate.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const hashPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const agentReleaseEvalKind = "inspectionhub.agent_release_eval";
const agentReleaseEvalSchemaVersion = 1;
const agentReleaseEvalFixedTrialsPerCase = 3;
const agentReleaseEvalDevelopmentCaseCount = 10;
const agentReleaseEvalLockedHoldoutCaseCount = 10;
const agentReleaseEvalDevelopmentCaseIds = Object.freeze(
  Array.from(
    { length: agentReleaseEvalDevelopmentCaseCount },
    (_, index) => `D${String(index + 1).padStart(2, "0")}`,
  ),
);
const exposedHoldoutCaseIds = new Set(
  Array.from(
    { length: agentReleaseEvalLockedHoldoutCaseCount },
    (_, index) => `H${String(index + 1).padStart(2, "0")}`,
  ),
);
const agentReleaseEvalArchitectures = Object.freeze([
  "agents_sdk",
  "thin_responses",
]);
const agentReleaseEvalCaseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/u;
const statuses = new Set(["pass", "fail", "unproven", "not_applicable"]);
const evidenceKinds = new Set([
  "automated_run",
  "physical_device",
  "human_session",
  "accessibility_audit",
  "public_url",
  "link_check",
  "review",
]);

export const requiredExternalEvidence = Object.freeze({
  physicalDevice: 1,
  recipientSessions: 2,
  clientSessions: 2,
  accessibilityAudits: 1,
  publicDemoUrls: 1,
  linkAssets: ["video", "repository", "submission_description"],
  independentReviews: 1,
});

const rubricEvidenceKinds = Object.freeze({
  EI1: ["physical_device"],
  EI2: ["automated_run"],
  EI3: ["automated_run"],
  EI4: ["automated_run"],
  EI5: ["automated_run", "physical_device"],
  IF1: ["physical_device"],
  IF2: ["physical_device"],
  IF3: ["automated_run", "physical_device"],
  IF4: ["physical_device"],
  IF5: ["physical_device"],
  AI1: ["automated_run"],
  AI2: ["automated_run"],
  AI3: ["automated_run"],
  AI4: ["automated_run"],
  AI5: ["automated_run"],
  RC1: ["human_session"],
  RC2: ["automated_run", "public_url"],
  RC3: ["automated_run", "public_url"],
  RC4: ["automated_run", "public_url"],
  RC5: ["automated_run", "public_url"],
  AC1: ["automated_run", "accessibility_audit"],
  AC2: ["accessibility_audit"],
  AC3: ["automated_run", "accessibility_audit"],
  AC4: ["accessibility_audit"],
  SO1: ["automated_run", "public_url"],
  SO2: ["automated_run"],
  SO3: ["automated_run"],
  SO4: ["automated_run"],
  SO5: ["automated_run", "public_url"],
});

export async function loadContracts() {
  const [rubric, deferred] = await Promise.all([
    readJson(resolve(scriptDirectory, "rubric.json")),
    readJson(resolve(scriptDirectory, "deferred-boundaries.json")),
  ]);
  return { rubric, deferred };
}

export function defaultEvidenceInput({ now, commitSha, seedSha256 }) {
  const rubricItems = [
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
  ];
  const gates = [
    "evidence_integrity",
    "ai_safety_and_authority",
    "independent_module_approval_and_package",
    "public_recipient_security",
    "physical_field_and_accessibility",
    "logged_out_submission_assets",
  ];
  return {
    schemaVersion: 2,
    run: {
      environmentType: "synthetic_test",
      startedAt: now,
      endedAt: now,
      commitSha,
      commands: [],
      modelVersions: [],
      promptVersions: [],
      skillVersions: [],
      benchmarkProfile: null,
      rawSampleSha256: null,
    },
    demoSeedSha256: seedSha256,
    evidence: [],
    rubricResults: rubricItems.map((id) => ({
      id,
      status: "unproven",
      evidenceIds: [],
      reason: "No observed milestone evidence has been supplied.",
    })),
    mustPassGates: gates.map((id) => ({
      id,
      status: "unproven",
      evidenceIds: [],
      reason: "No observed must-pass evidence has been supplied.",
    })),
    unresolvedFindings: [],
    skippedChecks: [
      {
        id: "physical-public-human-live-prerequisites",
        reason:
          "Physical-device, public-demo, human-validation and live-model observations have not been supplied.",
      },
    ],
    publicUrlsChecked: [],
    reviewerFindings: [],
    deferredBoundaries: [],
  };
}

export async function validateAndBuildManifest(
  input,
  { rubric, deferred },
  options = {},
) {
  const errors = [];
  const migration = migrateEvidenceInput(input, options);
  input = migration.input;
  errors.push(...migration.errors);
  validateRun(input.run, errors);
  validateRuntimeSource(input.run, options, errors);
  const evidenceById = validateEvidence(
    input.evidence,
    input.run?.commitSha,
    errors,
  );
  const rubricEvaluation = validateRubricResults(
    input.rubricResults,
    rubric,
    evidenceById,
    errors,
  );
  const verifiedAgentReleaseEvals =
    options.verifyArtifacts === false
      ? new Map()
      : await verifyEvidenceArtifacts(evidenceById, input.run, errors);
  const gates = validateGates(
    input.mustPassGates,
    rubric,
    evidenceById,
    verifiedAgentReleaseEvals,
    errors,
  );
  const deferredBoundaries = validateDeferredBoundaries(
    input.deferredBoundaries,
    deferred,
    evidenceById,
    errors,
  );
  validateStringArrayRecords(input.skippedChecks, "skippedChecks", errors);
  validateFindings(input.unresolvedFindings, errors);
  validateReviewerFindings(input.reviewerFindings, errors);
  validatePublicUrls(input.publicUrlsChecked, errors);

  if (!hashPattern.test(input.demoSeedSha256 ?? "")) {
    errors.push("demoSeedSha256 must be a lowercase SHA-256 hash");
  }
  if (
    options.expectedSeedSha256 &&
    input.demoSeedSha256 !== options.expectedSeedSha256
  ) {
    errors.push(
      "demoSeedSha256 does not match the deterministic golden-path seed",
    );
  }

  const externalProof = evaluateExternalProof(evidenceById, errors);
  const hasBlockingFinding = [
    ...(input.unresolvedFindings ?? []),
    ...(input.reviewerFindings ?? []),
  ].some(
    (finding) =>
      finding?.status !== "resolved" &&
      (finding?.severity === "P0" || finding?.severity === "P1"),
  );
  const gateFailures = gates.filter((gate) => gate.status !== "pass");
  const atomicMustPassFailures = rubric.items
    .filter((item) => item.mustPass)
    .filter(
      (item) => rubricEvaluation.resultById.get(item.id)?.status !== "pass",
    );
  const complete =
    errors.length === 0 &&
    options.verifyArtifacts !== false &&
    input.run?.environmentType === "build_week_observed" &&
    commitPattern.test(input.run?.commitSha ?? "") &&
    rubricEvaluation.percent >= rubric.thresholdPercent &&
    rubricEvaluation.areas.every(
      (area) => area.percent >= rubric.minimumAreaPercent,
    ) &&
    gateFailures.length === 0 &&
    atomicMustPassFailures.length === 0 &&
    !hasBlockingFinding &&
    externalProof.complete;

  const blockers = [];
  if (input.run?.environmentType !== "build_week_observed") {
    blockers.push("environment_type_not_build_week_observed");
  }
  if (options.verifyArtifacts === false) {
    blockers.push("artifact_verification_bypassed");
  }
  if (!commitPattern.test(input.run?.commitSha ?? ""))
    blockers.push("immutable_commit_sha_missing");
  if (rubricEvaluation.percent < rubric.thresholdPercent)
    blockers.push("rubric_threshold_not_met");
  if (
    rubricEvaluation.areas.some(
      (area) => area.percent < rubric.minimumAreaPercent,
    )
  ) {
    blockers.push("area_minimum_not_met");
  }
  if (atomicMustPassFailures.length > 0)
    blockers.push("atomic_must_pass_not_green");
  if (gateFailures.length > 0) blockers.push("must_pass_gate_not_green");
  if (hasBlockingFinding) blockers.push("unresolved_p0_or_p1");
  blockers.push(...externalProof.blockers);

  const payload = {
    schemaVersion: 1,
    milestone: "build_week",
    outcome: complete ? "complete" : "blocked",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    run: input.run,
    demoSeedSha256: input.demoSeedSha256,
    evidence: input.evidence,
    rubric: {
      earnedPoints: rubricEvaluation.earnedPoints,
      applicablePoints: rubricEvaluation.applicablePoints,
      notApplicablePoints: rubricEvaluation.notApplicablePoints,
      percent: rubricEvaluation.percent,
      thresholdPercent: rubric.thresholdPercent,
      minimumAreaPercent: rubric.minimumAreaPercent,
      areas: rubricEvaluation.areas,
      results: rubricEvaluation.results,
    },
    mustPassGates: gates,
    externalProof,
    unresolvedFindings: input.unresolvedFindings,
    reviewerFindings: input.reviewerFindings,
    skippedChecks: input.skippedChecks,
    publicUrlsChecked: input.publicUrlsChecked,
    deferredBoundaries,
    blockers: [...new Set(blockers)].sort(),
    validationErrors: errors,
  };
  const payloadSha256 = sha256(canonicalJson(payload));
  return {
    manifest: {
      ...payload,
      integrity: { algorithm: "sha256", canonicalPayloadSha256: payloadSha256 },
      completionEvent: complete
        ? {
            eventType: "build_week.milestone.completed",
            occurredAt: payload.generatedAt,
            manifestPayloadSha256: payloadSha256,
          }
        : null,
    },
    valid: errors.length === 0,
    complete,
  };
}

export function migrateEvidenceInput(input, options = {}) {
  if (input?.schemaVersion === 2) return { input, errors: [] };
  if (input?.schemaVersion !== 1) {
    return {
      input: input ?? {},
      errors: ["Evidence input schemaVersion must be 1 or 2"],
    };
  }
  const errors = [];
  const run = { ...(input.run ?? {}) };
  const sourceBound =
    options.runtimeWorktreeClean === true &&
    commitPattern.test(options.runtimeCommitSha ?? "") &&
    options.runtimeCommitSha === run.commitSha;
  if (!Array.isArray(run.skillVersions)) {
    errors.push(
      "Evidence input v1 migration is blocked because run.skillVersions was not observed",
    );
    run.skillVersions = [];
  }
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.map((record) => {
        if (!record || typeof record !== "object") return record;
        const migrated = { ...record };
        if (!commitPattern.test(migrated.commitSha ?? "")) {
          if (sourceBound) migrated.commitSha = run.commitSha;
          else {
            errors.push(
              `Evidence input v1 record ${String(migrated.id ?? "<missing>")} commit migration requires a clean runtime at the exact run commit`,
            );
          }
        }
        const details = { ...(migrated.details ?? {}) };
        if (
          migrated.kind === "physical_device" &&
          !commitPattern.test(details.appCommitSha ?? "")
        ) {
          errors.push(
            `Evidence input v1 physical record ${String(migrated.id ?? "<missing>")} requires an observed appCommitSha and cannot be inferred`,
          );
        }
        if (
          migrated.kind === "review" &&
          !commitPattern.test(details.reviewedCommitSha ?? "")
        ) {
          errors.push(
            `Evidence input v1 review record ${String(migrated.id ?? "<missing>")} requires an observed reviewedCommitSha and cannot be inferred`,
          );
        }
        migrated.details = details;
        return migrated;
      })
    : input.evidence;
  return {
    input: {
      ...input,
      schemaVersion: 2,
      run,
      evidence,
    },
    errors,
  };
}

function validateRuntimeSource(run, options, errors) {
  if (run?.environmentType !== "build_week_observed") return;
  if (options.runtimeWorktreeClean !== true) {
    errors.push(
      "Observed milestone validation requires an explicitly clean runtime worktree",
    );
  }
  if (
    !commitPattern.test(options.runtimeCommitSha ?? "") ||
    options.runtimeCommitSha !== run.commitSha
  ) {
    errors.push(
      "Observed milestone run.commitSha must exactly match the runtime HEAD commit",
    );
  }
}

function validateRun(run, errors) {
  if (!run || typeof run !== "object") {
    errors.push("run is required");
    return;
  }
  if (
    !new Set(["synthetic_test", "build_week_observed", "unit_test"]).has(
      run.environmentType,
    )
  ) {
    errors.push("run.environmentType is invalid");
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
  if (!Array.isArray(run.commands))
    errors.push("run.commands must be an array");
  if (!Array.isArray(run.modelVersions))
    errors.push("run.modelVersions must be an array");
  if (!Array.isArray(run.promptVersions))
    errors.push("run.promptVersions must be an array");
  if (!Array.isArray(run.skillVersions))
    errors.push("run.skillVersions must be an array");
}

function validateEvidence(records, runCommitSha, errors) {
  const byId = new Map();
  if (!Array.isArray(records)) {
    errors.push("evidence must be an array");
    return byId;
  }
  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.id !== "string" ||
      record.id.length < 3
    ) {
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
    if (typeof record.claim !== "string" || record.claim.length < 10) {
      errors.push(`Evidence ${record.id} requires a bounded claim`);
    }
    if (
      !commitPattern.test(record.commitSha ?? "") ||
      record.commitSha !== runCommitSha
    ) {
      errors.push(
        `Evidence ${record.id} commitSha must exactly match run.commitSha`,
      );
    }
    if (record.provenance?.mode !== "observed") {
      errors.push(`Evidence ${record.id} is not observed evidence`);
    }
    if (
      typeof record.provenance?.observer !== "string" ||
      record.provenance.observer.length < 3
    ) {
      errors.push(`Evidence ${record.id} requires an observer`);
    }
    if (!isIsoDate(record.provenance?.observedAt)) {
      errors.push(`Evidence ${record.id} requires an observedAt timestamp`);
    }
    if (!isSafeArtifact(record.artifact)) {
      errors.push(
        `Evidence ${record.id} requires a safe local artifact path and SHA-256`,
      );
    }
    validateEvidenceDetails(record, runCommitSha, errors);
  }
  return byId;
}

function validateEvidenceDetails(record, runCommitSha, errors) {
  const details = record.details ?? {};
  if (
    record.kind === "automated_run" &&
    (details.exitCode !== 0 ||
      typeof details.command !== "string" ||
      !new Set([
        "foundation",
        "integration",
        "web_e2e",
        "mobile_e2e",
        "evidence_integrity",
        "soak",
        "agent_eval",
        "module_package",
        "recipient_report",
        "pdf",
        "security",
        "accessibility",
        "repository_review",
      ]).has(details.suite))
  ) {
    errors.push(
      `Automated evidence ${record.id} must record a known suite, its command and exitCode 0`,
    );
  }
  if (
    record.kind === "automated_run" &&
    details.suite === "agent_eval" &&
    [
      "liveModel",
      "developmentPassed",
      "lockedHoldoutPassed",
      "criticalFailures",
      "releaseEligible",
    ].some((key) => Object.hasOwn(details, key))
  ) {
    errors.push(
      `Automated evidence ${record.id} cannot self-assert release-eval outcomes in details`,
    );
  }
  if (record.kind === "physical_device") {
    if (
      details.platform !== "ios" ||
      details.isPhysical !== true ||
      details.syntheticData !== true ||
      details.inspectorRole !== "licensed_inspector" ||
      typeof details.model !== "string" ||
      typeof details.osVersion !== "string" ||
      typeof details.appBuild !== "string" ||
      !Number.isInteger(details.freeStorageBytes) ||
      details.freeStorageBytes <= 0 ||
      !Number.isInteger(details.batteryPercent) ||
      details.batteryPercent < 0 ||
      details.batteryPercent > 100 ||
      !new Set(["nominal", "fair", "serious", "critical"]).has(
        details.thermalState,
      ) ||
      !hashPattern.test(details.benchmarkProfileSha256 ?? "") ||
      !hashPattern.test(details.rawSampleSha256 ?? "") ||
      details.completedOnsite !== true ||
      details.desktopReconstruction !== false ||
      details.deliveryFakeSentOrDurablyQueued !== true ||
      !Array.isArray(details.paths) ||
      !details.paths.includes("complete_inspection") ||
      !details.paths.includes("offline_termination_recovery")
    ) {
      errors.push(
        `Physical evidence ${record.id} does not cover the licensed-inspector iOS golden and recovery paths`,
      );
    }
    if (
      !commitPattern.test(details.appCommitSha ?? "") ||
      details.appCommitSha !== runCommitSha
    ) {
      errors.push(
        `Physical evidence ${record.id} appCommitSha must exactly match run.commitSha`,
      );
    }
  }
  if (record.kind === "human_session") {
    if (
      !new Set(["recipient", "client"]).has(details.cohort) ||
      !hashPattern.test(details.participantHash ?? "") ||
      details.success !== true ||
      typeof details.task !== "string" ||
      !Number.isFinite(details.durationSeconds) ||
      details.durationSeconds <= 0 ||
      typeof details.assistance !== "string"
    ) {
      errors.push(
        `Human evidence ${record.id} requires a successful recipient/client session and pseudonymous participant hash`,
      );
    }
  }
  if (record.kind === "accessibility_audit") {
    if (
      details.blockingFindings !== 0 ||
      details.completeCriticalJourneys !== true ||
      !new Set(["moderated_session", "specialist_audit"]).has(
        details.reviewType,
      ) ||
      typeof details.assistiveTechnology !== "string" ||
      details.assistiveTechnology.length < 3
    ) {
      errors.push(
        `Accessibility evidence ${record.id} has an incomplete journey or blocking finding`,
      );
    }
  }
  if (record.kind === "public_url") {
    if (
      !isSafeHttpsUrl(details.url) ||
      !isSafeHttpsUrl(details.finalUrl) ||
      details.loggedOut !== true ||
      !isSuccessfulHttpStatus(details.status) ||
      typeof details.pageTitle !== "string" ||
      details.pageTitle.length < 3 ||
      typeof details.expectedText !== "string" ||
      details.expectedText.length < 3 ||
      details.expectedContentPresent !== true ||
      details.authBoundaryChecked !== true ||
      details.namedRecipientAuth !== true ||
      details.moduleCapabilityChecked !== true ||
      details.privateMediaDenied !== true ||
      details.revocationDenied !== true
    ) {
      errors.push(
        `Public URL evidence ${record.id} is missing HTTPS, content, logged-out, auth, capability, private-media or revocation proof`,
      );
    }
  }
  if (record.kind === "link_check") {
    if (
      !new Set(["video", "repository", "submission_description"]).has(
        details.asset,
      ) ||
      !isSafeHttpsUrl(details.url) ||
      !isSafeHttpsUrl(details.finalUrl) ||
      details.loggedOut !== true ||
      !isSuccessfulHttpStatus(details.status) ||
      details.expectedContentPresent !== true
    ) {
      errors.push(
        `Link evidence ${record.id} is not a successful logged-out public asset check`,
      );
    }
  }
  if (record.kind === "review") {
    if (
      details.unresolvedP0 !== 0 ||
      details.unresolvedP1 !== 0 ||
      !Array.isArray(details.scopes) ||
      !["implementation", "security", "document"].every((scope) =>
        details.scopes.includes(scope),
      )
    ) {
      errors.push(`Review evidence ${record.id} has unresolved P0/P1 findings`);
    }
    if (
      !commitPattern.test(details.reviewedCommitSha ?? "") ||
      details.reviewedCommitSha !== runCommitSha
    ) {
      errors.push(
        `Review evidence ${record.id} reviewedCommitSha must exactly match run.commitSha`,
      );
    }
  }
}

function validateRubricResults(results, rubric, evidenceById, errors) {
  const expectedById = new Map(rubric.items.map((item) => [item.id, item]));
  const resultById = new Map();
  if (!Array.isArray(results)) {
    errors.push("rubricResults must be an array");
    results = [];
  }
  for (const result of results) {
    if (!result || !expectedById.has(result.id)) {
      errors.push(`Unknown rubric id: ${result?.id ?? "<missing>"}`);
      continue;
    }
    if (resultById.has(result.id)) {
      errors.push(`Duplicate rubric id: ${result.id}`);
      continue;
    }
    resultById.set(result.id, result);
    if (!statuses.has(result.status))
      errors.push(`Rubric ${result.id} has an invalid status`);
    validateEvidenceReferences(
      result,
      evidenceById,
      errors,
      `Rubric ${result.id}`,
    );
    const expected = expectedById.get(result.id);
    if (expected.mustPass && result.status === "not_applicable") {
      errors.push(`Must-pass rubric ${result.id} cannot be not_applicable`);
    }
    if (result.status === "not_applicable") {
      if (!rubric.notApplicableAllowlist.includes(result.id)) {
        errors.push(
          `Rubric ${result.id} is not eligible for Build Week not_applicable status`,
        );
      }
      if (typeof result.reason !== "string" || result.reason.length < 20) {
        errors.push(
          `Rubric ${result.id} requires a named not_applicable reason`,
        );
      }
    }
    if (result.status === "pass") {
      const allowedKinds = rubricEvidenceKinds[result.id] ?? [];
      const observedKinds = new Set(
        result.evidenceIds.map(
          (evidenceId) => evidenceById.get(evidenceId)?.kind,
        ),
      );
      if (!allowedKinds.some((kind) => observedKinds.has(kind))) {
        errors.push(
          `Rubric ${result.id} does not reference an allowed evidence kind`,
        );
      }
    }
  }
  for (const id of expectedById.keys()) {
    if (!resultById.has(id)) errors.push(`Missing rubric id: ${id}`);
  }
  const normalized = rubric.items.map((item) => ({
    ...item,
    status: resultById.get(item.id)?.status ?? "unproven",
    evidenceIds: resultById.get(item.id)?.evidenceIds ?? [],
    reason: resultById.get(item.id)?.reason ?? "Missing result",
  }));
  const notApplicablePoints = normalized
    .filter((result) => result.status === "not_applicable")
    .reduce((sum, result) => sum + result.points, 0);
  if (notApplicablePoints > rubric.maximumNotApplicablePoints) {
    errors.push(
      `Build Week not_applicable points ${notApplicablePoints} exceed cap ${rubric.maximumNotApplicablePoints}`,
    );
  }
  const earnedPoints = normalized
    .filter((result) => result.status === "pass")
    .reduce((sum, result) => sum + result.points, 0);
  const applicablePoints = 100 - notApplicablePoints;
  const percent = percentage(earnedPoints, applicablePoints);
  const areas = [...new Set(rubric.items.map((item) => item.area))].map(
    (area) => {
      const areaResults = normalized.filter((result) => result.area === area);
      const earned = areaResults
        .filter((result) => result.status === "pass")
        .reduce((sum, result) => sum + result.points, 0);
      const applicable = areaResults
        .filter((result) => result.status !== "not_applicable")
        .reduce((sum, result) => sum + result.points, 0);
      return {
        area,
        earnedPoints: earned,
        applicablePoints: applicable,
        percent: percentage(earned, applicable),
      };
    },
  );
  return {
    results: normalized,
    resultById,
    earnedPoints,
    applicablePoints,
    notApplicablePoints,
    percent,
    areas,
  };
}

function validateGates(
  gates,
  rubric,
  evidenceById,
  verifiedAgentReleaseEvals,
  errors,
) {
  const expected = new Set(rubric.mustPassGates);
  const seen = new Set();
  if (!Array.isArray(gates)) {
    errors.push("mustPassGates must be an array");
    gates = [];
  }
  for (const gate of gates) {
    if (!gate || !expected.has(gate.id)) {
      errors.push(`Unknown must-pass gate: ${gate?.id ?? "<missing>"}`);
      continue;
    }
    if (seen.has(gate.id)) errors.push(`Duplicate must-pass gate: ${gate.id}`);
    seen.add(gate.id);
    if (!new Set(["pass", "fail", "unproven"]).has(gate.status)) {
      errors.push(
        `Must-pass gate ${gate.id} has an invalid status; gates cannot be not_applicable`,
      );
    }
    validateEvidenceReferences(
      gate,
      evidenceById,
      errors,
      `Must-pass gate ${gate.id}`,
    );
    if (gate.status === "pass") {
      validateGateEvidence(
        gate,
        evidenceById,
        verifiedAgentReleaseEvals,
        errors,
      );
    }
  }
  for (const id of expected)
    if (!seen.has(id)) errors.push(`Missing must-pass gate: ${id}`);
  return rubric.mustPassGates.map(
    (id) =>
      gates.find((gate) => gate.id === id) ?? {
        id,
        status: "unproven",
        evidenceIds: [],
        reason: "Missing gate",
      },
  );
}

function validateGateEvidence(
  gate,
  evidenceById,
  verifiedAgentReleaseEvals,
  errors,
) {
  const records = gate.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter(Boolean);
  const kinds = new Set(records.map((record) => record.kind));
  const automatedSuites = new Set(
    records
      .filter((record) => record.kind === "automated_run")
      .map((record) => record.details?.suite),
  );
  const requireKind = (kind) => {
    if (!kinds.has(kind)) {
      errors.push(`Must-pass gate ${gate.id} requires ${kind} evidence`);
    }
  };
  const requireSuite = (suite) => {
    if (!automatedSuites.has(suite)) {
      errors.push(
        `Must-pass gate ${gate.id} requires ${suite} automated evidence`,
      );
    }
  };

  if (gate.id === "evidence_integrity") {
    requireKind("physical_device");
    requireSuite("evidence_integrity");
    requireSuite("soak");
  }
  if (gate.id === "ai_safety_and_authority") {
    requireSuite("agent_eval");
    const releaseEval = records
      .filter(
        (record) =>
          record.kind === "automated_run" &&
          record.details?.suite === "agent_eval",
      )
      .map((record) => verifiedAgentReleaseEvals.get(record.id))
      .find(
        (artifact) =>
          artifact?.outcomes.development.passed === true &&
          artifact.outcomes.development.criticalFailures === 0 &&
          artifact.outcomes.lockedHoldout.passed === true &&
          artifact.outcomes.lockedHoldout.criticalFailures === 0 &&
          artifact.outcomes.releaseEligible === true,
      );
    if (!releaseEval) {
      errors.push(
        `Must-pass gate ${gate.id} requires a typed, checksum-verified, release-bound development and locked-holdout eval with zero critical failures`,
      );
    }
  }
  if (gate.id === "independent_module_approval_and_package") {
    requireSuite("module_package");
  }
  if (gate.id === "public_recipient_security") {
    requireKind("public_url");
  }
  if (gate.id === "physical_field_and_accessibility") {
    requireKind("physical_device");
    requireKind("accessibility_audit");
  }
  if (gate.id === "logged_out_submission_assets") {
    requireKind("review");
    for (const asset of requiredExternalEvidence.linkAssets) {
      if (
        !records.some(
          (record) =>
            record.kind === "link_check" && record.details?.asset === asset,
        )
      ) {
        errors.push(
          `Must-pass gate ${gate.id} requires logged-out ${asset} evidence`,
        );
      }
    }
  }
}

function validateEvidenceReferences(result, evidenceById, errors, label) {
  if (!Array.isArray(result.evidenceIds)) {
    errors.push(`${label} evidenceIds must be an array`);
    return;
  }
  for (const evidenceId of result.evidenceIds) {
    if (!evidenceById.has(evidenceId))
      errors.push(`${label} references missing evidence ${evidenceId}`);
  }
  if (result.status === "pass" && result.evidenceIds.length === 0) {
    errors.push(`${label} cannot pass without observed evidence`);
  }
}

function validateDeferredBoundaries(records, deferred, evidenceById, errors) {
  const inputRecords =
    Array.isArray(records) && records.length > 0
      ? records
      : deferred.boundaries.map((boundary) => ({
          ...boundary,
          status: "unproven",
          evidenceIds: [],
        }));
  const expected = new Map(
    deferred.boundaries.map((boundary) => [boundary.id, boundary]),
  );
  const seen = new Set();
  for (const record of inputRecords) {
    if (!record || !expected.has(record.id)) {
      errors.push(`Unknown deferred boundary: ${record?.id ?? "<missing>"}`);
      continue;
    }
    if (seen.has(record.id))
      errors.push(`Duplicate deferred boundary: ${record.id}`);
    seen.add(record.id);
    if (!new Set(["unproven", "separately_observed"]).has(record.status)) {
      errors.push(`Deferred boundary ${record.id} has an invalid status`);
    }
    if (record.status === "separately_observed") {
      validateEvidenceReferences(
        { ...record, status: "pass" },
        evidenceById,
        errors,
        `Deferred boundary ${record.id}`,
      );
    }
  }
  for (const id of expected.keys())
    if (!seen.has(id)) errors.push(`Missing deferred boundary: ${id}`);
  return deferred.boundaries.map((boundary) => {
    const actual = inputRecords.find((record) => record.id === boundary.id);
    return {
      ...boundary,
      status: actual?.status ?? "unproven",
      evidenceIds: actual?.evidenceIds ?? [],
    };
  });
}

async function verifyEvidenceArtifacts(evidenceById, run, errors) {
  const verifiedAgentReleaseEvals = new Map();
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
      if (sha256(bytes) !== evidence.artifact.sha256) {
        errors.push(`Evidence ${evidence.id} artifact checksum does not match`);
        continue;
      }
      if (
        evidence.kind === "automated_run" &&
        evidence.details?.suite === "agent_eval"
      ) {
        const parsed = parseAgentReleaseEvalArtifact(bytes, evidence, run);
        if (parsed.errors.length > 0) {
          errors.push(
            ...parsed.errors.map(
              (error) =>
                `Evidence ${evidence.id} release-eval artifact ${error}`,
            ),
          );
        } else {
          verifiedAgentReleaseEvals.set(evidence.id, parsed.value);
        }
      }
    } catch {
      errors.push(
        `Evidence ${evidence.id} artifact is unreadable: ${evidence.artifact.path}`,
      );
    }
  }
  return verifiedAgentReleaseEvals;
}

function parseAgentReleaseEvalArtifact(bytes, evidence, run) {
  const errors = [];
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { errors: ["must be valid JSON"], value: null };
  }
  if (
    !hasExactKeys(
      value,
      [
        "schemaVersion",
        "artifactKind",
        "observedAt",
        "releaseBinding",
        "protocol",
        "corpus",
        "adjudication",
        "trialResults",
        "outcomes",
      ],
      "root",
      errors,
    )
  ) {
    return { errors, value: null };
  }
  if (value.schemaVersion !== agentReleaseEvalSchemaVersion) {
    errors.push(
      `schemaVersion must be ${String(agentReleaseEvalSchemaVersion)}`,
    );
  }
  if (value.artifactKind !== agentReleaseEvalKind) {
    errors.push(`artifactKind must be ${agentReleaseEvalKind}`);
  }
  if (
    !isIsoDate(value.observedAt) ||
    value.observedAt !== evidence.provenance?.observedAt
  ) {
    errors.push("observedAt must exactly match evidence provenance");
  }

  const binding = value.releaseBinding;
  if (
    hasExactKeys(
      binding,
      ["commitSha", "model", "promptVersions", "skillVersions"],
      "releaseBinding",
      errors,
    )
  ) {
    if (
      !commitPattern.test(binding.commitSha ?? "") ||
      binding.commitSha !== evidence.commitSha ||
      binding.commitSha !== run?.commitSha
    ) {
      errors.push(
        "releaseBinding.commitSha must match the evidence and run commit",
      );
    }
    if (
      typeof binding.model !== "string" ||
      binding.model.length === 0 ||
      !sameVersionSet([binding.model], run?.modelVersions)
    ) {
      errors.push("releaseBinding.model must exactly match run.modelVersions");
    }
    if (
      !validVersionArray(binding.promptVersions) ||
      !sameVersionSet(binding.promptVersions, run?.promptVersions)
    ) {
      errors.push(
        "releaseBinding.promptVersions must exactly match run.promptVersions",
      );
    }
    if (
      !validVersionArray(binding.skillVersions) ||
      !sameVersionSet(binding.skillVersions, run?.skillVersions)
    ) {
      errors.push(
        "releaseBinding.skillVersions must exactly match run.skillVersions",
      );
    }
  }

  const protocol = value.protocol;
  if (
    hasExactKeys(
      protocol,
      [
        "liveModel",
        "fixedTrialsPerCase",
        "developmentCaseCount",
        "lockedHoldoutCaseCount",
      ],
      "protocol",
      errors,
    )
  ) {
    if (protocol.liveModel !== true) {
      errors.push("protocol.liveModel must be true");
    }
    if (protocol.fixedTrialsPerCase !== agentReleaseEvalFixedTrialsPerCase) {
      errors.push(
        `protocol.fixedTrialsPerCase must be ${String(agentReleaseEvalFixedTrialsPerCase)}`,
      );
    }
    if (
      protocol.developmentCaseCount !== agentReleaseEvalDevelopmentCaseCount
    ) {
      errors.push(
        `protocol.developmentCaseCount must be ${String(agentReleaseEvalDevelopmentCaseCount)}`,
      );
    }
    if (
      protocol.lockedHoldoutCaseCount !== agentReleaseEvalLockedHoldoutCaseCount
    ) {
      errors.push(
        `protocol.lockedHoldoutCaseCount must be ${String(agentReleaseEvalLockedHoldoutCaseCount)}`,
      );
    }
  }

  const corpus = validateAgentEvalCorpus(value.corpus, errors);

  const adjudication = value.adjudication;
  if (
    hasExactKeys(
      adjudication,
      ["lockedHoldoutBlinded", "adjudicatorIdentityHash"],
      "adjudication",
      errors,
    )
  ) {
    if (adjudication.lockedHoldoutBlinded !== true) {
      errors.push("adjudication.lockedHoldoutBlinded must be true");
    }
    if (!hashPattern.test(adjudication.adjudicatorIdentityHash ?? "")) {
      errors.push(
        "adjudication.adjudicatorIdentityHash must be a lowercase SHA-256 hash",
      );
    }
  }

  const outcomes = value.outcomes;
  const derivedOutcomes = deriveAgentEvalOutcomes(
    value.trialResults,
    corpus,
    errors,
  );
  if (
    hasExactKeys(
      outcomes,
      ["development", "lockedHoldout", "releaseEligible"],
      "outcomes",
      errors,
    )
  ) {
    validateAgentEvalOutcome(outcomes.development, "development", errors);
    validateAgentEvalOutcome(outcomes.lockedHoldout, "lockedHoldout", errors);
    if (typeof outcomes.releaseEligible !== "boolean") {
      errors.push("outcomes.releaseEligible must be boolean");
    }
    if (
      !sameAgentEvalOutcome(outcomes.development, derivedOutcomes.development)
    ) {
      errors.push(
        "outcomes.development must equal the recomputed trial outcome",
      );
    }
    if (
      !sameAgentEvalOutcome(
        outcomes.lockedHoldout,
        derivedOutcomes.lockedHoldout,
      )
    ) {
      errors.push(
        "outcomes.lockedHoldout must equal the recomputed trial outcome",
      );
    }
    if (outcomes.releaseEligible !== derivedOutcomes.releaseEligible) {
      errors.push(
        "outcomes.releaseEligible must equal the recomputed trial eligibility",
      );
    }
  }
  return {
    errors,
    value: errors.length === 0 ? { ...value, outcomes: derivedOutcomes } : null,
  };
}

function validateAgentEvalCorpus(corpus, errors) {
  const empty = { developmentCaseIds: [], lockedHoldoutCaseIds: [] };
  if (
    !hasExactKeys(
      corpus,
      ["protectedCorpusSha256", "developmentCaseIds", "lockedHoldoutCaseIds"],
      "corpus",
      errors,
    )
  ) {
    return empty;
  }
  if (!hashPattern.test(corpus.protectedCorpusSha256 ?? "")) {
    errors.push(
      "corpus.protectedCorpusSha256 must be a lowercase SHA-256 hash",
    );
  }
  if (
    !validAgentEvalCaseIdList(
      corpus.developmentCaseIds,
      agentReleaseEvalDevelopmentCaseCount,
    ) ||
    !sameStringSet(
      corpus.developmentCaseIds,
      agentReleaseEvalDevelopmentCaseIds,
    )
  ) {
    errors.push(
      `corpus.developmentCaseIds must exactly match ${agentReleaseEvalDevelopmentCaseIds.join(", ")}`,
    );
  }
  if (
    !validAgentEvalCaseIdList(
      corpus.lockedHoldoutCaseIds,
      agentReleaseEvalLockedHoldoutCaseCount,
    )
  ) {
    errors.push(
      `corpus.lockedHoldoutCaseIds must contain exactly ${String(agentReleaseEvalLockedHoldoutCaseCount)} unique case ids`,
    );
  } else {
    if (
      corpus.lockedHoldoutCaseIds.some((caseId) =>
        exposedHoldoutCaseIds.has(caseId),
      )
    ) {
      errors.push(
        "corpus.lockedHoldoutCaseIds cannot use the exposed holdout-labelled fixtures",
      );
    }
    if (
      corpus.lockedHoldoutCaseIds.some((caseId) =>
        agentReleaseEvalDevelopmentCaseIds.includes(caseId),
      )
    ) {
      errors.push(
        "corpus.lockedHoldoutCaseIds must be disjoint from developmentCaseIds",
      );
    }
  }
  return {
    developmentCaseIds: Array.isArray(corpus.developmentCaseIds)
      ? corpus.developmentCaseIds
      : [],
    lockedHoldoutCaseIds: Array.isArray(corpus.lockedHoldoutCaseIds)
      ? corpus.lockedHoldoutCaseIds
      : [],
  };
}

function deriveAgentEvalOutcomes(trialResults, corpus, errors) {
  const expectedTrialCount =
    (agentReleaseEvalDevelopmentCaseCount +
      agentReleaseEvalLockedHoldoutCaseCount) *
    agentReleaseEvalArchitectures.length *
    agentReleaseEvalFixedTrialsPerCase;
  if (!Array.isArray(trialResults)) {
    errors.push("trialResults must be an array");
    return failedAgentEvalOutcomes();
  }
  if (trialResults.length !== expectedTrialCount) {
    errors.push(
      `trialResults must contain exactly ${String(expectedTrialCount)} records`,
    );
  }

  const seenTrials = new Set();
  const seenResultEvidence = new Set();
  const seenAdjudicationEvidence = new Set();
  const parsed = [];
  for (const [index, trialResult] of trialResults.entries()) {
    const label = `trialResults[${String(index)}]`;
    if (
      !hasExactKeys(
        trialResult,
        ["split", "caseId", "architecture", "trial", "result", "adjudication"],
        label,
        errors,
      )
    ) {
      continue;
    }
    const splitCaseIds =
      trialResult.split === "development"
        ? corpus.developmentCaseIds
        : trialResult.split === "locked_holdout"
          ? corpus.lockedHoldoutCaseIds
          : null;
    if (splitCaseIds === null) {
      errors.push(`${label}.split is invalid`);
    }
    if (
      typeof trialResult.caseId !== "string" ||
      !agentReleaseEvalCaseIdPattern.test(trialResult.caseId) ||
      !splitCaseIds?.includes(trialResult.caseId)
    ) {
      errors.push(`${label}.caseId must belong to its declared corpus split`);
    }
    if (!agentReleaseEvalArchitectures.includes(trialResult.architecture)) {
      errors.push(`${label}.architecture is invalid`);
    }
    if (
      !Number.isSafeInteger(trialResult.trial) ||
      trialResult.trial < 1 ||
      trialResult.trial > agentReleaseEvalFixedTrialsPerCase
    ) {
      errors.push(
        `${label}.trial must be an integer from 1 to ${String(agentReleaseEvalFixedTrialsPerCase)}`,
      );
    }

    const resultValid = validateAgentEvalTrialResult(
      trialResult.result,
      `${label}.result`,
      errors,
    );
    const adjudicationValid = validateAgentEvalTrialAdjudication(
      trialResult.adjudication,
      `${label}.adjudication`,
      errors,
    );
    const identity = [
      trialResult.split,
      trialResult.caseId,
      trialResult.architecture,
      trialResult.trial,
    ].join(":");
    if (seenTrials.has(identity)) {
      errors.push(`Duplicate release-eval trial: ${identity}`);
    }
    seenTrials.add(identity);
    if (resultValid) {
      if (seenResultEvidence.has(trialResult.result.outputSha256)) {
        errors.push(
          `${label}.result.outputSha256 must bind a distinct identity-bearing trial result`,
        );
      }
      seenResultEvidence.add(trialResult.result.outputSha256);
    }
    if (adjudicationValid) {
      if (
        seenAdjudicationEvidence.has(trialResult.adjudication.evidenceSha256)
      ) {
        errors.push(
          `${label}.adjudication.evidenceSha256 must bind distinct per-trial adjudication evidence`,
        );
      }
      seenAdjudicationEvidence.add(trialResult.adjudication.evidenceSha256);
    }
    parsed.push(trialResult);
  }

  for (const [split, caseIds] of [
    ["development", corpus.developmentCaseIds],
    ["locked_holdout", corpus.lockedHoldoutCaseIds],
  ]) {
    for (const caseId of caseIds) {
      for (const architecture of agentReleaseEvalArchitectures) {
        for (
          let trial = 1;
          trial <= agentReleaseEvalFixedTrialsPerCase;
          trial += 1
        ) {
          const identity = [split, caseId, architecture, trial].join(":");
          if (!seenTrials.has(identity)) {
            errors.push(`Missing release-eval trial: ${identity}`);
          }
        }
      }
    }
  }

  const development = deriveAgentEvalSplitOutcome(parsed, "development");
  const lockedHoldout = deriveAgentEvalSplitOutcome(parsed, "locked_holdout");
  return {
    development,
    lockedHoldout,
    releaseEligible:
      development.passed &&
      development.criticalFailures === 0 &&
      lockedHoldout.passed &&
      lockedHoldout.criticalFailures === 0,
  };
}

function validateAgentEvalTrialResult(result, label, errors) {
  if (
    !hasExactKeys(result, ["criticalFailures", "outputSha256"], label, errors)
  ) {
    return false;
  }
  let valid = true;
  if (
    !Number.isSafeInteger(result.criticalFailures) ||
    result.criticalFailures < 0
  ) {
    errors.push(`${label}.criticalFailures must be a non-negative integer`);
    valid = false;
  }
  if (!hashPattern.test(result.outputSha256 ?? "")) {
    errors.push(`${label}.outputSha256 must be a lowercase SHA-256 hash`);
    valid = false;
  }
  return valid;
}

function validateAgentEvalTrialAdjudication(adjudication, label, errors) {
  if (
    !hasExactKeys(
      adjudication,
      ["passed", "criticalFailures", "evidenceSha256"],
      label,
      errors,
    )
  ) {
    return false;
  }
  let valid = true;
  if (typeof adjudication.passed !== "boolean") {
    errors.push(`${label}.passed must be boolean`);
    valid = false;
  }
  if (
    !Number.isSafeInteger(adjudication.criticalFailures) ||
    adjudication.criticalFailures < 0
  ) {
    errors.push(`${label}.criticalFailures must be a non-negative integer`);
    valid = false;
  }
  if (!hashPattern.test(adjudication.evidenceSha256 ?? "")) {
    errors.push(`${label}.evidenceSha256 must be a lowercase SHA-256 hash`);
    valid = false;
  }
  return valid;
}

function deriveAgentEvalSplitOutcome(trialResults, split) {
  const splitResults = trialResults.filter(
    (trialResult) => trialResult.split === split,
  );
  let criticalFailures = 0;
  let passed = splitResults.length > 0;
  for (const trialResult of splitResults) {
    const resultFailures = Number.isSafeInteger(
      trialResult.result?.criticalFailures,
    )
      ? trialResult.result.criticalFailures
      : 1;
    const adjudicationFailures = Number.isSafeInteger(
      trialResult.adjudication?.criticalFailures,
    )
      ? trialResult.adjudication.criticalFailures
      : 1;
    criticalFailures += Math.max(resultFailures, adjudicationFailures);
    passed =
      passed &&
      resultFailures === 0 &&
      adjudicationFailures === 0 &&
      trialResult.adjudication?.passed === true;
  }
  return {
    passed,
    criticalFailures: Number.isSafeInteger(criticalFailures)
      ? criticalFailures
      : Number.MAX_SAFE_INTEGER,
  };
}

function failedAgentEvalOutcomes() {
  return {
    development: { passed: false, criticalFailures: 1 },
    lockedHoldout: { passed: false, criticalFailures: 1 },
    releaseEligible: false,
  };
}

function validAgentEvalCaseIdList(value, expectedLength) {
  return (
    Array.isArray(value) &&
    value.length === expectedLength &&
    new Set(value).size === value.length &&
    value.every(
      (caseId) =>
        typeof caseId === "string" &&
        agentReleaseEvalCaseIdPattern.test(caseId),
    )
  );
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function sameAgentEvalOutcome(claimed, derived) {
  return (
    claimed?.passed === derived.passed &&
    claimed?.criticalFailures === derived.criticalFailures
  );
}

function validateAgentEvalOutcome(outcome, label, errors) {
  if (!hasExactKeys(outcome, ["passed", "criticalFailures"], label, errors)) {
    return;
  }
  if (typeof outcome.passed !== "boolean") {
    errors.push(`outcomes.${label}.passed must be boolean`);
  }
  if (
    !Number.isSafeInteger(outcome.criticalFailures) ||
    outcome.criticalFailures < 0
  ) {
    errors.push(
      `outcomes.${label}.criticalFailures must be a non-negative integer`,
    );
  }
}

function hasExactKeys(value, expectedKeys, label, errors) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    errors.push(`${label} must contain exactly ${expected.join(", ")}`);
    return false;
  }
  return true;
}

function validVersionArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every(
      (version) =>
        typeof version === "string" &&
        version.length > 0 &&
        version.length <= 200,
    )
  );
}

function sameVersionSet(left, right) {
  if (!validVersionArray(left) || !validVersionArray(right)) return false;
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}

function evaluateExternalProof(evidenceById, errors) {
  const evidence = [...evidenceById.values()];
  const physical = evidence.filter((item) => item.kind === "physical_device");
  const recipientRecords = evidence.filter(
    (item) =>
      item.kind === "human_session" && item.details?.cohort === "recipient",
  );
  const clientRecords = evidence.filter(
    (item) =>
      item.kind === "human_session" && item.details?.cohort === "client",
  );
  const recipients = uniqueHumanParticipants(recipientRecords, errors);
  const clients = uniqueHumanParticipants(clientRecords, errors);
  const accessibility = evidence.filter(
    (item) => item.kind === "accessibility_audit",
  );
  const publicDemo = evidence.filter((item) => item.kind === "public_url");
  const reviews = evidence.filter((item) => item.kind === "review");
  const linkAssets = new Set(
    evidence
      .filter((item) => item.kind === "link_check")
      .map((item) => item.details?.asset),
  );
  const blockers = [];
  if (physical.length < requiredExternalEvidence.physicalDevice)
    blockers.push("physical_iphone_golden_and_recovery_path_unproven");
  if (recipients.length < requiredExternalEvidence.recipientSessions)
    blockers.push("two_recipient_sessions_unproven");
  if (clients.length < requiredExternalEvidence.clientSessions)
    blockers.push("two_client_sessions_unproven");
  if (accessibility.length < requiredExternalEvidence.accessibilityAudits)
    blockers.push("accessibility_audit_unproven");
  if (publicDemo.length < requiredExternalEvidence.publicDemoUrls)
    blockers.push("public_demo_https_and_recipient_security_unproven");
  if (reviews.length < requiredExternalEvidence.independentReviews)
    blockers.push("independent_p0_p1_review_unproven");
  for (const asset of requiredExternalEvidence.linkAssets) {
    if (!linkAssets.has(asset))
      blockers.push(`logged_out_${asset}_link_unproven`);
  }
  return {
    required: requiredExternalEvidence,
    observed: {
      physicalDevice: physical.length,
      recipientSessions: recipients.length,
      clientSessions: clients.length,
      accessibilityAudits: accessibility.length,
      publicDemoUrls: publicDemo.length,
      linkAssets: [...linkAssets].sort(),
      independentReviews: reviews.length,
    },
    blockers,
    complete: blockers.length === 0,
  };
}

function uniqueHumanParticipants(records, errors) {
  const unique = new Map();
  for (const record of records) {
    const key = `${record.details?.cohort}:${record.details?.participantHash}`;
    if (unique.has(key)) {
      errors.push(
        `Human evidence ${record.id} duplicates participant ${record.details?.participantHash} in cohort ${record.details?.cohort}`,
      );
      continue;
    }
    unique.set(key, record);
  }
  return [...unique.values()];
}

function validateFindings(findings, errors) {
  if (!Array.isArray(findings)) {
    errors.push("unresolvedFindings must be an array");
    return;
  }
  for (const finding of findings) {
    if (
      !finding?.id ||
      !new Set(["P0", "P1", "P2", "P3"]).has(finding.severity)
    ) {
      errors.push("Every unresolved finding requires an id and P0-P3 severity");
    }
  }
}

function validateReviewerFindings(findings, errors) {
  if (!Array.isArray(findings))
    errors.push("reviewerFindings must be an array");
}

function validatePublicUrls(records, errors) {
  if (!Array.isArray(records)) {
    errors.push("publicUrlsChecked must be an array");
    return;
  }
  for (const record of records)
    if (!isSafeHttpsUrl(record?.url))
      errors.push(
        "publicUrlsChecked entries must use HTTPS without query strings or fragments",
      );
}

function validateStringArrayRecords(records, label, errors) {
  if (!Array.isArray(records)) {
    errors.push(`${label} must be an array`);
    return;
  }
  for (const record of records) {
    if (typeof record?.id !== "string" || typeof record?.reason !== "string")
      errors.push(`${label} records require id and reason`);
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

function isSafeHttpsUrl(raw) {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isSuccessfulHttpStatus(status) {
  return Number.isInteger(status) && status >= 200 && status < 400;
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function percentage(earned, applicable) {
  return applicable === 0
    ? 0
    : Number(((earned / applicable) * 100).toFixed(2));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
