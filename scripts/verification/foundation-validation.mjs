import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { parse as parseYaml } from "yaml";

function readPath(value, dottedPath) {
  return dottedPath
    .split(".")
    .reduce((current, part) => current?.[part], value);
}

function isDeclared(value) {
  return value !== null && value !== undefined && value !== "";
}

export function validateLaunchProfile(profile) {
  const errors = [];
  if (profile?.schema_version !== 1) errors.push("schema_version must be 1.");
  if (profile?.profile_id !== "inspectionhub-launch-v1") {
    errors.push("profile_id must be inspectionhub-launch-v1.");
  }

  const requiredPaths = profile?.validation_contract?.required_pre_run_paths;
  if (!Array.isArray(requiredPaths) || requiredPaths.length === 0) {
    errors.push("validation_contract.required_pre_run_paths must be declared.");
    return errors;
  }

  for (const requiredPath of requiredPaths) {
    const segments = requiredPath.split(".");
    const parentPath = segments.slice(0, -1).join(".");
    if (readPath(profile, parentPath) === undefined) {
      errors.push(`${requiredPath} is not declared in the launch profile.`);
    }
  }

  const resultsStarted = profile?.profile_lock?.results_started === true;
  if (!resultsStarted) {
    const allowedPendingStatuses =
      profile?.validation_contract?.allowed_pending_statuses_before_results;
    if (
      !Array.isArray(allowedPendingStatuses) ||
      allowedPendingStatuses.length === 0
    ) {
      errors.push(
        "validation_contract.allowed_pending_statuses_before_results must be declared before results start.",
      );
    } else {
      for (const [deviceId, device] of Object.entries(profile?.devices ?? {})) {
        if (
          !isDeclared(device?.status) ||
          !allowedPendingStatuses.includes(device.status)
        ) {
          errors.push(
            `devices.${deviceId}.status must be one of validation_contract.allowed_pending_statuses_before_results before results start.`,
          );
        }
      }
    }
  }

  if (resultsStarted) {
    if (!isDeclared(profile.profile_lock.locked_profile_sha256)) {
      errors.push(
        "profile_lock.locked_profile_sha256 is required once results start.",
      );
    }
    for (const requiredPath of requiredPaths) {
      const value = readPath(profile, requiredPath);
      if (!isDeclared(value) || (Array.isArray(value) && value.length === 0)) {
        errors.push(`${requiredPath} must be completed before results start.`);
      }
    }
  }

  const targets = profile?.performance_targets;
  if (
    targets?.shutter_acknowledgement_p95_ms_maximum !== 150 ||
    targets?.local_durable_save_p95_ms_maximum !== 750 ||
    targets?.voice_recording_start_p95_ms_maximum !== 300
  ) {
    errors.push("Field latency targets do not match the governing plan.");
  }
  if (profile?.sample_collection?.percentile_method !== "nearest_rank") {
    errors.push("sample_collection.percentile_method must be nearest_rank.");
  }
  return errors;
}

export function validateDeploymentConfiguration(configuration) {
  const errors = [];
  if (!configuration.vercel?.regions?.includes("syd1")) {
    errors.push("Vercel must target syd1.");
  }
  if (!/^primary_region\s*=\s*"syd"$/mu.test(configuration.fly)) {
    errors.push("Fly must target primary_region syd.");
  }
  if (!/^\[db\.pooler\]$/mu.test(configuration.supabase)) {
    errors.push(
      "Supabase local configuration must declare the managed-pooler boundary.",
    );
  }
  const expectedChannels = ["development", "preview", "production"];
  for (const channel of expectedChannels) {
    if (configuration.eas?.build?.[channel]?.channel !== channel) {
      errors.push(`EAS ${channel} profile must use the ${channel} channel.`);
    }
  }
  if (!/@sha256:[a-f0-9]{64}/u.test(configuration.dockerfile)) {
    errors.push("Worker base image must be pinned by sha256 digest.");
  }
  if (!/playwright:v1\.61\.1-noble/u.test(configuration.dockerfile)) {
    errors.push(
      "Worker base image must pin the accepted Playwright browser version.",
    );
  }
  return errors;
}

async function validateRepository() {
  const [profileSource, fly, supabase, dockerfile, vercelSource, easSource] =
    await Promise.all([
      readFile("benchmarks/launch-profile.yaml", "utf8"),
      readFile("fly.toml", "utf8"),
      readFile("supabase/config.toml", "utf8"),
      readFile("apps/worker/Dockerfile", "utf8"),
      readFile("vercel.json", "utf8"),
      readFile("apps/mobile/eas.json", "utf8"),
    ]);
  return [
    ...validateLaunchProfile(parseYaml(profileSource)),
    ...validateDeploymentConfiguration({
      fly,
      supabase,
      dockerfile,
      vercel: JSON.parse(vercelSource),
      eas: JSON.parse(easSource),
    }),
  ];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = await validateRepository();
  if (errors.length > 0) {
    process.stderr.write(
      `Foundation validation failed:\n${errors.join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    "Foundation deployment and benchmark validation passed.\n",
  );
}
