import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import {
  canonicalJson,
  defaultEvidenceInput,
  loadContracts,
  repositoryRoot,
  requiredCommands,
  requiredLiveProviders,
  requiredSuiteAssertions,
  sha256,
  validateAndBuildManifest,
} from "./validation.mjs";

const startedAt = "2026-07-15T00:00:00.000Z";
const endedAt = "2026-07-15T02:00:00.000Z";
const observedAt = "2026-07-15T01:00:00.000Z";
const releaseId = "5e75a2a0-2c22-4a38-9f42-98033e0018cf";
const commitSha = "a".repeat(40);

function requiredSuiteAssertionsForTest(suite) {
  return [...(requiredSuiteAssertions[suite] ?? [])];
}

async function createFixture(t) {
  const runDirectory = `artifacts/validation/u12-test-${randomUUID()}`;
  const absoluteDirectory = resolve(repositoryRoot, runDirectory);
  await mkdir(absoluteDirectory, { recursive: true });
  t.after(async () => rm(absoluteDirectory, { recursive: true, force: true }));
  const contracts = await loadContracts();
  const input = defaultEvidenceInput({ now: startedAt, commitSha });
  input.release = {
    environmentType: "production_observed",
    releaseId,
    commitSha,
    startedAt,
    endedAt,
    webDeploymentId: "vercel-production-20260716",
    workerDeploymentId: "fly-production-20260716",
    iosBuildId: "ios-production-101",
    androidBuildId: "android-production-101",
    modelVersions: ["gpt-release-candidate"],
    promptVersions: ["inspection-draft-v1"],
    benchmarkProfileSha256: "b".repeat(64),
    rawSampleSha256: "c".repeat(64),
    commands: [],
  };
  input.skippedChecks = [];

  async function artifact(
    name,
    content = { name },
    mediaType = "application/json",
  ) {
    const extension = mediaType.startsWith("image/") ? "png" : "json";
    const path = `${runDirectory}/${name}.${extension}`;
    const bytes = Buffer.isBuffer(content)
      ? content
      : Buffer.from(`${JSON.stringify(content)}\n`, "utf8");
    await writeFile(resolve(repositoryRoot, path), bytes);
    return { path, sha256: sha256(bytes), bytes: bytes.byteLength, mediaType };
  }

  async function evidence(kind, id, details, artifacts = null) {
    const record = {
      id,
      kind,
      claim: `Observed production evidence for ${id} is bound to this release candidate.`,
      provenance: {
        mode: "observed",
        environmentType: "production_observed",
        observer: "named release reviewer",
        observedAt,
      },
      releaseBinding: { releaseId, commitSha },
      artifacts: artifacts ?? [await artifact(id)],
      sensitivity: "non_sensitive_redacted",
      containsCustomerData: false,
      containsSecrets: false,
      details,
    };
    input.evidence.push(record);
    return record;
  }

  const commandSuite = {
    "pnpm lint": "static_quality",
    "pnpm typecheck": "static_quality",
    "pnpm test": "recovery",
    "pnpm test:integration": "integration",
    "pnpm test:e2e:web": "web_e2e",
    "pnpm test:e2e:mobile": "mobile_e2e",
    "pnpm test:eval": "agent_eval",
    "pnpm test:soak": "soak",
    "pnpm test:pdf": "pdf",
    "pnpm test:security": "security",
    "pnpm build": "static_quality",
  };
  const commandEvidence = {};
  for (const [index, command] of requiredCommands.entries()) {
    const id = `command-${index}`;
    await evidence("automated_run", id, {
      suite: commandSuite[command],
      command,
      exitCode: 0,
      productionConfiguration: true,
      syntheticOrDeidentifiedInputs: true,
      assertions: requiredSuiteAssertionsForTest(commandSuite[command]),
    });
    commandEvidence[command] = id;
    input.release.commands.push({
      command,
      status: "pass",
      exitCode: 0,
      evidenceIds: [id],
    });
  }

  const supplementalSuites = [
    "native_capability",
    "evidence_integrity",
    "module_package",
    "professional_boundary",
    "provider_reconciliation",
    "commercial_outcome_control",
    "accessibility",
    "recipient_report",
  ];
  for (const suite of supplementalSuites) {
    await evidence("automated_run", `suite-${suite.replaceAll("_", "-")}`, {
      suite,
      command: `node scripts/release-tests/${suite}.mjs`,
      exitCode: 0,
      productionConfiguration: true,
      syntheticOrDeidentifiedInputs: true,
      assertions: requiredSuiteAssertionsForTest(suite),
    });
  }

  const buildWeekPayload = {
    schemaVersion: 1,
    milestone: "build_week",
    outcome: "complete",
    generatedAt: startedAt,
    run: { environmentType: "build_week_observed", commitSha },
    blockers: [],
    validationErrors: [],
  };
  const buildWeekHash = sha256(canonicalJson(buildWeekPayload));
  const buildWeekManifest = {
    ...buildWeekPayload,
    integrity: { algorithm: "sha256", canonicalPayloadSha256: buildWeekHash },
    completionEvent: {
      eventType: "build_week.milestone.completed",
      occurredAt: startedAt,
      manifestPayloadSha256: buildWeekHash,
    },
  };
  const buildWeekArtifact = await artifact(
    "build-week-manifest",
    buildWeekManifest,
  );
  input.buildWeekManifest = {
    artifact: buildWeekArtifact,
    manifestPayloadSha256: buildWeekHash,
  };
  await evidence(
    "build_week_manifest",
    "build-week-preserved",
    {
      milestone: "build_week",
      outcome: "complete",
      completionEventPresent: true,
      manifestPayloadSha256: buildWeekHash,
    },
    [buildWeekArtifact],
  );

  const providerIds = {};
  for (const [provider, scenarios] of Object.entries(requiredLiveProviders)) {
    const id = `provider-${provider.replaceAll("_", "-")}`;
    providerIds[provider] = id;
    await evidence("live_provider", id, {
      provider,
      providerMode: "live",
      liveCredentials: true,
      userAuthorised: true,
      controlledNonCustomerSubject: true,
      observedProviderResult: true,
      terminalOrReconciled: true,
      idempotentReplayVerified: true,
      idempotencyKeyHash: "1".repeat(64),
      requestFingerprintHash: "2".repeat(64),
      providerReferenceHash: "3".repeat(64),
      scenarios: [...scenarios],
    });
  }

  await evidence("privileged_security", "privileged-security", {
    totpEnrolled: true,
    aal1Denied: true,
    aal2Allowed: true,
    recentStepUpRequired: true,
    staleStepUpDenied: true,
    idleExpiryDenied: true,
    absoluteExpiryDeniedAfterFreshJwt: true,
    sessionRowRevocationDenied: true,
    deviceRevocationDenied: true,
    alternateDeviceSubstitutionDenied: true,
    recipientGrantRevocationDenied: true,
    idleBoundMinutes: 30,
    absoluteBoundHours: 12,
  });
  await evidence("secret_control", "secret-control", {
    environmentSeparated: true,
    leastScoped: true,
    managedRuntimeOnly: true,
    noClientServiceCredentials: true,
    dualKeyOverlapObserved: true,
    decryptOnlyWindowObserved: true,
    retiredKeyDenied: true,
    emergencyRevocationObserved: true,
    crossEnvironmentKeyDenied: true,
    accessAuditObserved: true,
    services: ["web", "worker", "mobile", "providers"],
  });
  await evidence("restore_drill", "restore-drill", {
    isolatedEnvironment: true,
    egressDefaultOff: true,
    providerCallsDuringRestore: 0,
    workerRunsDuringRestore: 0,
    egressEnabledOnlyAfterReconciliation: true,
    revokedAccessResurrected: 0,
    suppressedDataResurrected: 0,
    staleSessionsResurrected: 0,
    currentPointerRegressions: 0,
    externalSideEffectsRepeated: 0,
    measuredRpoSeconds: 20,
    targetRpoSeconds: 60,
    measuredRtoSeconds: 300,
    targetRtoSeconds: 600,
    checks: {
      artifact_checksums: "pass",
      event_replay: "pass",
      recipient_grants: "pass",
      deletion_suppressions: "pass",
      session_invalidation: "pass",
      package_pointers: "pass",
      provider_truth: "pass",
      worker_outbox: "pass",
    },
  });

  const deviceBase = {
    osVersion: "release-floor-os",
    deviceIdentifierHash: "4".repeat(64),
    benchmarkProfileSha256: "b".repeat(64),
    rawSampleSha256: "c".repeat(64),
    durabilityOraclePassed: true,
    fullJourneyPassed: true,
    offlineTerminationPassed: true,
    revocationAndLostDeviceBoundaryPassed: true,
    zeroLostArtifacts: true,
    zeroDuplicateArtifactIdentities: true,
    photoCount: 300,
    voiceNoteCount: 30,
    investigationCount: 10,
    offlineMinutes: 20,
    freeStorageBytesAtStart: 6_000_000_000,
    batteryPercentAtStart: 80,
    thermalStateAtStart: "nominal",
    completedOnsite: true,
    desktopReconstruction: false,
    shutterAckP95Ms: 120,
    localSaveP95Ms: 600,
    voiceStartP95Ms: 250,
    transcriptP95Seconds: 12,
    draftP95Seconds: 45,
    closeoutSeconds: 280,
    adverseTrials: [
      "sunlight",
      "wet_hand",
      "light_glove",
      "one_handed",
      "stairs_interruption",
      "text_200_percent",
      "haptics_off",
      "audio_off",
    ],
  };
  await evidence("physical_device", "device-ios-floor", {
    ...deviceBase,
    platform: "ios",
    supportFloor: "iphone_12_or_slower",
    isPhysical: true,
    isManagedCloudDevice: false,
    appBuildId: input.release.iosBuildId,
    model: "iPhone 12",
  });
  await evidence("physical_device", "device-android-floor", {
    ...deviceBase,
    platform: "android",
    supportFloor: "pixel_6_or_slower",
    isPhysical: false,
    isManagedCloudDevice: true,
    appBuildId: input.release.androidBuildId,
    model: "Pixel 6 managed device",
    deviceIdentifierHash: "5".repeat(64),
  });

  const humanIds = { inspector: [], recipient: [], client: [] };
  const inspectorScenarios = [
    "cracked_tile",
    "timber_pest_access",
    "representative_combined",
  ];
  for (let index = 0; index < 3; index += 1) {
    const id = `human-inspector-${index}`;
    humanIds.inspector.push(id);
    await evidence("human_session", id, {
      cohort: "inspector",
      participantHash: `${index + 6}`.repeat(64),
      success: true,
      durationSeconds: 3600,
      taps: 110,
      corrections: 1,
      assistance: "none",
      deviceOrBrowser: "launch-floor mobile app",
      officeFollowup: false,
      missedContext: [],
      unsafePrompts: [],
      licensedInspector: true,
      jobHash: `${index + 1}`.repeat(64),
      scenario: inspectorScenarios[index],
      completedOnsite: true,
    });
  }
  for (let index = 0; index < 5; index += 1) {
    const recipientId = `human-recipient-${index}`;
    humanIds.recipient.push(recipientId);
    await evidence("human_session", recipientId, {
      cohort: "recipient",
      participantHash: sha256(`recipient-${index}`),
      success: true,
      durationSeconds: 25,
      taps: 3,
      corrections: 0,
      assistance: "none",
      deviceOrBrowser: "mobile browser",
      officeFollowup: false,
      missedContext: [],
      unsafePrompts: [],
      majorBuildingUnderstood: true,
      timberPestUnderstood: true,
      limitationsUnderstood: true,
    });
    const clientId = `human-client-${index}`;
    humanIds.client.push(clientId);
    await evidence("human_session", clientId, {
      cohort: "client",
      participantHash: sha256(`client-${index}`),
      success: true,
      durationSeconds: 240,
      taps: 18,
      corrections: 0,
      assistance: "none",
      deviceOrBrowser: "mobile browser",
      officeFollowup: false,
      missedContext: [],
      unsafePrompts: [],
      journeyCompleted: true,
    });
  }
  await evidence("human_sample_census", "human-census", {
    lockedBeforeSessionsAt: startedAt,
    containsEveryRecruitedSession: true,
    selectionMethod:
      "Predeclared representative inspector, recipient and client cohorts with no post-session exclusions.",
    inspectorSessionIds: humanIds.inspector,
    recipientSessionIds: humanIds.recipient,
    clientSessionIds: humanIds.client,
  });

  const professionalIds = [];
  for (const scope of [
    "building_matrix",
    "timber_pest_matrix",
    "report_and_agreement_content",
    "privacy_terms_business_identity",
    "inspector_credentials",
  ]) {
    const id = `review-${scope.replaceAll("_", "-")}`;
    professionalIds.push(id);
    await evidence("professional_review", id, {
      scope,
      approved: true,
      reviewedVersionSha256: sha256(scope),
      reviewerRole:
        scope === "privacy_terms_business_identity"
          ? "qualified privacy and business reviewer"
          : "licensed Queensland inspector",
      licensedInspector: scope !== "privacy_terms_business_identity",
    });
  }

  const accessibilityIds = [];
  for (const platform of ["web", "ios", "android"]) {
    const id = `accessibility-${platform}`;
    accessibilityIds.push(id);
    await evidence("accessibility_audit", id, {
      platform,
      completeCriticalJourney: true,
      blockingFindings: 0,
      seriousOrCriticalAutomatedFindings: 0,
      assistiveTechnology:
        platform === "web"
          ? "keyboard and screen reader"
          : `${platform} screen reader`,
      states: [
        "keyboard",
        "screen_reader",
        "text_200_percent",
        "reduced_motion",
        "audio_off",
        "haptics_off",
      ],
    });
  }
  await evidence("code_review", "adversarial-review", {
    unresolvedP0: 0,
    unresolvedP1: 0,
    scopes: [
      "implementation",
      "security",
      "data_integrity",
      "accessibility",
      "product_boundary",
      "document",
    ],
  });

  const publicUrlIds = [];
  for (const expected of contracts.domains.domains) {
    const id = `url-${expected.host.replaceAll(".", "-")}`;
    publicUrlIds.push(id);
    const requestedUrl = `https://${expected.host}${contracts.domains.probePath}`;
    const finalUrl = `${expected.canonicalOrigin}${contracts.domains.probePath}`;
    const observation = await artifact(`${id}-http`, {
      requestedUrl,
      finalUrl,
    });
    const screenshot = await artifact(
      `${id}-screenshot`,
      Buffer.from(`test screenshot for ${expected.host}`, "utf8"),
      "image/png",
    );
    await evidence(
      "public_url",
      id,
      {
        requestedUrl,
        finalUrl,
        status: 200,
        loggedOut: true,
        expectedText: expected.expectedText,
        expectedContentPresent: true,
        authBoundaryChecked: true,
        reportIdentifiersExposed: false,
        privateMediaDenied: true,
        hstsObserved: true,
        webDeploymentId: input.release.webDeploymentId,
        redirectChain:
          expected.role === "canonical"
            ? []
            : [{ status: 308, location: finalUrl }],
        responseBodySha256: sha256(expected.expectedText),
      },
      [observation, screenshot],
    );
  }

  const id = (suite) => `suite-${suite.replaceAll("_", "-")}`;
  const commandId = (command) => commandEvidence[command];
  const rubricEvidence = {
    EI1: [id("native_capability"), "device-ios-floor", "device-android-floor"],
    EI2: [id("evidence_integrity")],
    EI3: [commandId("pnpm test:soak"), "device-ios-floor"],
    EI4: [id("module_package")],
    EI5: [commandId("pnpm test"), ...Object.values(providerIds)],
    IF1: ["device-ios-floor", "device-android-floor"],
    IF2: ["device-ios-floor"],
    IF3: [commandId("pnpm test:e2e:mobile"), "device-ios-floor"],
    IF4: [...humanIds.inspector],
    IF5: ["device-ios-floor", "device-android-floor"],
    AI1: [commandId("pnpm test:eval"), providerIds.openai],
    AI2: [commandId("pnpm test:eval")],
    AI3: [commandId("pnpm test:eval")],
    AI4: [commandId("pnpm test:eval")],
    AI5: [commandId("pnpm test:eval"), providerIds.openai],
    RC1: ["human-census", ...humanIds.recipient],
    RC2: [id("recipient_report"), ...publicUrlIds],
    RC3: [id("recipient_report"), ...publicUrlIds],
    RC4: [commandId("pnpm test:pdf"), ...publicUrlIds],
    RC5: [commandId("pnpm test:e2e:web"), ...publicUrlIds],
    AC1: [id("accessibility"), ...accessibilityIds],
    AC2: [...accessibilityIds, "device-ios-floor", "device-android-floor"],
    AC3: [id("accessibility"), ...accessibilityIds],
    AC4: accessibilityIds,
    SO1: [
      commandId("pnpm test:security"),
      "privileged-security",
      ...publicUrlIds,
    ],
    SO2: [commandId("pnpm test:security"), "secret-control"],
    SO3: [id("provider_reconciliation"), ...Object.values(providerIds)],
    SO4: ["restore-drill"],
    SO5: [commandId("pnpm test:e2e:web"), ...publicUrlIds],
  };
  input.rubricResults = input.rubricResults.map((result) => ({
    ...result,
    status: "pass",
    evidenceIds: rubricEvidence[result.id],
    reason: "Observed release evidence meets the fixed binary check.",
  }));

  const allProviders = Object.values(providerIds);
  const gateEvidence = {
    build_week_manifest_preserved: ["build-week-preserved"],
    evidence_integrity: [
      id("native_capability"),
      id("evidence_integrity"),
      commandId("pnpm test:soak"),
      "device-ios-floor",
      "device-android-floor",
    ],
    ai_safety_and_authority: [commandId("pnpm test:eval"), providerIds.openai],
    professional_boundary: [id("professional_boundary"), ...professionalIds],
    independent_module_approval_and_package: [id("module_package")],
    tenant_recipient_and_webhook_security: [commandId("pnpm test:security")],
    cancellation_withdrawal_and_provider_truth: [
      id("provider_reconciliation"),
      ...allProviders,
    ],
    append_only_outbox_and_reconciliation: [commandId("pnpm test:integration")],
    production_privileged_security: ["privileged-security"],
    production_secret_rotation: ["secret-control"],
    live_provider_reconciliation: allProviders,
    professional_matrix_and_content_review: professionalIds,
    lifecycle_and_isolated_restore: ["restore-drill"],
    launch_device_floor: ["device-ios-floor", "device-android-floor"],
    full_human_validation: [
      "human-census",
      ...humanIds.inspector,
      ...humanIds.recipient,
      ...humanIds.client,
    ],
    launch_floor_accessibility: accessibilityIds,
    canonical_public_domains: publicUrlIds,
    first_paid_booking_control: [id("commercial_outcome_control")],
    no_unresolved_p0_or_p1: ["adversarial-review"],
  };
  input.mustPassGates = input.mustPassGates.map((gate) => ({
    ...gate,
    status: "pass",
    evidenceIds: gateEvidence[gate.id],
    reason: "Observed release evidence satisfies the mandatory gate.",
  }));

  return { contracts, input, artifact, runDirectory };
}

