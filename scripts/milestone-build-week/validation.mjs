import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../demo-seed/generate.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const hashPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40,64}$/u;
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
    schemaVersion: 1,
    run: {
      environmentType: "synthetic_test",
      startedAt: now,
      endedAt: now,
      commitSha,
      commands: [],
      modelVersions: [],
      promptVersions: [],
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
  const evidenceById = validateEvidence(input.evidence, errors);
  validateRun(input.run, errors);
  const rubricEvaluation = validateRubricResults(
    input.rubricResults,
    rubric,
    evidenceById,
    errors,
  );
  const gates = validateGates(
    input.mustPassGates,
    rubric,
    evidenceById,
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

  if (options.verifyArtifacts !== false) {
    await verifyEvidenceArtifacts(evidenceById, errors);
  }

  const externalProof = evaluateExternalProof(evidenceById);
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
}

function validateEvidence(records, errors) {
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
    validateEvidenceDetails(record, errors);
  }
  return byId;
}

function validateEvidenceDetails(record, errors) {
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

function validateGates(gates, rubric, evidenceById, errors) {
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
      validateGateEvidence(gate, evidenceById, errors);
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

function validateGateEvidence(gate, evidenceById, errors) {
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
    const liveEval = records.find(
      (record) =>
        record.kind === "automated_run" &&
        record.details?.suite === "agent_eval" &&
        record.details?.liveModel === true &&
        record.details?.developmentPassed === true &&
        record.details?.lockedHoldoutPassed === true &&
        record.details?.criticalFailures === 0,
    );
    if (!liveEval) {
      errors.push(
        `Must-pass gate ${gate.id} requires a live development and locked-holdout eval with zero critical failures`,
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
      if (sha256(bytes) !== evidence.artifact.sha256) {
        errors.push(`Evidence ${evidence.id} artifact checksum does not match`);
      }
    } catch {
      errors.push(
        `Evidence ${evidence.id} artifact is unreadable: ${evidence.artifact.path}`,
      );
    }
  }
}

function evaluateExternalProof(evidenceById) {
  const evidence = [...evidenceById.values()];
  const physical = evidence.filter((item) => item.kind === "physical_device");
  const recipients = evidence.filter(
    (item) =>
      item.kind === "human_session" && item.details?.cohort === "recipient",
  );
  const clients = evidence.filter(
    (item) =>
      item.kind === "human_session" && item.details?.cohort === "client",
  );
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
