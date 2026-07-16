import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "../..");

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40,64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/u;
const SAFE_STATUSES = new Set(["pass", "fail", "unproven"]);
const FORBIDDEN_MANIFEST_KEY =
  /^(?:apiKey|authorizationHeader|clientName|contactDetails|customerName|email|mediaBytes|password|phone|privateKey|propertyAddress|rawPayload|recipientName|reportContent|secret|serviceRoleKey|streetAddress|token|transcript)$/iu;
const SENSITIVE_TEXT_PATTERNS = Object.freeze([
  { label: "email address", pattern: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu },
  {
    label: "bearer credential",
    pattern: /\bbearer\s+[a-z0-9._~+/-]{12,}/iu,
  },
  {
    label: "OpenAI credential",
    pattern: /\bsk-(?:proj-)?[a-z0-9_-]{16,}/iu,
  },
  {
    label: "Stripe live credential",
    pattern: /\b(?:sk|rk)_live_[a-z0-9]{12,}/iu,
  },
  { label: "Resend credential", pattern: /\bre_[a-z0-9_-]{16,}/iu },
  {
    label: "JWT credential",
    pattern: /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/iu,
  },
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
]);
const EVIDENCE_KINDS = new Set([
  "accessibility_audit",
  "automated_run",
  "build_week_manifest",
  "code_review",
  "first_paid_booking",
  "human_sample_census",
  "human_session",
  "live_provider",
  "physical_device",
  "privileged_security",
  "professional_review",
  "public_url",
  "restore_drill",
  "secret_control",
]);

export const requiredCommands = Object.freeze([
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "pnpm test:integration",
  "pnpm test:e2e:web",
  "pnpm test:e2e:mobile",
  "pnpm test:eval",
  "pnpm test:soak",
  "pnpm test:pdf",
  "pnpm test:security",
  "pnpm build",
]);

export const requiredLiveProviders = Object.freeze({
  stripe: [
    "checkout_completed",
    "webhook_replay_deduplicated",
    "reschedule_payment_preserved",
    "refund_observed",
    "unknown_outcome_reconciled",
  ],
  google_calendar: [
    "freebusy_observed",
    "event_created",
    "event_rescheduled",
    "event_cancelled",
    "unknown_outcome_reconciled",
  ],
  resend: [
    "send_accepted",
    "delivery_or_terminal_state_observed",
    "duplicate_suppressed",
    "bounce_or_failure_reconciled",
  ],
  openai: [
    "development_eval_passed",
    "locked_holdout_passed",
    "timeout_manual_fallback_passed",
    "store_false_verified",
  ],
});

export const requiredSuiteAssertions = Object.freeze({
  accessibility: [
    "no_serious_or_critical_findings",
    "keyboard_and_screen_reader",
    "reflow_and_reduced_motion",
  ],
  agent_eval: [
    "development_regression_passed",
    "locked_holdout_passed",
    "zero_critical_failures",
    "zero_taxonomy_leakage",
    "no_human_or_provider_authority",
    "manual_fallback_passed",
    "store_false_and_trace_redaction",
  ],
  commercial_outcome_control: [
    "live_paid_state_required",
    "legitimate_customer_required",
    "redacted_event_append_only",
  ],
  evidence_integrity: [
    "independent_byte_length_hash_readback",
    "quarantine_on_divergence",
    "immutable_originals",
  ],
  integration: [
    "transactional_outbox",
    "stale_worker_fenced",
    "unknown_provider_reconciled",
    "append_only_event_order",
  ],
  module_package: [
    "independent_module_approvals",
    "exact_current_snapshots",
    "mixed_version_denied",
    "stale_professional_command_denied",
  ],
  native_capability: [
    "durable_sync",
    "atomic_rename",
    "failure_surface",
    "startup_reconciliation",
  ],
  professional_boundary: [
    "zero_transaction_advice",
    "zero_repair_cost",
    "zero_valuation",
    "zero_guarantee",
    "bounded_not_observed",
  ],
  provider_reconciliation: [
    "no_send_after_cancellation_or_withdrawal",
    "literal_provider_states",
    "idempotent_replay",
    "unknown_before_retry",
  ],
  recipient_report: [
    "module_taxonomies_separate",
    "material_limitations_visible",
    "html_pdf_semantic_parity",
    "historical_versions_preserved",
  ],
  security: [
    "cross_tenant_denied",
    "revoked_recipient_denied",
    "private_media_denied",
    "forged_webhook_denied",
    "untrusted_content_quarantined",
    "service_secret_scan_passed",
  ],
  soak: [
    "three_hundred_photos",
    "thirty_voice_notes",
    "zero_lost_artifacts",
    "zero_duplicate_identities",
  ],
});

const requiredRestoreChecks = Object.freeze([
  "artifact_checksums",
  "event_replay",
  "recipient_grants",
  "deletion_suppressions",
  "session_invalidation",
  "package_pointers",
  "provider_truth",
  "worker_outbox",
]);

const requiredProfessionalReviews = Object.freeze([
  "building_matrix",
  "timber_pest_matrix",
  "report_and_agreement_content",
  "privacy_terms_business_identity",
  "inspector_credentials",
]);

const rubricEvidenceKinds = Object.freeze({
  EI1: ["automated_run", "physical_device"],
  EI2: ["automated_run"],
  EI3: ["automated_run", "physical_device"],
  EI4: ["automated_run"],
  EI5: ["automated_run", "physical_device", "live_provider"],
  IF1: ["physical_device"],
  IF2: ["physical_device"],
  IF3: ["automated_run", "physical_device"],
  IF4: ["physical_device", "human_session"],
  IF5: ["physical_device"],
  AI1: ["automated_run", "live_provider"],
  AI2: ["automated_run"],
  AI3: ["automated_run"],
  AI4: ["automated_run"],
  AI5: ["automated_run", "live_provider"],
  RC1: ["human_session", "human_sample_census"],
  RC2: ["automated_run", "public_url"],
  RC3: ["automated_run", "public_url"],
  RC4: ["automated_run", "public_url"],
  RC5: ["automated_run", "public_url"],
  AC1: ["automated_run", "accessibility_audit"],
  AC2: ["accessibility_audit", "physical_device"],
  AC3: ["automated_run", "accessibility_audit", "physical_device"],
  AC4: ["accessibility_audit"],
  SO1: ["automated_run", "privileged_security", "public_url"],
  SO2: ["automated_run", "secret_control"],
  SO3: ["automated_run", "live_provider"],
  SO4: ["restore_drill"],
  SO5: ["automated_run", "public_url"],
});

export async function loadContracts() {
  const [rubric, domains] = await Promise.all([
    readJson(resolve(scriptDirectory, "rubric.json")),
    readJson(resolve(scriptDirectory, "production-domains.json")),
  ]);
  return { rubric, domains };
}

