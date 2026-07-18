import { describe, expect, it } from "vitest";

import { RecipientMutationLimitError } from "./recipient-mutation-error";
import {
  recipientMutationFailure,
  sameOriginRecipientRequest,
} from "./recipient-route-boundary";

describe("recipient mutation route boundary", () => {
  it("requires an explicit same-origin browser request", () => {
    expect(
      sameOriginRecipientRequest(
        request({
          host: "seeitinspections.com.au",
          origin: "https://seeitinspections.com.au",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
    expect(
      sameOriginRecipientRequest(
        request({
          host: "seeitinspections.com.au",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
  });

  it("maps lifetime and rolling authority quotas distinctly", async () => {
    const lifetime = recipientMutationFailure(
      new RecipientMutationLimitError("grant_mutation_limit_reached"),
    );
    expect(lifetime.status).toBe(409);
    await expect(lifetime.json()).resolves.toEqual({
      error: "grant_mutation_limit_reached",
    });

    const rolling = recipientMutationFailure(
      new RecipientMutationLimitError("report_mutation_window_reached"),
    );
    expect(rolling.status).toBe(429);
    expect(rolling.headers.get("retry-after")).toBe("3600");
    await expect(rolling.json()).resolves.toEqual({
      error: "report_mutation_window_reached",
    });
  });

  it("does not expose arbitrary authority failures", async () => {
    const response = recipientMutationFailure(new Error("private detail"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "access_denied" });
  });
});

function request(headers: Record<string, string>): Request {
  return new Request("https://seeitinspections.com.au/reports/demo", {
    headers,
    method: "POST",
  });
}