test("Revenue Activation keeps the immutable 100-point rubric with no N/A", async () => {
  const { rubric } = await loadContracts();
  assert.equal(rubric.items.length, 29);
  assert.equal(new Set(rubric.items.map((item) => item.id)).size, 29);
  assert.equal(
    rubric.items.reduce((sum, item) => sum + item.points, 0),
    100,
  );
  assert.equal("notApplicableAllowlist" in rubric, false);
  assert.equal(rubric.mustPassGates.length, 19);
});

test("no supplied proof emits a structurally valid blocked manifest", async () => {
  const contracts = await loadContracts();
  const input = defaultEvidenceInput({
    now: startedAt,
    commitSha: "uncommitted",
  });
  const result = await validateAndBuildManifest(input, contracts, {
    generatedAt: endedAt,
  });
  assert.equal(result.valid, true);
  assert.equal(result.complete, false);
  assert.equal(result.manifest.outcome, "blocked");
  assert.equal(result.manifest.completionEvent, null);
  assert.equal(result.manifest.commercialValidationEvent, null);
  assert.equal(
    result.manifest.commercialOutcome.status,
    "awaiting_first_paid_booking",
  );
  assert.equal(result.manifest.validationErrors.length, 0);
  assert.ok(
    result.manifest.blockers.includes("live_provider_observations_incomplete"),
  );
});

