import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseAllDocuments } from "yaml";

const root = process.cwd();
const flows = [
  "apps/mobile/e2e/termination-resume.yaml",
  "apps/mobile/e2e/capture-voice-offline.yaml",
  "apps/mobile/e2e/review-complete-delivery.yaml",
  "apps/mobile/e2e/investigation-coverage.yaml",
  // This flow intentionally resumes the persisted investigation and draft
  // created by the immediately preceding coverage flow.
  "apps/mobile/e2e/fresh-capture-recipient-overview.yaml",
  "apps/mobile/e2e/area-session-expiry.yaml",
];

const flowPrerequisites = new Map([
  [
    "apps/mobile/e2e/fresh-capture-recipient-overview.yaml",
    "apps/mobile/e2e/investigation-coverage.yaml",
  ],
]);
const nativeDevClientUrl =
  "exp+inspectionhub-field://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081";

const supportedContentSizes = new Set([
  "extra-small",
  "small",
  "medium",
  "large",
  "extra-large",
  "extra-extra-large",
  "extra-extra-extra-large",
  "accessibility-medium",
  "accessibility-large",
  "accessibility-extra-large",
  "accessibility-extra-extra-large",
  "accessibility-extra-extra-extra-large",
]);

const requiredText = new Map([
  [
    "apps/mobile/e2e/termination-resume.yaml",
    [
      "Test: terminate after rename",
      "Recovery checked 1 interrupted capture boundary.",
    ],
  ],
  [
    "apps/mobile/e2e/capture-voice-offline.yaml",
    [
      "Take photo",
      "Record voice note",
      "Test: go offline",
      "Test: return after partial sync",
      ".*Not saved — retry.*",
    ],
  ],
  [
    "apps/mobile/e2e/review-complete-delivery.yaml",
    [
      "Review & issue",
      "Accept finding",
      "Approve Building",
      "Approve Timber Pest",
      "Confirm delivery package",
      "Completion checklist",
      "Delivery queued",
    ],
  ],
  [
    "apps/mobile/e2e/area-session-expiry.yaml",
    [
      "Start investigation",
      "Change area",
      "Inspection · Finish the open investigation before approval or packaging.",
      "Test: expire session",
    ],
  ],
  [
    "apps/mobile/e2e/investigation-coverage.yaml",
    [
      "Attach recent (3)",
      "Add measurement",
      "Review evidence areas",
      "Inaccessible",
      "Voice note saved locally and linked",
      "Manual observation saved and linked",
      "Change sources",
      "Confirm Building linked sources",
      "Building sources confirmed — 5 evidence items, 1 observation",
      "deterministic synthetic draft ready",
    ],
  ],
  [
    "apps/mobile/e2e/fresh-capture-recipient-overview.yaml",
    [
      "Fresh Building lineage with persisted synthetic Timber Pest package completion",
      "Cracking was observed through several tiles",
      "No visible evidence of timber pest activity",
      "Accept finding",
      "Approve Building",
      "Approve Timber Pest",
      "Timber Pest coverage recorded as inspected",
      "Test: complete coverage",
      "Confirm delivery package",
      "Test: confirm evidence durable",
      "Test: provider confirms sent",
      "Condition overview",
      "Synthetic Build Week building inspector",
      "Synthetic Build Week timber pest inspector",
      "Active material limitations",
      "Access hatch obstructed at the time of inspection.",
      "5 inspector-selected evidence source references",
      "1 inspector-selected evidence source reference",
    ],
  ],
]);

for (const [flowIndex, relativePath] of flows.entries()) {
  const prerequisite = flowPrerequisites.get(relativePath);
  if (prerequisite !== undefined && flows[flowIndex - 1] !== prerequisite) {
    throw new Error(
      `${relativePath} must run immediately after ${prerequisite} because it validates a persisted cross-flow handoff.`,
    );
  }
  const content = readFileSync(resolve(root, relativePath), "utf8");
  const documents = parseAllDocuments(content);
  const configuration = documents[0]?.toJSON();
  const steps = documents[1]?.toJSON();
  if (configuration?.appId !== "co.inspectionhub.field") {
    throw new Error(`${relativePath} must target the field app bundle id.`);
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error(`${relativePath} must contain an executable Maestro flow.`);
  }
  if (!content.includes(nativeDevClientUrl)) {
    throw new Error(
      `${relativePath} must reconnect the simulator to the local Expo development server before exercising the app.`,
    );
  }
  for (const text of requiredText.get(relativePath) ?? []) {
    if (!content.includes(text)) {
      throw new Error(
        `${relativePath} is missing required journey text: ${text}`,
      );
    }
  }
}