export function defaultEvidenceInput({ now, commitSha = "uncommitted" }) {
  const releaseId = "00000000-0000-4000-8000-000000000000";
  return {
    schemaVersion: 1,
    release: {
      environmentType: "preproduction_unproven",
      releaseId,
      commitSha,
      startedAt: now,
      endedAt: now,
      webDeploymentId: null,
      workerDeploymentId: null,
      iosBuildId: null,
      androidBuildId: null,
      modelVersions: [],
      promptVersions: [],
      benchmarkProfileSha256: null,
      rawSampleSha256: null,
      commands: requiredCommands.map((command) => ({
        command,
        status: "unproven",
        exitCode: null,
        evidenceIds: [],
      })),
    },
    buildWeekManifest: null,
    evidence: [],
    rubricResults: [
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
    ].map((id) => ({
      id,
      status: "unproven",
      evidenceIds: [],
      reason: "No observed Revenue Activation evidence has been supplied.",
    })),
    mustPassGates: [
      "build_week_manifest_preserved",
      "evidence_integrity",
      "ai_safety_and_authority",
      "professional_boundary",
      "independent_module_approval_and_package",
      "tenant_recipient_and_webhook_security",
      "cancellation_withdrawal_and_provider_truth",
      "append_only_outbox_and_reconciliation",
      "production_privileged_security",
      "production_secret_rotation",
      "live_provider_reconciliation",
      "professional_matrix_and_content_review",
      "lifecycle_and_isolated_restore",
      "launch_device_floor",
      "full_human_validation",
      "launch_floor_accessibility",
      "canonical_public_domains",
      "first_paid_booking_control",
      "no_unresolved_p0_or_p1",
    ].map((id) => ({
      id,
      status: "unproven",
      evidenceIds: [],
      reason: "No observed Revenue Activation evidence has been supplied.",
    })),
    unresolvedFindings: [],
    skippedChecks: [
      {
        id: "external-revenue-activation-proof",
        reason:
          "Live providers, production security, human samples, restore, launch devices and canonical URLs have not been observed.",
      },
    ],
    commercialOutcome: {
      status: "awaiting_first_paid_booking",
      evidenceIds: [],
      reason:
        "No legitimate first paid customer booking has occurred or been supplied as evidence.",
    },
  };
}

export async function validateAndBuildManifest(input, contracts, options = {}) {
  const errors = [];
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (!isIsoDate(generatedAt))
    errors.push("generatedAt must be an ISO timestamp");
  validateTopLevel(input, errors);
  validateRelease(input.release, generatedAt, errors);
  const evidenceById = validateEvidence(input.evidence, input.release, errors);
  validateBuildWeekBinding(input.buildWeekManifest, evidenceById, errors);
  const rubric = validateRubricResults(
    input.rubricResults,
    contracts.rubric,
    evidenceById,
    errors,
  );
  const gates = validateGates(
    input.mustPassGates,
    contracts,
    evidenceById,
    errors,
  );
  const commandsComplete = validateCommands(
    input.release?.commands,
    evidenceById,
    errors,
  );
  validateFindings(input.unresolvedFindings, errors);
  validateSkippedChecks(input.skippedChecks, errors);
  const commercialOutcome = validateCommercialOutcome(
    input.commercialOutcome,
    evidenceById,
    errors,
  );

  if (options.verifyArtifacts !== false) {
    await verifyEvidenceArtifacts(evidenceById, errors);
    await verifyBuildWeekManifest(input.buildWeekManifest, errors);
  }

  const proof = evaluateProductionProof(input, contracts, evidenceById, errors);
  const unresolvedBlocking = (input.unresolvedFindings ?? []).some(
    (finding) =>
      finding?.status !== "resolved" &&
      (finding?.severity === "P0" || finding?.severity === "P1"),
  );
  const gateFailures = gates.filter((gate) => gate.status !== "pass");
  const atomicMustPassFailures = contracts.rubric.items
    .filter((item) => item.mustPass)
    .filter((item) => rubric.resultById.get(item.id)?.status !== "pass");
  const release = input.release ?? {};
  const complete =
    errors.length === 0 &&
    options.verifyArtifacts !== false &&
    release.environmentType === "production_observed" &&
    UUID.test(release.releaseId ?? "") &&
    COMMIT_SHA.test(release.commitSha ?? "") &&
    releaseBuildIdsPresent(release) &&
    commandsComplete &&
    rubric.percent >= contracts.rubric.thresholdPercent &&
    rubric.areas.every(
      (area) => area.percent >= contracts.rubric.minimumAreaPercent,
    ) &&
    atomicMustPassFailures.length === 0 &&
    gateFailures.length === 0 &&
    proof.complete &&
    !unresolvedBlocking &&
    (input.skippedChecks ?? []).length === 0;

  const blockers = [];
  if (release.environmentType !== "production_observed")
    blockers.push("environment_not_production_observed");
  if (!UUID.test(release.releaseId ?? ""))
    blockers.push("immutable_release_id_missing");
  if (!COMMIT_SHA.test(release.commitSha ?? ""))
    blockers.push("immutable_commit_sha_missing");
  if (!releaseBuildIdsPresent(release))
    blockers.push("release_build_identifiers_missing");
  if (!commandsComplete) blockers.push("required_release_commands_not_green");
  if (options.verifyArtifacts === false)
    blockers.push("artifact_verification_bypassed");
  if (rubric.percent < contracts.rubric.thresholdPercent)
    blockers.push("rubric_threshold_not_met");
  if (
    rubric.areas.some(
      (area) => area.percent < contracts.rubric.minimumAreaPercent,
    )
  ) {
    blockers.push("rubric_area_minimum_not_met");
  }
  if (atomicMustPassFailures.length > 0)
    blockers.push("atomic_must_pass_not_green");
  if (gateFailures.length > 0) blockers.push("must_pass_gate_not_green");
  if (unresolvedBlocking) blockers.push("unresolved_p0_or_p1");
  if ((input.skippedChecks ?? []).length > 0)
    blockers.push("skipped_release_checks_present");
  blockers.push(...proof.blockers);

  const payload = {
    schemaVersion: 1,
    milestone: "revenue_activation",
    outcome: complete ? "complete" : "blocked",
    generatedAt,
    release,
    buildWeekManifest: input.buildWeekManifest,
    evidence: input.evidence,
    rubric: {
      earnedPoints: rubric.earnedPoints,
      applicablePoints: 100,
      percent: rubric.percent,
      thresholdPercent: contracts.rubric.thresholdPercent,
      minimumAreaPercent: contracts.rubric.minimumAreaPercent,
      areas: rubric.areas,
      results: rubric.results,
    },
    mustPassGates: gates,
    productionProof: proof.summary,
    commercialOutcome,
    unresolvedFindings: input.unresolvedFindings,
    skippedChecks: input.skippedChecks,
    blockers: [...new Set(blockers)].sort(),
    validationErrors: [...new Set(errors)].sort(),
  };
  const canonicalPayloadSha256 = sha256(canonicalJson(payload));
  const completionEvent = complete
    ? {
        eventType: "revenue_activation.release.validated",
        occurredAt: generatedAt,
        releaseId: release.releaseId,
        manifestPayloadSha256: canonicalPayloadSha256,
      }
    : null;
  const commercialValidationEvent =
    commercialOutcome.status === "observed"
      ? {
          eventType: "revenue_activation.first_paid_booking.observed",
          occurredAt: generatedAt,
          releaseId: release.releaseId,
          evidenceIds: commercialOutcome.evidenceIds,
          manifestPayloadSha256: canonicalPayloadSha256,
        }
      : null;

  return {
    valid: errors.length === 0,
    complete,
    manifest: {
      ...payload,
      integrity: { algorithm: "sha256", canonicalPayloadSha256 },
      completionEvent,
      commercialValidationEvent,
    },
  };
}

function validateTopLevel(input, errors) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push("Evidence input must be an object");
    return;
  }
  if (input.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  for (const key of [
    "release",
    "evidence",
    "rubricResults",
    "mustPassGates",
    "unresolvedFindings",
    "skippedChecks",
    "commercialOutcome",
  ]) {
    if (!(key in input)) errors.push(`Missing top-level field: ${key}`);
  }
}

