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

    expect(validateLaunchProfile(profile)).toEqual([]);
  });

  it("rejects a result-bearing profile with post-hoc or null declarations", async () => {
    const profile = parseYaml(
      await readFile("benchmarks/launch-profile.yaml", "utf8"),
    );
    profile.profile_lock.results_started = true;
    profile.declaration_state = "measurement_started";

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
