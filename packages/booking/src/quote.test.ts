import { describe, expect, it } from "vitest";

import {
  QuoteRuleVersionSchema,
  createQuote,
  publishQuoteRuleVersion,
} from "./index.js";

const rule = QuoteRuleVersionSchema.parse({
  ruleSetId: "30000000-0000-4000-8000-000000000001",
  version: 1,
  status: "published",
  currency: "AUD",
  publishedAt: "2026-07-14T09:00:00.000+10:00",
  building: {
    label: "Building inspection",
    baseAmountCents: 50_000,
    additionalStoreyAmountCents: 5_000,
    additionalBedroomOverFourAmountCents: 1_000,
  },
  timberPest: {
    label: "Timber pest inspection",
    baseAmountCents: 30_000,
    additionalStoreyAmountCents: 2_500,
    additionalBedroomOverFourAmountCents: 500,
  },
});

describe("versioned quote rules", () => {
  it("shows separate module line items and a combined total", () => {
    const quote = createQuote({
      quoteId: "30000000-0000-4000-8000-000000000002",
      rules: rule,
      commissionedModules: ["building", "timber_pest"],
      property: {
        propertyType: "detached_house",
        storeys: 2,
        bedrooms: 5,
        suburb: "Southport",
        postcode: "4215",
      },
      createdAt: "2026-07-14T09:10:00.000+10:00",
      expiresAt: "2026-07-14T10:10:00.000+10:00",
    });

    expect(quote.lineItems).toEqual([
      {
        module: "building",
        label: "Building inspection",
        amountCents: 56_000,
      },
      {
        module: "timber_pest",
        label: "Timber pest inspection",
        amountCents: 33_000,
      },
    ]);
    expect(quote.totalAmountCents).toBe(89_000);
  });

  it("publishes a new immutable rule version without mutating an existing quote", () => {
    const quote = createQuote({
      quoteId: "30000000-0000-4000-8000-000000000003",
      rules: rule,
      commissionedModules: ["building"],
      property: {
        propertyType: "unit",
        storeys: 1,
        bedrooms: 2,
        suburb: "Labrador",
        postcode: "4215",
      },
      createdAt: "2026-07-14T09:10:00.000+10:00",
      expiresAt: "2026-07-14T10:10:00.000+10:00",
    });
    const next = publishQuoteRuleVersion(
      {
        ...rule,
        status: "draft",
        version: 2,
        publishedAt: null,
        building: { ...rule.building, baseAmountCents: 60_000 },
      },
      "2026-07-14T09:20:00.000+10:00",
    );

    expect(next.version).toBe(2);
    expect(next.building.baseAmountCents).toBe(60_000);
    expect(quote.ruleVersion).toBe(1);
    expect(quote.totalAmountCents).toBe(50_000);
  });
});