function validateRelease(release, generatedAt, errors) {
  if (!release || typeof release !== "object") {
    errors.push("release is required");
    return;
  }
  if (
    !new Set([
      "preproduction_unproven",
      "production_observed",
      "unit_test",
    ]).has(release.environmentType)
  ) {
    errors.push("release.environmentType is invalid");
  }
  if (!UUID.test(release.releaseId ?? ""))
    errors.push("release.releaseId must be a UUID");
  for (const key of ["startedAt", "endedAt"]) {
    if (!isIsoDate(release[key]))
      errors.push(`release.${key} must be an ISO timestamp`);
  }
  if (
    isIsoDate(release.startedAt) &&
    isIsoDate(release.endedAt) &&
    Date.parse(release.endedAt) < Date.parse(release.startedAt)
  ) {
    errors.push("release.endedAt cannot precede release.startedAt");
  }
  if (
    isIsoDate(release.endedAt) &&
    isIsoDate(generatedAt) &&
    Date.parse(release.endedAt) > Date.parse(generatedAt)
  ) {
    errors.push(
      "release.endedAt cannot be in the future relative to generatedAt",
    );
  }
  for (const key of ["modelVersions", "promptVersions", "commands"]) {
    if (!Array.isArray(release[key]))
      errors.push(`release.${key} must be an array`);
  }
  for (const key of ["benchmarkProfileSha256", "rawSampleSha256"]) {
    if (release[key] !== null && !SHA256.test(release[key] ?? ""))
      errors.push(`release.${key} must be null or a SHA-256 hash`);
  }
}

function validateEvidence(records, release, errors) {
  const byId = new Map();
  if (!Array.isArray(records)) {
    errors.push("evidence must be an array");
    return byId;
  }
  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      !SAFE_ID.test(record.id ?? "")
    ) {
      errors.push("Every evidence record requires a safe id");
      continue;
    }
    if (byId.has(record.id)) {
      errors.push(`Duplicate evidence id: ${record.id}`);
      continue;
    }
    byId.set(record.id, record);
    if (!EVIDENCE_KINDS.has(record.kind))
      errors.push(`Evidence ${record.id} has an invalid kind`);
    if (typeof record.claim !== "string" || record.claim.length < 20)
      errors.push(`Evidence ${record.id} requires a bounded claim`);
    if (record.provenance?.mode !== "observed")
      errors.push(`Evidence ${record.id} is not observed evidence`);
    if (record.provenance?.environmentType !== "production_observed")
      errors.push(`Evidence ${record.id} is not production-observed evidence`);
    if (
      typeof record.provenance?.observer !== "string" ||
      record.provenance.observer.length < 3
    ) {
      errors.push(`Evidence ${record.id} requires a named observer`);
    }
    if (!isIsoDate(record.provenance?.observedAt))
      errors.push(`Evidence ${record.id} requires an observedAt timestamp`);
    if (
      isIsoDate(record.provenance?.observedAt) &&
      isIsoDate(release?.startedAt) &&
      isIsoDate(release?.endedAt) &&
      (Date.parse(record.provenance.observedAt) <
        Date.parse(release.startedAt) ||
        Date.parse(record.provenance.observedAt) > Date.parse(release.endedAt))
    ) {
      errors.push(
        `Evidence ${record.id} falls outside the release evidence window`,
      );
    }
    if (
      record.releaseBinding?.releaseId !== release?.releaseId ||
      record.releaseBinding?.commitSha !== release?.commitSha
    ) {
      errors.push(
        `Evidence ${record.id} is not bound to this release and commit`,
      );
    }
    if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
      errors.push(
        `Evidence ${record.id} requires at least one checksummed artifact`,
      );
    } else {
      for (const artifact of record.artifacts)
        validateArtifact(artifact, record.id, errors);
    }
    if (record.sensitivity !== "non_sensitive_redacted")
      errors.push(
        `Evidence ${record.id} must be declared non-sensitive and redacted`,
      );
    if (
      record.containsCustomerData !== false ||
      record.containsSecrets !== false
    )
      errors.push(
        `Evidence ${record.id} must not contain customer data or secrets`,
      );
    validateNonSensitiveManifestRecord(record, errors);
    validateEvidenceDetails(record, release, errors);
  }
  return byId;
}

function validateArtifact(artifact, evidenceId, errors) {
  if (
    !artifact ||
    typeof artifact !== "object" ||
    !isSafeArtifactPath(artifact.path) ||
    !SHA256.test(artifact.sha256 ?? "") ||
    !Number.isInteger(artifact.bytes) ||
    artifact.bytes <= 0 ||
    typeof artifact.mediaType !== "string" ||
    artifact.mediaType.length < 3
  ) {
    errors.push(
      `Evidence ${evidenceId} has an invalid artifact path, hash, byte count or media type`,
    );
  }
}

function validateEvidenceDetails(record, release, errors) {
  const details = record.details ?? {};
  if (record.kind === "automated_run") validateAutomatedRun(record, errors);
  if (record.kind === "build_week_manifest") {
    if (
      details.milestone !== "build_week" ||
      details.outcome !== "complete" ||
      details.completionEventPresent !== true ||
      !SHA256.test(details.manifestPayloadSha256 ?? "")
    ) {
      errors.push(
        `Build Week evidence ${record.id} is not a completed manifest`,
      );
    }
  }
  if (record.kind === "live_provider") validateLiveProvider(record, errors);
  if (record.kind === "privileged_security")
    validatePrivilegedSecurity(record, errors);
  if (record.kind === "secret_control") validateSecretControl(record, errors);
  if (record.kind === "restore_drill") validateRestoreDrill(record, errors);
  if (record.kind === "physical_device")
    validatePhysicalDevice(record, release, errors);
  if (record.kind === "human_session") validateHumanSession(record, errors);
  if (record.kind === "human_sample_census")
    validateHumanSampleCensus(record, errors);
  if (record.kind === "public_url") validatePublicUrl(record, release, errors);
  if (record.kind === "professional_review")
    validateProfessionalReview(record, errors);
  if (record.kind === "accessibility_audit")
    validateAccessibilityAudit(record, errors);
  if (record.kind === "code_review") validateCodeReview(record, errors);
  if (record.kind === "first_paid_booking")
    validateFirstPaidBooking(record, errors);
}

function validateAutomatedRun(record, errors) {
  const details = record.details ?? {};
  const suites = new Set([
    "accessibility",
    "agent_eval",
    "commercial_outcome_control",
    "evidence_integrity",
    "integration",
    "mobile_e2e",
    "module_package",
    "native_capability",
    "pdf",
    "professional_boundary",
    "provider_reconciliation",
    "recipient_report",
    "recovery",
    "security",
    "soak",
    "static_quality",
    "web_e2e",
  ]);
  if (
    details.exitCode !== 0 ||
    typeof details.command !== "string" ||
    details.command.length < 4 ||
    !suites.has(details.suite) ||
    details.productionConfiguration !== true ||
    details.syntheticOrDeidentifiedInputs !== true
  ) {
    errors.push(
      `Automated evidence ${record.id} must be a successful known suite against production configuration and safe inputs`,
    );
  }
  const assertions = requiredSuiteAssertions[details.suite] ?? [];
  if (
    assertions.length > 0 &&
    (!Array.isArray(details.assertions) ||
      !assertions.every((assertion) => details.assertions.includes(assertion)))
  ) {
    errors.push(
      `Automated evidence ${record.id} is missing required ${details.suite} assertions`,
    );
  }
}