test("a complete checksummed production fixture passes while first revenue remains pending", async (t) => {
  const { contracts, input } = await createFixture(t);
  const result = await validateAndBuildManifest(input, contracts, {
    generatedAt: endedAt,
  });
  assert.equal(result.valid, true, result.manifest.validationErrors.join("\n"));
  assert.equal(result.complete, true, result.manifest.blockers.join("\n"));
  assert.equal(result.manifest.rubric.percent, 100);
  assert.equal(
    result.manifest.commercialOutcome.status,
    "awaiting_first_paid_booking",
  );
  assert.equal(result.manifest.commercialValidationEvent, null);
  assert.equal(
    result.manifest.completionEvent.eventType,
    "revenue_activation.release.validated",
  );
  const {
    integrity,
    completionEvent: _completionEvent,
    commercialValidationEvent: _commercialEvent,
    ...payload
  } = result.manifest;
  assert.equal(
    integrity.canonicalPayloadSha256,
    sha256(canonicalJson(payload)),
  );
});

test("an observed first paid booking emits a separate commercial event", async (t) => {
  const { contracts, input, artifact } = await createFixture(t);
  input.evidence.push({
    id: "first-paid-booking",
    kind: "first_paid_booking",
    claim:
      "The first legitimate customer paid booking was observed through the canonical production journey.",
    provenance: {
      mode: "observed",
      environmentType: "production_observed",
      observer: "named commercial reviewer",
      observedAt,
    },
    releaseBinding: { releaseId, commitSha },
    artifacts: [await artifact("first-paid-booking")],
    sensitivity: "non_sensitive_redacted",
    containsCustomerData: false,
    containsSecrets: false,
    details: {
      legitimateCustomer: true,
      providerMode: "live",
      paymentState: "paid",
      bookingState: "confirmed",
      amountMinor: 100,
      currency: "AUD",
      bookingHash: "6".repeat(64),
      paymentProviderReferenceHash: "7".repeat(64),
      funnelEventHash: "8".repeat(64),
      userAuthorizationEventHash: "9".repeat(64),
    },
  });
  input.commercialOutcome = {
    status: "observed",
    evidenceIds: ["first-paid-booking"],
    reason: null,
  };
  const result = await validateAndBuildManifest(input, contracts, {
    generatedAt: endedAt,
  });
  assert.equal(
    result.complete,
    true,
    result.manifest.validationErrors.join("\n"),
  );
  assert.equal(
    result.manifest.commercialValidationEvent.eventType,
    "revenue_activation.first_paid_booking.observed",
  );
});

