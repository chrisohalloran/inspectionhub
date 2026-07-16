import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  validateDeploymentConfiguration,
  validateLaunchProfile,
} from "./foundation-validation.mjs";

describe("U1 foundation validation", () => {
  it("allows declared pending physical measurements before a benchmark starts", async () => {
    const profile = parseYaml(
      await readFile("benchmarks/launch-profile.yaml", "utf8"),
    );

    expect(profile.profile_lock.results_started).toBe(false);
    expect(profile.devices.build_week_inspector_iphone.status).toBe(
      "partially_declared_pending_connection",
    );
    expect(
      profile.validation_contract.allowed_pending_statuses_before_results,
    ).toContain("partially_declared_pending_connection");
    expect(validateLaunchProfile(profile)).toEqual([]);
  });

  it("rejects a missing or undeclared device status before benchmark results start", async () => {
    const baseProfile = parseYaml(
      await readFile("benchmarks/launch-profile.yaml", "utf8"),
    );

    for (const status of [null, "undeclared_status"]) {
      const profile = structuredClone(baseProfile);
      profile.devices.build_week_inspector_iphone.status = status;

      expect(validateLaunchProfile(profile)).toContain(
        "devices.build_week_inspector_iphone.status must be one of validation_contract.allowed_pending_statuses_before_results before results start.",
      );
    }
  });

  it("rejects a result-bearing profile with post-hoc or null declarations", async () => {
    const profile = parseYaml(
      await readFile("benchmarks/launch-profile.yaml", "utf8"),
    );
    profile.profile_lock.results_started = true;
    profile.declaration_state = "measurement_started";
    profile.devices.build_week_inspector_iphone.model = null;

    expect(validateLaunchProfile(profile)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("devices.build_week_inspector_iphone.model"),
        expect.stringContaining("locked_profile_sha256"),
      ]),
    );
  });

  it("accepts only the recorded Australian deployment topology and pinned worker image", async () => {
    const configuration = {
      vercel: JSON.parse(await readFile("vercel.json", "utf8")),
      fly: await readFile("fly.toml", "utf8"),
      supabase: await readFile("supabase/config.toml", "utf8"),
      eas: JSON.parse(await readFile("apps/mobile/eas.json", "utf8")),
      dockerfile: await readFile("apps/worker/Dockerfile", "utf8"),
    };

    expect(validateDeploymentConfiguration(configuration)).toEqual([]);
    expect(
      validateDeploymentConfiguration({
        ...configuration,
        dockerfile: configuration.dockerfile.replace(
          /@sha256:[a-f0-9]{64}/u,
          "",
        ),
      }),
    ).toContain("Worker base image must be pinned by sha256 digest.");
  });
});