function validateLiveProvider(record, errors) {
  const details = record.details ?? {};
  const scenarios = requiredLiveProviders[details.provider];
  if (
    !scenarios ||
    details.providerMode !== "live" ||
    details.liveCredentials !== true ||
    details.userAuthorised !== true ||
    details.controlledNonCustomerSubject !== true ||
    details.observedProviderResult !== true ||
    details.terminalOrReconciled !== true ||
    details.idempotentReplayVerified !== true ||
    !SHA256.test(details.idempotencyKeyHash ?? "") ||
    !SHA256.test(details.requestFingerprintHash ?? "") ||
    !SHA256.test(details.providerReferenceHash ?? "") ||
    !Array.isArray(details.scenarios) ||
    !scenarios.every((scenario) => details.scenarios.includes(scenario))
  ) {
    errors.push(
      `Live-provider evidence ${record.id} is missing authorised observed reconciliation scenarios`,
    );
  }
}

function validatePrivilegedSecurity(record, errors) {
  const details = record.details ?? {};
  const requiredTrue = [
    "totpEnrolled",
    "aal1Denied",
    "aal2Allowed",
    "recentStepUpRequired",
    "staleStepUpDenied",
    "idleExpiryDenied",
    "absoluteExpiryDeniedAfterFreshJwt",
    "sessionRowRevocationDenied",
    "deviceRevocationDenied",
    "alternateDeviceSubstitutionDenied",
    "recipientGrantRevocationDenied",
  ];
  if (
    !requiredTrue.every((key) => details[key] === true) ||
    !Number.isFinite(details.idleBoundMinutes) ||
    details.idleBoundMinutes <= 0 ||
    !Number.isFinite(details.absoluteBoundHours) ||
    details.absoluteBoundHours <= 0
  ) {
    errors.push(
      `Privileged-security evidence ${record.id} does not prove MFA, step-up and bounded revocation`,
    );
  }
}

function validateSecretControl(record, errors) {
  const details = record.details ?? {};
  const requiredTrue = [
    "environmentSeparated",
    "leastScoped",
    "managedRuntimeOnly",
    "noClientServiceCredentials",
    "dualKeyOverlapObserved",
    "decryptOnlyWindowObserved",
    "retiredKeyDenied",
    "emergencyRevocationObserved",
    "crossEnvironmentKeyDenied",
    "accessAuditObserved",
  ];
  if (
    !requiredTrue.every((key) => details[key] === true) ||
    !Array.isArray(details.services) ||
    !["web", "worker", "mobile", "providers"].every((service) =>
      details.services.includes(service),
    )
  ) {
    errors.push(`Secret-control evidence ${record.id} is incomplete`);
  }
}

function validateRestoreDrill(record, errors) {
  const details = record.details ?? {};
  const checks = details.checks ?? {};
  if (
    details.isolatedEnvironment !== true ||
    details.egressDefaultOff !== true ||
    details.providerCallsDuringRestore !== 0 ||
    details.workerRunsDuringRestore !== 0 ||
    details.egressEnabledOnlyAfterReconciliation !== true ||
    details.revokedAccessResurrected !== 0 ||
    details.suppressedDataResurrected !== 0 ||
    details.staleSessionsResurrected !== 0 ||
    details.currentPointerRegressions !== 0 ||
    details.externalSideEffectsRepeated !== 0 ||
    !Number.isFinite(details.measuredRpoSeconds) ||
    details.measuredRpoSeconds < 0 ||
    !Number.isFinite(details.targetRpoSeconds) ||
    details.measuredRpoSeconds > details.targetRpoSeconds ||
    !Number.isFinite(details.measuredRtoSeconds) ||
    details.measuredRtoSeconds <= 0 ||
    !Number.isFinite(details.targetRtoSeconds) ||
    details.measuredRtoSeconds > details.targetRtoSeconds ||
    !requiredRestoreChecks.every((check) => checks[check] === "pass")
  ) {
    errors.push(
      `Restore evidence ${record.id} does not prove measured isolated no-egress reconciliation`,
    );
  }
}

function validatePhysicalDevice(record, release, errors) {
  const details = record.details ?? {};
  const ios = details.platform === "ios";
  const android = details.platform === "android";
  const expectedBuild = ios ? release?.iosBuildId : release?.androidBuildId;
  const requiredTrials = [
    "sunlight",
    "wet_hand",
    "light_glove",
    "one_handed",
    "stairs_interruption",
    "text_200_percent",
    "haptics_off",
    "audio_off",
  ];
  if (
    (!ios && !android) ||
    (ios &&
      (details.supportFloor !== "iphone_12_or_slower" ||
        details.isPhysical !== true)) ||
    (android &&
      (details.supportFloor !== "pixel_6_or_slower" ||
        (details.isPhysical !== true &&
          details.isManagedCloudDevice !== true))) ||
    details.appBuildId !== expectedBuild ||
    typeof details.model !== "string" ||
    typeof details.osVersion !== "string" ||
    !SHA256.test(details.deviceIdentifierHash ?? "") ||
    !SHA256.test(details.benchmarkProfileSha256 ?? "") ||
    details.benchmarkProfileSha256 !== release?.benchmarkProfileSha256 ||
    !SHA256.test(details.rawSampleSha256 ?? "") ||
    details.durabilityOraclePassed !== true ||
    details.fullJourneyPassed !== true ||
    details.offlineTerminationPassed !== true ||
    details.revocationAndLostDeviceBoundaryPassed !== true ||
    details.zeroLostArtifacts !== true ||
    details.zeroDuplicateArtifactIdentities !== true ||
    !Number.isInteger(details.photoCount) ||
    details.photoCount < 300 ||
    !Number.isInteger(details.voiceNoteCount) ||
    details.voiceNoteCount < 30 ||
    !Number.isInteger(details.investigationCount) ||
    details.investigationCount < 10 ||
    !Number.isFinite(details.offlineMinutes) ||
    details.offlineMinutes < 20 ||
    !Number.isInteger(details.freeStorageBytesAtStart) ||
    details.freeStorageBytesAtStart < 5_000_000_000 ||
    !Number.isFinite(details.batteryPercentAtStart) ||
    details.batteryPercentAtStart < 50 ||
    details.batteryPercentAtStart > 100 ||
    details.thermalStateAtStart !== "nominal" ||
    !Number.isFinite(details.shutterAckP95Ms) ||
    details.shutterAckP95Ms > 150 ||
    !Number.isFinite(details.localSaveP95Ms) ||
    details.localSaveP95Ms > 750 ||
    !Number.isFinite(details.voiceStartP95Ms) ||
    details.voiceStartP95Ms > 300 ||
    !Number.isFinite(details.transcriptP95Seconds) ||
    details.transcriptP95Seconds > 15 ||
    !Number.isFinite(details.draftP95Seconds) ||
    details.draftP95Seconds > 60 ||
    !Number.isFinite(details.closeoutSeconds) ||
    details.closeoutSeconds > 300 ||
    details.completedOnsite !== true ||
    details.desktopReconstruction !== false ||
    !Array.isArray(details.adverseTrials) ||
    !requiredTrials.every((trial) => details.adverseTrials.includes(trial))
  ) {
    errors.push(
      `Physical-device evidence ${record.id} does not prove the declared launch floor and full durability journey`,
    );
  }
}

