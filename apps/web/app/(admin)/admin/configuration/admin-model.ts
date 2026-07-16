export type PriceVersion = {
  buildingCents: number;
  effectiveDate: string;
  publishedAt: string;
  timberPestCents: number;
  version: string;
};

export type ExistingQuote = {
  buildingCents: number;
  quoteId: string;
  timberPestCents: number;
  version: string;
};

export const seededPriceVersions: readonly PriceVersion[] = [
  {
    buildingCents: 49_500,
    effectiveDate: "2026-07-14",
    publishedAt: "2026-07-14T08:30:00+10:00",
    timberPestCents: 22_000,
    version: "PRICE-2026.07",
  },
  {
    buildingCents: 47_500,
    effectiveDate: "2026-06-01",
    publishedAt: "2026-05-28T14:10:00+10:00",
    timberPestCents: 21_000,
    version: "PRICE-2026.06",
  },
] as const;

export const seededExistingQuote: ExistingQuote = {
  buildingCents: 49_500,
  quoteId: "Q-1042-test",
  timberPestCents: 22_000,
  version: "PRICE-2026.07",
};

export function createNextPriceVersion(input: {
  buildingCents: number;
  effectiveDate: string;
  timberPestCents: number;
}): PriceVersion {
  if (input.buildingCents <= 0 || input.timberPestCents <= 0) {
    throw new Error("Prices must be greater than zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
    throw new Error("An effective date is required.");
  }

  return {
    ...input,
    publishedAt: "2026-07-14T12:00:00+10:00",
    version: "PRICE-2026.08-draft-published",
  };
}

export function credentialAuthority(input: {
  asAt: string;
  buildingEligible: boolean;
  expiryDate: string;
  timberPestEligible: boolean;
}): { building: string; timberPest: string } {
  const expired = input.expiryDate < input.asAt;
  return {
    building: input.buildingEligible && !expired ? "Eligible" : "Not eligible",
    timberPest:
      input.timberPestEligible && !expired ? "Eligible" : "Not eligible",
  };
}

export function integrationDisplay(input: {
  lastObserved: string;
  state: "attention" | "connected" | "disabled";
}): string {
  return `${input.state} — last observed ${input.lastObserved}`;
}
