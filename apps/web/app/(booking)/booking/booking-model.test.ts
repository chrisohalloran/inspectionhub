import { describe, expect, it } from "vitest";

import {
  quoteTotal,
  readinessProjection,
  resolveScenario,
  type ModuleCode,
} from "./booking-model";

describe("booking model", () => {
  it("shows separate module prices in a combined quote", () => {
    const selected = new Set<ModuleCode>(["building", "timber-pest"]);

    expect(quoteTotal(selected)).toBe(71_500);
    expect(quoteTotal(new Set<ModuleCode>(["building"]))).toBe(49_500);
    expect(quoteTotal(new Set<ModuleCode>(["timber-pest"]))).toBe(22_000);
  });

  it("does not call the booking ready until every literal dependency is confirmed", () => {
    expect(
      readinessProjection({
        access: "required",
        agreement: "signed",
        calendar: "confirmed",
        payment: "succeeded",
        slot: "confirmed",
      }),
    ).toEqual({
      label: "Actions remaining",
      outstanding: ["Property access confirmation"],
    });

    expect(
      readinessProjection({
        access: "confirmed",
        agreement: "signed",
        calendar: "confirmed",
        payment: "succeeded",
        slot: "confirmed",
      }),
    ).toEqual({ label: "Inspection confirmed", outstanding: [] });
  });

  it("accepts only declared recovery fixtures", () => {
    expect(resolveScenario("payment-declined")).toBe("payment-declined");
    expect(resolveScenario("unknown-state")).toBe("standard");
    expect(resolveScenario(["slot-conflict", "slot-expired"])).toBe(
      "slot-conflict",
    );
  });
});