function validateHumanSession(record, errors) {
  const details = record.details ?? {};
  if (
    !new Set(["inspector", "recipient", "client"]).has(details.cohort) ||
    !SHA256.test(details.participantHash ?? "") ||
    typeof details.success !== "boolean" ||
    !Number.isFinite(details.durationSeconds) ||
    details.durationSeconds <= 0 ||
    !Number.isInteger(details.taps) ||
    details.taps < 0 ||
    !Number.isInteger(details.corrections) ||
    details.corrections < 0 ||
    typeof details.assistance !== "string" ||
    typeof details.deviceOrBrowser !== "string" ||
    details.deviceOrBrowser.length < 3 ||
    typeof details.officeFollowup !== "boolean" ||
    !Array.isArray(details.missedContext) ||
    !Array.isArray(details.unsafePrompts)
  ) {
    errors.push(`Human-session evidence ${record.id} is incomplete`);
    return;
  }
  if (
    details.cohort === "inspector" &&
    (details.licensedInspector !== true ||
      !SHA256.test(details.jobHash ?? "") ||
      !new Set([
        "cracked_tile",
        "timber_pest_access",
        "representative_combined",
      ]).has(details.scenario) ||
      details.completedOnsite !== true ||
      details.officeFollowup !== false)
  ) {
    errors.push(`Inspector session ${record.id} is not a complete onsite job`);
  }
  if (
    details.cohort === "recipient" &&
    (details.durationSeconds > 30 ||
      ![
        "majorBuildingUnderstood",
        "timberPestUnderstood",
        "limitationsUnderstood",
      ].every((key) => typeof details[key] === "boolean"))
  ) {
    errors.push(
      `Recipient session ${record.id} lacks the 30-second comprehension result`,
    );
  }
  if (
    details.cohort === "client" &&
    typeof details.journeyCompleted !== "boolean"
  )
    errors.push(`Client session ${record.id} lacks a journey result`);
}

function validateHumanSampleCensus(record, errors) {
  const details = record.details ?? {};
  if (
    !isIsoDate(details.lockedBeforeSessionsAt) ||
    details.containsEveryRecruitedSession !== true ||
    typeof details.selectionMethod !== "string" ||
    details.selectionMethod.length < 20 ||
    !Array.isArray(details.inspectorSessionIds) ||
    !Array.isArray(details.recipientSessionIds) ||
    !Array.isArray(details.clientSessionIds) ||
    details.inspectorSessionIds.length < 3 ||
    details.recipientSessionIds.length < 5 ||
    details.clientSessionIds.length < 5
  ) {
    errors.push(`Human-sample census ${record.id} is incomplete or undersized`);
  }
}

function validatePublicUrl(record, release, errors) {
  const details = record.details ?? {};
  const imageArtifact = record.artifacts?.some((artifact) =>
    new Set(["image/png", "image/webp", "image/jpeg"]).has(artifact.mediaType),
  );
  const observationArtifact = record.artifacts?.some((artifact) =>
    new Set(["application/json", "text/html"]).has(artifact.mediaType),
  );
  if (
    !isSafeHttpsUrl(details.requestedUrl) ||
    !isSafeHttpsUrl(details.finalUrl) ||
    details.status !== 200 ||
    details.loggedOut !== true ||
    details.expectedContentPresent !== true ||
    details.authBoundaryChecked !== true ||
    details.reportIdentifiersExposed !== false ||
    details.privateMediaDenied !== true ||
    details.hstsObserved !== true ||
    details.webDeploymentId !== release?.webDeploymentId ||
    !Array.isArray(details.redirectChain) ||
    !SHA256.test(details.responseBodySha256 ?? "") ||
    !imageArtifact ||
    !observationArtifact
  ) {
    errors.push(`Public URL evidence ${record.id} is incomplete`);
  }
}

function validateProfessionalReview(record, errors) {
  const details = record.details ?? {};
  if (
    !requiredProfessionalReviews.includes(details.scope) ||
    details.approved !== true ||
    !SHA256.test(details.reviewedVersionSha256 ?? "") ||
    typeof details.reviewerRole !== "string" ||
    details.reviewerRole.length < 5 ||
    (new Set([
      "building_matrix",
      "timber_pest_matrix",
      "report_and_agreement_content",
      "inspector_credentials",
    ]).has(details.scope) &&
      details.licensedInspector !== true)
  ) {
    errors.push(`Professional review ${record.id} is incomplete`);
  }
}

function validateAccessibilityAudit(record, errors) {
  const details = record.details ?? {};
  if (
    !new Set(["web", "ios", "android"]).has(details.platform) ||
    details.completeCriticalJourney !== true ||
    details.blockingFindings !== 0 ||
    details.seriousOrCriticalAutomatedFindings !== 0 ||
    typeof details.assistiveTechnology !== "string" ||
    !Array.isArray(details.states) ||
    ![
      "keyboard",
      "screen_reader",
      "text_200_percent",
      "reduced_motion",
      "audio_off",
      "haptics_off",
    ].every((state) => details.states.includes(state))
  ) {
    errors.push(`Accessibility evidence ${record.id} is incomplete`);
  }
}

function validateCodeReview(record, errors) {
  const details = record.details ?? {};
  const scopes = [
    "implementation",
    "security",
    "data_integrity",
    "accessibility",
    "product_boundary",
    "document",
  ];
  if (
    details.unresolvedP0 !== 0 ||
    details.unresolvedP1 !== 0 ||
    !Array.isArray(details.scopes) ||
    !scopes.every((scope) => details.scopes.includes(scope))
  ) {
    errors.push(
      `Code-review evidence ${record.id} has incomplete scope or blockers`,
    );
  }
}

function validateFirstPaidBooking(record, errors) {
  const details = record.details ?? {};
  if (
    details.legitimateCustomer !== true ||
    details.providerMode !== "live" ||
    details.paymentState !== "paid" ||
    details.bookingState !== "confirmed" ||
    !Number.isInteger(details.amountMinor) ||
    details.amountMinor <= 0 ||
    details.currency !== "AUD" ||
    !SHA256.test(details.bookingHash ?? "") ||
    !SHA256.test(details.paymentProviderReferenceHash ?? "") ||
    !SHA256.test(details.funnelEventHash ?? "") ||
    !SHA256.test(details.userAuthorizationEventHash ?? "")
  ) {
    errors.push(
      `First-paid-booking evidence ${record.id} is not an observed legitimate payment`,
    );
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
    if (!SAFE_STATUSES.has(result.status))
      errors.push(
        `Rubric ${result.id} has an invalid status; Revenue Activation has no N/A`,
      );
    validateEvidenceReferences(
      result,
      evidenceById,
      errors,
      `Rubric ${result.id}`,
    );
    if (result.status === "pass") {
      const kinds = new Set(
        result.evidenceIds
          .map((id) => evidenceById.get(id)?.kind)
          .filter(Boolean),
      );
      if (
        !(rubricEvidenceKinds[result.id] ?? []).some((kind) => kinds.has(kind))
      )
        errors.push(
          `Rubric ${result.id} does not reference an allowed evidence kind`,
        );
    }
  }
  for (const id of expectedById.keys())
    if (!resultById.has(id)) errors.push(`Missing rubric id: ${id}`);
  const normalized = rubric.items.map((item) => ({
    ...item,
    status: resultById.get(item.id)?.status ?? "unproven",
    evidenceIds: resultById.get(item.id)?.evidenceIds ?? [],
    reason: resultById.get(item.id)?.reason ?? "Missing result",
  }));
  const earnedPoints = normalized
    .filter((item) => item.status === "pass")
    .reduce((sum, item) => sum + item.points, 0);
  const areas = [...new Set(rubric.items.map((item) => item.area))].map(
    (area) => {
      const items = normalized.filter((item) => item.area === area);
      const earned = items
        .filter((item) => item.status === "pass")
        .reduce((sum, item) => sum + item.points, 0);
      const available = items.reduce((sum, item) => sum + item.points, 0);
      return {
        area,
        earnedPoints: earned,
        availablePoints: available,
        percent: percentage(earned, available),
      };
    },
  );
  return {
    results: normalized,
    resultById,
    earnedPoints,
    percent: percentage(earnedPoints, 100),
    areas,
  };
}