test("artifact tampering and verification bypass both fail closed", async (t) => {
  const { contracts, input } = await createFixture(t);
  const artifact = input.evidence[0].artifacts[0];
  await writeFile(resolve(repositoryRoot, artifact.path), "tampered\n");
  const tampered = await validateAndBuildManifest(input, contracts, {
    generatedAt: endedAt,
  });
  assert.equal(tampered.valid, false);
  assert.match(
    tampered.manifest.validationErrors.join("\n"),
    /artifact (byte count|checksum) mismatch/u,
  );

  const bypassed = await validateAndBuildManifest(input, contracts, {
    generatedAt: endedAt,
    verifyArtifacts: false,
  });
  assert.equal(bypassed.complete, false);
  assert.ok(
    bypassed.manifest.blockers.includes("artifact_verification_bypassed"),
  );
  assert.equal(bypassed.manifest.completionEvent, null);
});

test("non-sensitive declarations do not excuse leaked fields or text artifacts", async (t) => {
  const { contracts, input, artifact } = await createFixture(t);
  const provider = input.evidence.find(
    (record) => record.id === "provider-openai",
  );
  provider.details.apiKey = `sk-proj-${"x".repeat(32)}`;
  provider.artifacts.push(
    await artifact("leaked-observation", { email: "buyer@example.com" }),
  );
  const result = await validateAndBuildManifest(input, contracts);
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /forbidden sensitive field/u,
  );
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /possible OpenAI credential/u,
  );
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /artifact contains a possible email address/u,
  );
});

