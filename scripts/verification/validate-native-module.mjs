import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function command(executable, arguments_) {
  const result = spawnSync(executable, arguments_, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(
      `${executable} ${arguments_.join(" ")} failed${
        result.status === null ? " to start" : ` with ${result.status}`
      }\n${detail}`,
      { cause: result.error },
    );
  }
  return result.stdout;
}

for (const platform of ["apple", "android"]) {
  const output = command("pnpm", [
    "--filter",
    "@inspection/mobile",
    "exec",
    "expo-modules-autolinking",
    "verify",
    "--platform",
    platform,
    "--json",
  ]);
  const verification = JSON.parse(output);
  const module = verification.searchPaths?.find(
    (entry) => entry.name === "expo-durable-file",
  );
  if (!module) {
    throw new Error(`expo-durable-file was not autolinked for ${platform}.`);
  }
  process.stdout.write(
    `${platform} autolink: ${module.name} -> ${module.path}\n`,
  );
}

command("ruby", [
  "-c",
  "apps/mobile/modules/expo-durable-file/ios/ExpoDurableFile.podspec",
]);

if (process.platform === "darwin") {
  command("xcrun", [
    "swiftc",
    "-parse",
    "apps/mobile/modules/expo-durable-file/ios/ExpoDurableFileModule.swift",
  ]);
}

const nativeContracts = [
  {
    path: "apps/mobile/modules/expo-durable-file/ios/ExpoDurableFileModule.swift",
    required: [
      'AsyncFunction("persistCapture")',
      'AsyncFunction("getThermalState")',
      'AsyncFunction("scanCaptureResidues")',
      'AsyncFunction("quarantineCaptureResidue")',
      'AsyncFunction("terminateProcessForDurabilityOracle")',
      "Darwin.fsync",
      "renamex_np",
      "isExcludedFromBackup",
      "completeUntilFirstUserAuthentication",
      "SIGKILL",
    ],
  },
  {
    path: "apps/mobile/modules/expo-durable-file/android/src/main/java/expo/modules/durablefile/ExpoDurableFileModule.kt",
    required: [
      'AsyncFunction("persistCapture")',
      'AsyncFunction("getThermalState")',
      'AsyncFunction("scanCaptureResidues")',
      'AsyncFunction("quarantineCaptureResidue")',
      'AsyncFunction("terminateProcessForDurabilityOracle")',
      "noBackupFilesDir",
      "Os.fsync",
      "StandardCopyOption.ATOMIC_MOVE",
      "Process.killProcess",
    ],
  },
];

for (const contract of nativeContracts) {
  const source = readFileSync(contract.path, "utf8");
  for (const required of contract.required) {
    if (!source.includes(required)) {
      throw new Error(
        `${contract.path} is missing native durability contract: ${required}`,
      );
    }
  }
}

const appConfig = JSON.parse(readFileSync("apps/mobile/app.json", "utf8"));
if (appConfig.expo?.android?.allowBackup !== false) {
  throw new Error(
    "Android consumer cloud backup must be disabled for field evidence.",
  );
}
process.stdout.write(
  "Native durable-file autolink, protection, recovery surface and podspec validation passed.\n",
);