function validateGates(gates, contracts, evidenceById, errors) {
  const expected = new Set(contracts.rubric.mustPassGates);
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
    if (!SAFE_STATUSES.has(gate.status))
      errors.push(`Must-pass gate ${gate.id} has an invalid status`);
    validateEvidenceReferences(
      gate,
      evidenceById,
      errors,
      `Must-pass gate ${gate.id}`,
    );
    if (gate.status === "pass")
      validateGateEvidence(gate, contracts, evidenceById, errors);
  }
  for (const id of expected)
    if (!seen.has(id)) errors.push(`Missing must-pass gate: ${id}`);
  return contracts.rubric.mustPassGates.map(
    (id) =>
      gates.find((gate) => gate.id === id) ?? {
        id,
        status: "unproven",
        evidenceIds: [],
        reason: "Missing gate",
      },
  );
}

function validateGateEvidence(gate, contracts, evidenceById, errors) {
  const records = gate.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter(Boolean);
  const kinds = new Set(records.map((record) => record.kind));
  const suites = new Set(
    records
      .filter((record) => record.kind === "automated_run")
      .map((record) => record.details?.suite),
  );
  const requireKind = (kind) => {
    if (!kinds.has(kind))
      errors.push(`Must-pass gate ${gate.id} requires ${kind} evidence`);
  };
  const requireSuite = (suite) => {
    if (!suites.has(suite))
      errors.push(
        `Must-pass gate ${gate.id} requires ${suite} automated evidence`,
      );
  };
  if (gate.id === "build_week_manifest_preserved")
    requireKind("build_week_manifest");
  if (gate.id === "evidence_integrity") {
    requireSuite("native_capability");
    requireSuite("evidence_integrity");
    requireSuite("soak");
    requireKind("physical_device");
  }
  if (gate.id === "ai_safety_and_authority") {
    requireSuite("agent_eval");
    const openai = records.find(
      (record) =>
        record.kind === "live_provider" &&
        record.details?.provider === "openai",
    );
    if (!openai)
      errors.push(
        `Must-pass gate ${gate.id} requires live OpenAI eval evidence`,
      );
  }
  if (gate.id === "professional_boundary") {
    requireSuite("professional_boundary");
    requireKind("professional_review");
  }
  if (gate.id === "independent_module_approval_and_package")
    requireSuite("module_package");
  if (gate.id === "tenant_recipient_and_webhook_security")
    requireSuite("security");
  if (gate.id === "cancellation_withdrawal_and_provider_truth") {
    requireSuite("provider_reconciliation");
    requireKind("live_provider");
  }
  if (gate.id === "append_only_outbox_and_reconciliation")
    requireSuite("integration");
  if (gate.id === "production_privileged_security")
    requireKind("privileged_security");
  if (gate.id === "production_secret_rotation") requireKind("secret_control");
  if (gate.id === "live_provider_reconciliation") {
    for (const provider of Object.keys(requiredLiveProviders)) {
      if (
        !records.some(
          (record) =>
            record.kind === "live_provider" &&
            record.details?.provider === provider,
        )
      )
        errors.push(
          `Must-pass gate ${gate.id} requires ${provider} live-provider evidence`,
        );
    }
  }
  if (gate.id === "professional_matrix_and_content_review") {
    for (const scope of requiredProfessionalReviews) {
      if (
        !records.some(
          (record) =>
            record.kind === "professional_review" &&
            record.details?.scope === scope,
        )
      )
        errors.push(
          `Must-pass gate ${gate.id} requires ${scope} review evidence`,
        );
    }
  }
  if (gate.id === "lifecycle_and_isolated_restore")
    requireKind("restore_drill");
  if (gate.id === "launch_device_floor")
    validateDeviceFloor(records, errors, gate.id);
  if (gate.id === "full_human_validation")
    validateHumanSample(records, [...evidenceById.values()], errors, gate.id);
  if (gate.id === "launch_floor_accessibility")
    validateAccessibilityFloor(records, errors, gate.id);
  if (gate.id === "canonical_public_domains")
    validateDomainProof(records, contracts.domains, errors, gate.id);
  if (gate.id === "first_paid_booking_control")
    requireSuite("commercial_outcome_control");
  if (gate.id === "no_unresolved_p0_or_p1") requireKind("code_review");
}

function validateDeviceFloor(records, errors, gateId) {
  for (const platform of ["ios", "android"]) {
    if (
      !records.some(
        (record) =>
          record.kind === "physical_device" &&
          record.details?.platform === platform,
      )
    )
      errors.push(
        `Must-pass gate ${gateId} requires ${platform} launch-floor evidence`,
      );
  }
}

function validateHumanSample(records, allEvidence, errors, gateId) {
  const census = records.filter(
    (record) => record.kind === "human_sample_census",
  );
  if (census.length !== 1) {
    errors.push(
      `Must-pass gate ${gateId} requires exactly one locked human-sample census`,
    );
    return;
  }
  const sessions = records.filter((record) => record.kind === "human_session");
  const allSessionIds = new Set(
    allEvidence
      .filter((record) => record.kind === "human_session")
      .map((record) => record.id),
  );
  const referencedSessionIds = new Set(sessions.map((record) => record.id));
  for (const id of allSessionIds) {
    if (!referencedSessionIds.has(id))
      errors.push(
        `Human session ${id} is omitted from the full-human-validation gate`,
      );
  }
  const byId = new Map(sessions.map((record) => [record.id, record]));
  const censusDetails = census[0].details;
  const cohorts = [
    ["inspector", censusDetails.inspectorSessionIds, 3],
    ["recipient", censusDetails.recipientSessionIds, 5],
    ["client", censusDetails.clientSessionIds, 5],
  ];
  const declared = new Set();
  for (const [cohort, ids, minimum] of cohorts) {
    if (!Array.isArray(ids) || ids.length < minimum) continue;
    for (const id of ids) {
      declared.add(id);
      if (byId.get(id)?.details?.cohort !== cohort)
        errors.push(
          `Human census references missing or wrong-cohort session ${id}`,
        );
    }
  }
  for (const session of sessions)
    if (!declared.has(session.id))
      errors.push(
        `Human session ${session.id} is omitted from the locked census`,
      );
  const inspector = sessions.filter(
    (record) => record.details?.cohort === "inspector",
  );
  const recipient = sessions.filter(
    (record) => record.details?.cohort === "recipient",
  );
  const client = sessions.filter(
    (record) => record.details?.cohort === "client",
  );
  if (
    new Set(inspector.map((record) => record.details?.jobHash)).size < 3 ||
    !inspector.every((record) => record.details?.success)
  )
    errors.push(
      `Must-pass gate ${gateId} requires three distinct successful inspector jobs`,
    );
  for (const scenario of ["cracked_tile", "timber_pest_access"])
    if (!inspector.some((record) => record.details?.scenario === scenario))
      errors.push(
        `Must-pass gate ${gateId} requires an inspector ${scenario} scenario`,
      );
  const recipientSuccess = recipient.filter(
    (record) =>
      record.details?.success &&
      record.details?.majorBuildingUnderstood &&
      record.details?.timberPestUnderstood &&
      record.details?.limitationsUnderstood,
  ).length;
  if (recipient.length < 5 || recipientSuccess / recipient.length < 0.9)
    errors.push(
      `Must-pass gate ${gateId} requires at least 90% recipient comprehension across the full sample`,
    );
  const clientSuccess = client.filter(
    (record) =>
      record.details?.success &&
      record.details?.journeyCompleted &&
      record.details?.durationSeconds <= 300,
  ).length;
  if (client.length < 5 || clientSuccess / client.length < 0.8)
    errors.push(
      `Must-pass gate ${gateId} requires at least 80% client completion across the full sample`,
    );
}