test("Revenue Activation rejects not_applicable and evidence-free pass assertions", async () => {
  const contracts = await loadContracts();
  const input = defaultEvidenceInput({ now: startedAt, commitSha });
  input.rubricResults[0].status = "not_applicable";
  input.mustPassGates[0].status = "pass";
  const result = await validateAndBuildManifest(input, contracts, {
    verifyArtifacts: false,
  });
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /Revenue Activation has no N\/A/u,
  );
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /cannot pass without observed evidence/u,
  );
});

test("missing provider reconciliation scenario blocks a claimed live gate", async (t) => {
  const { contracts, input } = await createFixture(t);
  const stripe = input.evidence.find(
    (record) => record.id === "provider-stripe",
  );
  stripe.details.scenarios = stripe.details.scenarios.filter(
    (scenario) => scenario !== "unknown_outcome_reconciled",
  );
  const result = await validateAndBuildManifest(input, contracts);
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /missing authorised observed reconciliation scenarios/u,
  );
});

test("human census prevents omitted failure sessions from being hidden", async (t) => {
  const { contracts, input } = await createFixture(t);
  const omitted = input.evidence.find(
    (record) => record.id === "human-client-0",
  );
  omitted.details.success = false;
  omitted.details.journeyCompleted = false;
  const census = input.evidence.find((record) => record.id === "human-census");
  census.details.clientSessionIds = census.details.clientSessionIds.filter(
    (id) => id !== omitted.id,
  );
  const gate = input.mustPassGates.find(
    (item) => item.id === "full_human_validation",
  );
  gate.evidenceIds = gate.evidenceIds.filter((id) => id !== omitted.id);
  const result = await validateAndBuildManifest(input, contracts);
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /omitted from the full-human-validation gate/u,
  );
});