const appSource = readFileSync(resolve(root, "apps/mobile/App.tsx"), "utf8");
for (const contract of [
  "__DEV__ && process.env.EXPO_PUBLIC_MOBILE_E2E_MODE",
  "expoCaptureResidueInventory",
  "openFieldPersistence",
  "InvestigationControlDock",
  "AreaCloseoutCard",
  "MeasurementEntryCard",
  "EvidenceAreaCard",
  "CandidateSourceControl",
  "confirmFindingCandidateSourceSelection",
  "toggleFindingCandidateSource",
  "findingCandidateAtRiskSourceIds",
  "recoveryBlockedCandidateSourceIds.length === 0",
  "draftPersisted",
  "InvestigationReviewCard",
  "ModuleCompletionDock",
  "DeliveryStatusCard",
]) {
  if (!appSource.includes(contract)) {
    throw new Error(`App.tsx is missing the mobile E2E contract: ${contract}`);
  }
}

for (const forbidden of [
  "active.evidence.map(({ artifactId }) => artifactId)",
  "active.observations.map(({ observationId }) => observationId)",
]) {
  if (appSource.includes(forbidden)) {
    throw new Error(
      `App.tsx still implicitly promotes every investigation source: ${forbidden}`,
    );
  }
}

const tests = spawnSync("pnpm", ["exec", "vitest", "run", "apps/mobile/src"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
if (tests.status !== 0) {
  throw new Error("The deterministic local-capture journey tests failed.");
}

const contractOnly = process.argv.includes("--contract-only");

if (process.env.MOBILE_E2E_RUN_MAESTRO === "1") {
  const maestroDeviceId = process.env.MAESTRO_DEVICE_ID;
  if (!maestroDeviceId) {
    throw new Error(
      "Native large-text E2E requires MAESTRO_DEVICE_ID so the configured simulator and Maestro runtime are the same device.",
    );
  }
  const requestedContentSize =
    process.env.MOBILE_E2E_CONTENT_SIZE ?? "accessibility-medium";
  if (!supportedContentSizes.has(requestedContentSize)) {
    throw new Error(
      `Unsupported MOBILE_E2E_CONTENT_SIZE: ${requestedContentSize}.`,
    );
  }
  const configuredContentSize = spawnSync(
    "xcrun",
    ["simctl", "ui", maestroDeviceId, "content_size", requestedContentSize],
    { encoding: "utf8" },
  );
  if (configuredContentSize.error || configuredContentSize.status !== 0) {
    throw new Error(
      `Could not configure Dynamic Type on simulator ${maestroDeviceId}: ${configuredContentSize.stderr?.trim() || configuredContentSize.error?.message || "unknown simctl error"}`,
      { cause: configuredContentSize.error },
    );
  }
  const observedContentSize = spawnSync(
    "xcrun",
    ["simctl", "ui", maestroDeviceId, "content_size"],
    { encoding: "utf8" },
  );
  const actualContentSize = observedContentSize.stdout?.trim();
  if (
    observedContentSize.error ||
    observedContentSize.status !== 0 ||
    actualContentSize !== requestedContentSize
  ) {
    throw new Error(
      `Dynamic Type preflight expected ${requestedContentSize} on simulator ${maestroDeviceId}, observed ${actualContentSize || observedContentSize.stderr?.trim() || "unknown"}.`,
      { cause: observedContentSize.error },
    );
  }
  process.stdout.write(
    `Native accessibility preflight passed: Dynamic Type ${actualContentSize} on simulator ${maestroDeviceId}.\n`,
  );

  const homebrewJavaHome =
    "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home";
  const javaHome =
    process.env.JAVA_HOME ??
    (existsSync(homebrewJavaHome) ? homebrewJavaHome : undefined);
  const maestroEnvironment = {
    ...process.env,
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
    MAESTRO_CLI_NO_ANALYTICS: "1",
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  };
  for (const flow of flows) {
    const maestroArguments = ["--device", maestroDeviceId, "test", flow];
    const maestro = spawnSync("maestro", maestroArguments, {
      cwd: root,
      encoding: "utf8",
      env: maestroEnvironment,
      stdio: "inherit",
    });
    if (maestro.error || maestro.status !== 0) {
      throw new Error(
        `Maestro execution failed for ${flow}; later flows were not run against a contaminated app state.`,
        { cause: maestro.error },
      );
    }
  }
  process.stdout.write(
    "Maestro mobile journeys passed on the attached runtime.\n",
  );
} else if (contractOnly) {
  process.stdout.write(
    "Mobile deterministic contracts passed. No E2E runtime execution is claimed.\n",
  );
} else {
  throw new Error(
    "Mobile E2E requires Maestro runtime execution. Use pnpm test:contract:mobile for deterministic contract-only checks.",
  );
}
