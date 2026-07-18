export type BookingScenario =
  "standard" | "payment-declined" | "slot-conflict" | "slot-expired";

export type ModuleCode = "building" | "timber-pest";

export type ReadinessInput = {
  access: "confirmed" | "required" | "requested";
  agreement: "signed" | "unsigned";
  calendar: "confirmed" | "pending";
  payment: "declined" | "pending" | "succeeded";
  slot: "confirmed" | "expired" | "held";
};

// Fixed future fixture dates keep screenshots and tests deterministic for the
// July 2026 Build Week project without making availability depend on wall time.
export const launchQuoteExpiryLabel = "Tuesday 21 July 2026 at 12:15 pm AEST";

export const launchServices = [
  {
    code: "building" as const,
    description:
      "A visual pre-purchase Building inspection with its own professional report.",
    label: "Building inspection",
    priceCents: 49_500,
  },
  {
    code: "timber-pest" as const,
    description:
      "A separate visual Timber Pest inspection and separately governed report.",
    label: "Timber Pest inspection",
    priceCents: 22_000,
  },
] as const;

export const launchSlots = [
  {
    id: "slot-0900",
    label: "Wednesday 22 July, 9:00 am",
    note: "Held for 10 minutes after selection",
  },
  {
    id: "slot-1330",
    label: "Wednesday 22 July, 1:30 pm",
    note: "Available after travel buffer",
  },
  {
    id: "slot-1030",
    label: "Thursday 23 July, 10:30 am",
    note: "Available",
  },
] as const;

export function formatAud(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    currency: "AUD",
    style: "currency",
  }).format(cents / 100);
}

export function quoteTotal(selectedModules: ReadonlySet<ModuleCode>): number {
  return launchServices.reduce(
    (total, service) =>
      selectedModules.has(service.code) ? total + service.priceCents : total,
    0,
  );
}

export function readinessProjection(input: ReadinessInput): {
  label: "Inspection confirmed" | "Actions remaining";
  outstanding: string[];
} {
  const outstanding = [
    input.slot === "confirmed" && input.calendar === "confirmed"
      ? undefined
      : "Appointment confirmation",
    input.agreement === "signed" ? undefined : "Signed agreement",
    input.payment === "succeeded" ? undefined : "Test payment",
    input.access === "confirmed" ? undefined : "Property access confirmation",
  ].filter((item): item is string => item !== undefined);

  return {
    label:
      outstanding.length === 0 ? "Inspection confirmed" : "Actions remaining",
    outstanding,
  };
}

export function resolveScenario(
  value: string | string[] | undefined,
): BookingScenario {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    candidate === "payment-declined" ||
    candidate === "slot-conflict" ||
    candidate === "slot-expired"
  ) {
    return candidate;
  }

  return "standard";
}
