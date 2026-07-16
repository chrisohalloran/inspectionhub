import { describe, expect, it } from "vitest";

import {
  createNextPriceVersion,
  credentialAuthority,
  integrationDisplay,
  seededExistingQuote,
} from "./admin-model";

describe("launch administration model", () => {
  it("publishes a new price version without mutating the existing quote fixture", () => {
    const before = structuredClone(seededExistingQuote);
    const next = createNextPriceVersion({
      buildingCents: 51_000,
      effectiveDate: "2026-08-01",
      timberPestCents: 23_000,
    });

    expect(next.version).toBe("PRICE-2026.08-draft-published");
    expect(next.buildingCents).toBe(51_000);
    expect(seededExistingQuote).toEqual(before);
  });

  it("removes later approval authority when a credential has expired", () => {
    expect(
      credentialAuthority({
        asAt: "2026-07-14",
        buildingEligible: true,
        expiryDate: "2026-07-13",
        timberPestEligible: true,
      }),
    ).toEqual({ building: "Not eligible", timberPest: "Not eligible" });
  });

  it("exposes integration truth without accepting or returning a secret", () => {
    const display = integrationDisplay({
      lastObserved: "14 July, 11:42 am",
      state: "connected",
    });

    expect(display).toBe("connected — last observed 14 July, 11:42 am");
    expect(display).not.toMatch(/sk_|secret=/i);
  });
});
