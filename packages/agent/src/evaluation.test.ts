import { describe, expect, it } from "vitest";

import {
  evaluateLockedHoldoutGate,
  findForbiddenClaims,
  selectDraftingArchitecture,
  worstTrialHasCriticalFailure,
  type ArchitectureMetrics,
} from "./evaluation.js";

describe("predeclared drafting architecture decision", () => {
  it("keeps the planner only with zero critical failures, 20% fewer interventions, and bounded latency/cost", () => {
    const baseline = metrics("thin_responses", {
      interventions: 10,
      latency: 1_000,
      cost: 0.1,
    });
    const planner = metrics("agents_sdk", {
      interventions: 8,
      latency: 2_000,
      cost: 0.2,
    });

    expect(selectDraftingArchitecture({ planner, baseline })).toMatchObject({
      selected: "agents_sdk",
      reason: "planner_met_predeclared_thresholds",
    });
  });

  it.each([
    [{ critical: 1 }, "critical_boundary_failure"],
    [{ interventions: 9 }, "correction_advantage_not_met"],
    [{ latency: 2_001 }, "latency_ceiling_exceeded"],
    [{ cost: 0.201 }, "cost_ceiling_exceeded"],
  ] as const)("selects the thin baseline when %o", (overrides, reason) => {
    const baseline = metrics("thin_responses", {
      interventions: 10,
      latency: 1_000,
      cost: 0.1,
    });
    const planner = metrics("agents_sdk", {
      interventions: 8,
      latency: 2_000,
      cost: 0.2,
      ...overrides,
    });

    expect(selectDraftingArchitecture({ planner, baseline })).toMatchObject({
      selected: "thin_responses",
      reason,
    });
  });

  it("fails on the worst critical trial rather than averaging it away", () => {
    expect(
      worstTrialHasCriticalFailure([
        { criticalFailures: 0 },
        { criticalFailures: 1 },
        { criticalFailures: 0 },
      ]),
    ).toBe(true);
  });

  it("fails a complete locked holdout when any single trial has a critical failure", () => {
    const caseIds = Array.from({ length: 10 }, (_, index) => `H${index + 1}`);
    const trials = (["agents_sdk", "thin_responses"] as const).flatMap(
      (architecture) =>
        caseIds.flatMap((caseId) =>
          Array.from({ length: 3 }, (_, index) => ({
            caseId,
            architecture,
            trial: index + 1,
            criticalFailures:
              architecture === "agents_sdk" && caseId === "H7" && index === 1
                ? 1
                : 0,
          })),
        ),
    );

    expect(
      evaluateLockedHoldoutGate({
        lockedCaseIds: caseIds,
        fixedTrials: 3,
        trials,
      }),
    ).toEqual({
      passed: false,
      worstCriticalFailures: 1,
      evaluatedTrialCount: 60,
    });
  });

  it("detects contractual forbidden claims instead of checking required facts only", () => {
    expect(
      findForbiddenClaims(
        "This property is termite-free; negotiate a price reduction.",
        ["termite_free", "negotiation_advice", "repair_cost"],
      ),
    ).toEqual(["termite_free", "negotiation_advice"]);
  });
});

function metrics(
  architecture: ArchitectureMetrics["architecture"],
  input: {
    readonly interventions: number;
    readonly latency: number;
    readonly cost: number;
    readonly critical?: number;
  },
): ArchitectureMetrics {
  return {
    architecture,
    cases: Array.from({ length: 10 }, (_, index) => ({
      caseId: `development-${index + 1}`,
      criticalFailures: index === 0 ? (input.critical ?? 0) : 0,
      inspectorInterventions: index === 0 ? input.interventions : 0,
      latencyMilliseconds: input.latency,
      costUsd: input.cost,
    })),
  };
}