test("a generic green command cannot replace named suite assertions", async (t) => {
  const { contracts, input } = await createFixture(t);
  const security = input.evidence.find(
    (record) => record.details?.suite === "security",
  );
  security.details.assertions = ["cross_tenant_denied"];
  const result = await validateAndBuildManifest(input, contracts);
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /missing required security assertions/u,
  );
});

test("the Build Week gate must bind the exact preserved manifest bytes", async (t) => {
  const { contracts, input } = await createFixture(t);
  const record = input.evidence.find(
    (item) => item.id === "build-week-preserved",
  );
  record.details.manifestPayloadSha256 = "f".repeat(64);
  const result = await validateAndBuildManifest(input, contracts);
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /does not bind the exact preserved manifest reference/u,
  );
});

test("device metrics and paid amounts reject type-coerced strings", async (t) => {
  const { contracts, input, artifact } = await createFixture(t);
  const ios = input.evidence.find((record) => record.id === "device-ios-floor");
  ios.details.photoCount = "300";
  input.evidence.push({
    id: "first-paid-string-amount",
    kind: "first_paid_booking",
    claim:
      "This deliberately malformed paid-booking record must be rejected by type checks.",
    provenance: {
      mode: "observed",
      environmentType: "production_observed",
      observer: "named test reviewer",
      observedAt,
    },
    releaseBinding: { releaseId, commitSha },
    artifacts: [await artifact("first-paid-string-amount")],
    sensitivity: "non_sensitive_redacted",
    containsCustomerData: false,
    containsSecrets: false,
    details: {
      legitimateCustomer: true,
      providerMode: "live",
      paymentState: "paid",
      bookingState: "confirmed",
      amountMinor: "100",
      currency: "AUD",
      bookingHash: "6".repeat(64),
      paymentProviderReferenceHash: "7".repeat(64),
      funnelEventHash: "8".repeat(64),
      userAuthorizationEventHash: "9".repeat(64),
    },
  });
  input.commercialOutcome = {
    status: "observed",
    evidenceIds: ["first-paid-string-amount"],
    reason: null,
  };
  const result = await validateAndBuildManifest(input, contracts);
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /does not prove the declared launch floor/u,
  );
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /is not an observed legitimate payment/u,
  );
});

