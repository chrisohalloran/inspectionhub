import { describe, expect, it } from "vitest";

import {
  EnvironmentConfigurationError,
  parseEnvironment,
} from "./environment.js";

describe("parseEnvironment", () => {
  it("names missing worker values and provides remediation", () => {
    expect(() =>
      parseEnvironment("worker", {
        APP_ENV: "development",
        PROVIDER_MODE: "fake",
      }),
    ).toThrowError(EnvironmentConfigurationError);

    try {
      parseEnvironment("worker", {
        APP_ENV: "development",
        PROVIDER_MODE: "fake",
      });
    } catch (error) {
      expect(error).toMatchObject({
        missingOrInvalid: [
          "DATABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "WORKER_ID",
        ],
      });
      expect(String(error)).toContain("Copy .env.example to .env.local");
    }
  });

  it("accepts the fake web configuration used by local development", () => {
    expect(
      parseEnvironment("web", {
        APP_ENV: "test",
        PROVIDER_MODE: "fake",
        NEXT_PUBLIC_INSPECTION_HUB_HOST: "inspectionhub.localhost",
        NEXT_PUBLIC_SEE_IT_HOST: "seeit.localhost",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-key",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toMatchObject({ PROVIDER_MODE: "fake" });
  });
});
