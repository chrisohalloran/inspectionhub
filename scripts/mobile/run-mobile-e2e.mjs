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
  "apps/mobile/e2e/area-session-expiry.yaml",
];

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
      "Review & complete",
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
      "Continue field work",
      "Finish the open investigation",
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
      "Timber Pest candidate — not selected",
    ],
  ],
]);

for (const relativePath of flows) {
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
  "InvestigationReviewCard",
  "ModuleCompletionDock",
  "DeliveryStatusCard",
]) {
  if (!appSource.includes(contract)) {
    throw new Error(`App.tsx is missing the mobile E2E contract: ${contract}`);
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
    const maestroArguments = process.env.MAESTRO_DEVICE_ID
      ? ["--device", process.env.MAESTRO_DEVICE_ID, "test", flow]
      : ["test", flow];
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