test("restore cannot pass with egress or resurrected state", async (t) => {
  const { contracts, input } = await createFixture(t);
  const restore = input.evidence.find(
    (record) => record.id === "restore-drill",
  );
  restore.details.providerCallsDuringRestore = 1;
  restore.details.staleSessionsResurrected = 1;
  const result = await validateAndBuildManifest(input, contracts);
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /measured isolated no-egress reconciliation/u,
  );
});

test("canonical-domain proof requires every declared alias and preserved query", async (t) => {
  const { contracts, input } = await createFixture(t);
  const gate = input.mustPassGates.find(
    (item) => item.id === "canonical_public_domains",
  );
  gate.evidenceIds = gate.evidenceIds.filter(
    (id) => id !== "url-www-houseinspect-co",
  );
  const seeIt = input.evidence.find(
    (record) => record.id === "url-seeitinspections-com-au",
  );
  seeIt.details.finalUrl = "https://seeitinspections.com.au/";
  const result = await validateAndBuildManifest(input, contracts);
  assert.equal(result.valid, false);
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /requires public URL evidence for www\.houseinspect\.co/u,
  );
  assert.match(
    result.manifest.validationErrors.join("\n"),
    /does not preserve the canonical probe path and query/u,
  );
});

test("the command writes a blocked manifest and exits 4 without external proof", async (t) => {
  const output = resolve(
    repositoryRoot,
    "artifacts",
    "validation",
    `u12-command-${randomUUID()}`,
    "manifest.json",
  );
  t.after(async () =>
    rm(resolve(output, ".."), { recursive: true, force: true }),
  );
  const run = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "run.mjs"), "--output", output],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(run.status, 4, run.stderr);
  const manifest = JSON.parse(await readFile(output, "utf8"));
  assert.equal(manifest.outcome, "blocked");
  assert.equal(manifest.validationErrors.length, 0);
  assert.equal(manifest.completionEvent, null);
});