function validateAccessibilityFloor(records, errors, gateId) {
  for (const platform of ["web", "ios", "android"]) {
    if (
      !records.some(
        (record) =>
          record.kind === "accessibility_audit" &&
          record.details?.platform === platform,
      )
    )
      errors.push(
        `Must-pass gate ${gateId} requires ${platform} accessibility evidence`,
      );
  }
}

function validateDomainProof(records, domainsContract, errors, gateId) {
  const urls = records.filter((record) => record.kind === "public_url");
  const byHost = new Map();
  for (const record of urls) {
    let host;
    try {
      host = new URL(record.details?.requestedUrl).hostname;
    } catch {
      continue;
    }
    if (byHost.has(host))
      errors.push(`Duplicate public URL evidence for ${host}`);
    byHost.set(host, record);
  }
  for (const expected of domainsContract.domains) {
    const record = byHost.get(expected.host);
    if (!record) {
      errors.push(
        `Must-pass gate ${gateId} requires public URL evidence for ${expected.host}`,
      );
      continue;
    }
    const expectedRequested = `${"https://"}${expected.host}${domainsContract.probePath}`;
    const expectedFinal = `${expected.canonicalOrigin}${domainsContract.probePath}`;
    if (
      record.details.requestedUrl !== expectedRequested ||
      record.details.finalUrl !== expectedFinal
    )
      errors.push(
        `Public URL evidence for ${expected.host} does not preserve the canonical probe path and query`,
      );
    if (record.details.expectedText !== expected.expectedText)
      errors.push(
        `Public URL evidence for ${expected.host} has the wrong content assertion`,
      );
    const redirects = record.details.redirectChain ?? [];
    if (expected.role === "canonical" && redirects.length !== 0)
      errors.push(`Canonical host ${expected.host} must not redirect`);
    if (
      expected.role !== "canonical" &&
      (redirects.length === 0 ||
        !redirects.every(
          (hop) =>
            [301, 302, 307, 308].includes(hop.status) &&
            isSafeHttpsUrl(hop.location),
        ))
    )
      errors.push(
        `Alias host ${expected.host} requires an HTTPS redirect chain`,
      );
  }
  for (const host of byHost.keys())
    if (!domainsContract.domains.some((expected) => expected.host === host))
      errors.push(`Public URL evidence includes undeclared host ${host}`);
}

function validateCommands(commands, evidenceById, errors) {
  if (!Array.isArray(commands)) return false;
  const byCommand = new Map();
  for (const command of commands) {
    if (!command || typeof command.command !== "string") {
      errors.push("Each release command requires a command string");
      continue;
    }
    if (byCommand.has(command.command))
      errors.push(`Duplicate release command: ${command.command}`);
    byCommand.set(command.command, command);
    if (command.status !== "pass" || command.exitCode !== 0) continue;
    validateEvidenceReferences(
      command,
      evidenceById,
      errors,
      `Release command ${command.command}`,
    );
    const matching = command.evidenceIds.some((id) => {
      const record = evidenceById.get(id);
      return (
        record?.kind === "automated_run" &&
        record.details?.command === command.command
      );
    });
    if (!matching)
      errors.push(
        `Release command ${command.command} lacks matching automated evidence`,
      );
  }
  for (const expected of requiredCommands) {
    const command = byCommand.get(expected);
    if (!command) errors.push(`Missing required release command: ${expected}`);
  }
  return requiredCommands.every((expected) => {
    const command = byCommand.get(expected);
    return command?.status === "pass" && command.exitCode === 0;
  });
}

function validateFindings(findings, errors) {
  if (!Array.isArray(findings)) {
    errors.push("unresolvedFindings must be an array");
    return;
  }
  for (const finding of findings) {
    if (
      !SAFE_ID.test(finding?.id ?? "") ||
      !new Set(["P0", "P1", "P2", "P3"]).has(finding?.severity) ||
      !new Set(["open", "accepted", "resolved"]).has(finding?.status)
    )
      errors.push("Every finding requires a safe id, severity and status");
  }
}

function validateSkippedChecks(checks, errors) {
  if (!Array.isArray(checks)) {
    errors.push("skippedChecks must be an array");
    return;
  }
  for (const check of checks)
    if (
      !SAFE_ID.test(check?.id ?? "") ||
      typeof check?.reason !== "string" ||
      check.reason.length < 20
    )
      errors.push("Every skipped check requires a safe id and reason");
}

function validateCommercialOutcome(outcome, evidenceById, errors) {
  if (
    !outcome ||
    typeof outcome !== "object" ||
    !new Set(["awaiting_first_paid_booking", "observed"]).has(outcome.status)
  ) {
    errors.push("commercialOutcome has an invalid status");
    return {
      status: "invalid",
      evidenceIds: [],
      reason: "Invalid commercial outcome",
    };
  }
  validateEvidenceReferences(
    { ...outcome, status: outcome.status === "observed" ? "pass" : "unproven" },
    evidenceById,
    errors,
    "Commercial outcome",
  );
  const paidEvidence = (outcome.evidenceIds ?? []).filter(
    (id) => evidenceById.get(id)?.kind === "first_paid_booking",
  );
  if (outcome.status === "observed" && paidEvidence.length !== 1)
    errors.push(
      "Observed commercial outcome requires exactly one first-paid-booking evidence record",
    );
  if (outcome.status === "awaiting_first_paid_booking") {
    if ((outcome.evidenceIds ?? []).length !== 0)
      errors.push(
        "Awaiting commercial outcome cannot reference paid-booking evidence",
      );
    if (typeof outcome.reason !== "string" || outcome.reason.length < 20)
      errors.push("Awaiting commercial outcome requires an honest reason");
  }
  const orphaned =
    [...evidenceById.values()].some(
      (record) => record.kind === "first_paid_booking",
    ) && outcome.status !== "observed";
  if (orphaned)
    errors.push(
      "First-paid-booking evidence cannot be orphaned from the commercial outcome",
    );
  return {
    status: outcome.status,
    evidenceIds: outcome.evidenceIds ?? [],
    reason: outcome.reason ?? null,
  };
}

function evaluateProductionProof(input, contracts, evidenceById, errors) {
  const evidence = [...evidenceById.values()];
  const blockers = [];
  const providerEvidence = evidence.filter(
    (record) => record.kind === "live_provider",
  );
  const providers = Object.keys(requiredLiveProviders).filter((provider) =>
    providerEvidence.some((record) => record.details?.provider === provider),
  );
  if (providers.length !== Object.keys(requiredLiveProviders).length)
    blockers.push("live_provider_observations_incomplete");
  const privileged = evidence.filter(
    (record) => record.kind === "privileged_security",
  ).length;
  if (privileged < 1) blockers.push("production_mfa_session_proof_missing");
  const secrets = evidence.filter(
    (record) => record.kind === "secret_control",
  ).length;
  if (secrets < 1) blockers.push("production_secret_rotation_proof_missing");
  const restore = evidence.filter(
    (record) => record.kind === "restore_drill",
  ).length;
  if (restore < 1) blockers.push("measured_isolated_restore_proof_missing");
  const devices = Object.fromEntries(
    ["ios", "android"].map((platform) => [
      platform,
      evidence.filter(
        (record) =>
          record.kind === "physical_device" &&
          record.details?.platform === platform,
      ).length,
    ]),
  );
  if (devices.ios < 1 || devices.android < 1)
    blockers.push("launch_device_floor_proof_missing");
  const publicHosts = evidence
    .filter((record) => record.kind === "public_url")
    .map((record) => {
      try {
        return new URL(record.details?.requestedUrl).hostname;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (
    !contracts.domains.domains.every((domain) =>
      publicHosts.includes(domain.host),
    )
  )
    blockers.push("canonical_domain_alias_proof_missing");
  const census = evidence.filter(
    (record) => record.kind === "human_sample_census",
  ).length;
  if (census !== 1) blockers.push("full_human_sample_proof_missing");
  const buildWeekRecords = evidence.filter(
    (record) => record.kind === "build_week_manifest",
  );
  if (buildWeekRecords.length !== 1 || !input.buildWeekManifest)
    blockers.push("build_week_manifest_reference_missing");
  const reviews = evidence.filter(
    (record) => record.kind === "professional_review",
  );
  if (
    !requiredProfessionalReviews.every((scope) =>
      reviews.some((record) => record.details?.scope === scope),
    )
  )
    blockers.push("professional_review_scope_incomplete");
  const codeReviews = evidence.filter(
    (record) => record.kind === "code_review",
  ).length;
  if (codeReviews < 1) blockers.push("adversarial_review_proof_missing");
  if (errors.length > 0) blockers.push("evidence_validation_errors_present");
  return {
    complete: blockers.length === 0,
    blockers,
    summary: {
      complete: blockers.length === 0,
      liveProvidersObserved: providers.sort(),
      privilegedSecurityRecords: privileged,
      secretControlRecords: secrets,
      restoreDrillRecords: restore,
      deviceFloorRecords: devices,
      canonicalHostsObserved: [...new Set(publicHosts)].sort(),
      humanSampleCensusRecords: census,
      professionalReviewScopes: [
        ...new Set(reviews.map((record) => record.details?.scope)),
      ].sort(),
      codeReviewRecords: codeReviews,
      blockers,
    },
  };
}

async function verifyEvidenceArtifacts(evidenceById, errors) {
  for (const record of evidenceById.values()) {
    for (const artifact of record.artifacts ?? []) {
      if (!isSafeArtifactPath(artifact.path)) continue;
      await verifyArtifact(artifact, `Evidence ${record.id}`, errors);
    }
  }
}

async function verifyArtifact(artifact, label, errors) {
  const path = resolve(repositoryRoot, artifact.path);
  try {
    const rootReal = await realpath(repositoryRoot);
    const fileInfo = await lstat(path);
    if (fileInfo.isSymbolicLink()) {
      errors.push(
        `${label} artifact cannot be a symbolic link: ${artifact.path}`,
      );
      return;
    }
    const fileReal = await realpath(path);
    if (relative(rootReal, fileReal).startsWith("..")) {
      errors.push(`${label} artifact escapes the repository: ${artifact.path}`);
      return;
    }
    const bytes = await readFile(fileReal);
    if (bytes.byteLength !== artifact.bytes)
      errors.push(`${label} artifact byte count mismatch: ${artifact.path}`);
    if (sha256(bytes) !== artifact.sha256)
      errors.push(`${label} artifact checksum mismatch: ${artifact.path}`);
    if (
      artifact.mediaType === "application/json" ||
      artifact.mediaType?.startsWith("text/")
    ) {
      validateNonSensitiveText(
        bytes.toString("utf8"),
        `${label} artifact`,
        errors,
      );
    }
  } catch {
    errors.push(`${label} artifact is unreadable: ${artifact.path}`);
  }
}

function validateNonSensitiveManifestRecord(record, errors) {
  const visit = (value, path) => {
    if (typeof value === "string") {
      validateNonSensitiveText(
        value,
        `Evidence ${record.id} field ${path}`,
        errors,
      );
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_MANIFEST_KEY.test(key))
        errors.push(
          `Evidence ${record.id} contains forbidden sensitive field ${path}.${key}`,
        );
      visit(child, `${path}.${key}`);
    }
  };
  visit(record, "record");
}

function validateNonSensitiveText(value, label, errors) {
  for (const sensitive of SENSITIVE_TEXT_PATTERNS) {
    if (sensitive.pattern.test(value))
      errors.push(`${label} contains a possible ${sensitive.label}`);
  }
}

async function verifyBuildWeekManifest(reference, errors) {
  if (!reference || typeof reference !== "object") {
    return;
  }
  const artifact = reference.artifact;
  validateArtifact(artifact, "build-week-manifest-reference", errors);
  if (!artifact || !isSafeArtifactPath(artifact.path)) return;
  await verifyArtifact(artifact, "Build Week manifest", errors);
  try {
    const manifest = JSON.parse(
      await readFile(resolve(repositoryRoot, artifact.path), "utf8"),
    );
    if (
      manifest.milestone !== "build_week" ||
      manifest.outcome !== "complete" ||
      !manifest.completionEvent
    )
      errors.push("Referenced Build Week manifest is not complete");
    const { integrity, completionEvent, ...payload } = manifest;
    const expected = sha256(canonicalJson(payload));
    if (
      !SHA256.test(integrity?.canonicalPayloadSha256 ?? "") ||
      integrity.canonicalPayloadSha256 !== expected
    )
      errors.push(
        "Referenced Build Week manifest has an invalid internal checksum",
      );
    if (completionEvent?.manifestPayloadSha256 !== expected)
      errors.push(
        "Referenced Build Week completion event does not bind the manifest payload",
      );
    if (reference.manifestPayloadSha256 !== expected)
      errors.push(
        "buildWeekManifest reference checksum does not match the preserved manifest",
      );
  } catch {
    errors.push("Referenced Build Week manifest is not valid JSON");
  }
}

function validateBuildWeekBinding(reference, evidenceById, errors) {
  const records = [...evidenceById.values()].filter(
    (record) => record.kind === "build_week_manifest",
  );
  if (!reference && records.length === 0) return;
  if (!reference || records.length !== 1) {
    errors.push(
      "Build Week handoff requires one evidence record bound to one preserved manifest reference",
    );
    return;
  }
  const record = records[0];
  const artifact = reference.artifact;
  const matchingArtifact = record.artifacts?.some(
    (candidate) =>
      candidate.path === artifact?.path &&
      candidate.sha256 === artifact?.sha256 &&
      candidate.bytes === artifact?.bytes,
  );
  if (
    !matchingArtifact ||
    record.details?.manifestPayloadSha256 !== reference.manifestPayloadSha256
  ) {
    errors.push(
      "Build Week evidence record does not bind the exact preserved manifest reference",
    );
  }
}

function validateEvidenceReferences(item, evidenceById, errors, label) {
  if (!Array.isArray(item.evidenceIds)) {
    errors.push(`${label} evidenceIds must be an array`);
    return;
  }
  for (const id of item.evidenceIds)
    if (!evidenceById.has(id))
      errors.push(`${label} references missing evidence ${id}`);
  if (item.status === "pass" && item.evidenceIds.length === 0)
    errors.push(`${label} cannot pass without observed evidence`);
}

function releaseBuildIdsPresent(release) {
  return [
    "webDeploymentId",
    "workerDeploymentId",
    "iosBuildId",
    "androidBuildId",
  ].every(
    (key) => typeof release[key] === "string" && release[key].length >= 6,
  );
}

function isSafeArtifactPath(path) {
  if (typeof path !== "string" || path.length < 4 || isAbsolute(path))
    return false;
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.startsWith("artifacts/validation/") &&
    !normalized.split("/").includes("..")
  );
}

function isSafeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function percentage(earned, available) {
  return available === 0 ? 0 : Number(((earned / available) * 100).toFixed(2));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}