test("the JSON contracts and generated template are parseable", async () => {
  for (const file of [
    "evidence-input.schema.json",
    "manifest.schema.json",
    "production-domains.json",
    "rubric.json",
  ]) {
    assert.equal(
      typeof JSON.parse(
        await readFile(resolve(import.meta.dirname, file), "utf8"),
      ),
      "object",
    );
  }
  const generated = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "create-evidence-input.mjs")],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const input = JSON.parse(generated.stdout);
  assert.equal(input.rubricResults.length, 29);
  assert.equal(input.mustPassGates.length, 19);
  assert.equal(input.commercialOutcome.status, "awaiting_first_paid_booking");
});

test("deployment configs encode the Revenue Activation routing and release floors", async () => {
  const contracts = await loadContracts();
  const vercel = JSON.parse(
    await readFile(resolve(repositoryRoot, "vercel.json"), "utf8"),
  );
  assert.deepEqual(vercel.regions, ["syd1"]);
  const redirectsByHost = new Map(
    vercel.redirects.map((redirect) => [
      redirect.has.find((condition) => condition.type === "host")?.value,
      redirect,
    ]),
  );
  for (const domain of contracts.domains.domains.filter(
    (item) => item.role !== "canonical",
  )) {
    const redirect = redirectsByHost.get(domain.host);
    assert.ok(redirect, `missing redirect for ${domain.host}`);
    assert.equal(redirect.permanent, true);
    assert.equal(redirect.destination, `${domain.canonicalOrigin}/:path*`);
  }
  for (const domain of contracts.domains.domains.filter(
    (item) => item.role === "canonical",
  )) {
    assert.equal(redirectsByHost.has(domain.host), false);
  }

  const fly = await readFile(resolve(repositoryRoot, "fly.toml"), "utf8");
  assert.match(fly, /primary_region = "syd"/u);
  assert.match(fly, /kill_signal = "SIGTERM"/u);
  assert.match(fly, /kill_timeout = 30/u);
  assert.match(fly, /strategy = "rolling"/u);
  assert.match(fly, /policy = "on-failure"/u);
  assert.match(fly, /processes = \["worker"\]/u);

  const eas = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/mobile/eas.json"), "utf8"),
  );
  assert.equal(eas.build.production.distribution, "store");
  assert.equal(eas.build.production.environment, "production");
  assert.equal(eas.build.production.ios.credentialsSource, "remote");
  assert.equal(eas.build.production.ios.autoIncrement, "buildNumber");
  assert.equal(eas.build.production.android.credentialsSource, "remote");
  assert.equal(eas.build.production.android.autoIncrement, "versionCode");
  assert.equal(eas.build.production.android.buildType, "app-bundle");
});
