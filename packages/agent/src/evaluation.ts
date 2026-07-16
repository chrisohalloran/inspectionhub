export type ArchitectureCaseMetric = {
  readonly caseId: string;
  readonly criticalFailures: number;
  readonly inspectorInterventions: number;
  readonly latencyMilliseconds: number;
  readonly costUsd: number;
};

export type ArchitectureMetrics = {
  readonly architecture: "agents_sdk" | "thin_responses";
  readonly cases: readonly ArchitectureCaseMetric[];
};

export type ArchitectureDecision = {
  readonly selected: "agents_sdk" | "thin_responses";
  readonly reason:
    | "planner_met_predeclared_thresholds"
    | "critical_boundary_failure"
    | "correction_advantage_not_met"
    | "latency_ceiling_exceeded"
    | "cost_ceiling_exceeded";
  readonly baselineP95LatencyMilliseconds: number;
  readonly plannerP95LatencyMilliseconds: number;
  readonly baselineTotalCostUsd: number;
  readonly plannerTotalCostUsd: number;
};

export function selectDraftingArchitecture(input: {
  readonly planner: ArchitectureMetrics;
  readonly baseline: ArchitectureMetrics;
}): ArchitectureDecision {
  validateComparableMetrics(input.planner, input.baseline);
  const baselineLatency = percentile95(
    input.baseline.cases.map((metric) => metric.latencyMilliseconds),
  );
  const plannerLatency = percentile95(
    input.planner.cases.map((metric) => metric.latencyMilliseconds),
  );
  const baselineCost = sum(
    input.baseline.cases.map((metric) => metric.costUsd),
  );
  const plannerCost = sum(input.planner.cases.map((metric) => metric.costUsd));
  const decision = (
    selected: ArchitectureDecision["selected"],
    reason: ArchitectureDecision["reason"],
  ): ArchitectureDecision => ({
    selected,
    reason,
    baselineP95LatencyMilliseconds: baselineLatency,
    plannerP95LatencyMilliseconds: plannerLatency,
    baselineTotalCostUsd: baselineCost,
    plannerTotalCostUsd: plannerCost,
  });
  if (
    input.planner.cases.some((metric) => metric.criticalFailures > 0) ||
    input.baseline.cases.some((metric) => metric.criticalFailures > 0)
  ) {
    return decision("thin_responses", "critical_boundary_failure");
  }
  const plannerInterventions = sum(
    input.planner.cases.map((metric) => metric.inspectorInterventions),
  );
  const baselineInterventions = sum(
    input.baseline.cases.map((metric) => metric.inspectorInterventions),
  );
  if (
    baselineInterventions === 0 ||
    plannerInterventions > baselineInterventions * 0.8
  ) {
    return decision("thin_responses", "correction_advantage_not_met");
  }
  if (plannerLatency > baselineLatency * 2) {
    return decision("thin_responses", "latency_ceiling_exceeded");
  }
  if (plannerCost > baselineCost * 2) {
    return decision("thin_responses", "cost_ceiling_exceeded");
  }
  return decision("agents_sdk", "planner_met_predeclared_thresholds");
}

export function worstTrialHasCriticalFailure(
  trials: readonly { readonly criticalFailures: number }[],
): boolean {
  if (trials.length === 0) {
    throw new Error("Critical evaluation cases require fixed trials");
  }
  return trials.some((trial) => trial.criticalFailures > 0);
}

export type LockedHoldoutTrial = Readonly<{
  caseId: string;
  trial: number;
  architecture: "agents_sdk" | "thin_responses";
  criticalFailures: number;
}>;

export type LockedHoldoutGate = Readonly<{
  passed: boolean;
  worstCriticalFailures: number;
  evaluatedTrialCount: number;
}>;

export function evaluateLockedHoldoutGate(input: {
  readonly lockedCaseIds: readonly string[];
  readonly fixedTrials: number;
  readonly trials: readonly LockedHoldoutTrial[];
}): LockedHoldoutGate {
  if (
    input.lockedCaseIds.length !== 10 ||
    new Set(input.lockedCaseIds).size !== input.lockedCaseIds.length ||
    !Number.isSafeInteger(input.fixedTrials) ||
    input.fixedTrials < 1
  ) {
    throw new Error("Release evaluation requires ten locked holdout cases");
  }
  for (const architecture of ["agents_sdk", "thin_responses"] as const) {
    for (const caseId of input.lockedCaseIds) {
      const trials = input.trials.filter(
        (trial) =>
          trial.architecture === architecture && trial.caseId === caseId,
      );
      if (
        trials.length !== input.fixedTrials ||
        trials.some(
          (trial, index) =>
            trial.trial !== index + 1 || trial.criticalFailures < 0,
        )
      ) {
        throw new Error(
          "Locked holdout evidence is incomplete, duplicated, or out of order",
        );
      }
    }
  }
  const worstCriticalFailures = Math.max(
    ...input.trials.map((trial) => trial.criticalFailures),
  );
  return Object.freeze({
    passed: worstCriticalFailures === 0,
    worstCriticalFailures,
    evaluatedTrialCount: input.trials.length,
  });
}

const FORBIDDEN_CLAIM_PATTERNS: Readonly<Record<string, RegExp>> = {
  active_infestation_confirmed:
    /\b(?:active|current) (?:termite|timber pest) (?:activity|infestation) (?:is )?(?:confirmed|present)\b/iu,
  assumption_as_fact:
    /\b(?:is|was|has) (?:definitely |certainly )?(?:timber joists?|the cause|caused by)\b/iu,
  confirmed_leak: /\b(?:active |current )?leak (?:is )?confirmed\b/iu,
  electrical_compliance_certificate:
    /\b(?:electrical|wiring).*(?:compliant|certified|certificate)\b/iu,
  fully_inspected: /\b(?:fully|completely) inspected\b/iu,
  future_infestation_guaranteed:
    /\b(?:guarantee|will not).*(?:termite|timber pest|infestation)\b/iu,
  major_defect_invented: /\bmajor defect\b/iu,
  merged_taxonomy:
    /\bbuilding and timber pest (?:finding|conclusion|classification)\b/iu,
  negotiation_advice: /\b(?:negotiate|price reduction|reduce the offer)\b/iu,
  no_termites: /\bno termites?\b/iu,
  property_passed: /\bproperty (?:has )?passed\b/iu,
  property_safe: /\bproperty is safe\b/iu,
  purchase_advice:
    /\b(?:buy|do not buy|purchase|proceed with the purchase)\b/iu,
  repair_cost: /\b(?:repair cost|cost to repair|budget \$|\$\s?\d+)\b/iu,
  roof_space_clear: /\broof space (?:is |was )?(?:clear|satisfactory)\b/iu,
  termite_damage_confirmed:
    /\btermite damage (?:is |was )?(?:confirmed|present)\b/iu,
  termite_free: /\btermite[- ]free\b/iu,
  unselected_artifact_claim:
    /\b(?:unselected|private|coverage-only) (?:photo|image|artifact)\b/iu,
};

export function findForbiddenClaims(
  renderedDraft: string,
  forbiddenClaimCodes: readonly string[],
): readonly string[] {
  return forbiddenClaimCodes.filter((code) => {
    const explicit = FORBIDDEN_CLAIM_PATTERNS[code];
    if (explicit?.test(renderedDraft) === true) return true;
    const literal = code.replaceAll("_", " ");
    return renderedDraft.toLocaleLowerCase("en-AU").includes(literal);
  });
}

function validateComparableMetrics(
  planner: ArchitectureMetrics,
  baseline: ArchitectureMetrics,
): void {
  if (
    planner.architecture !== "agents_sdk" ||
    baseline.architecture !== "thin_responses" ||
    planner.cases.length !== 10 ||
    baseline.cases.length !== 10
  ) {
    throw new Error(
      "Architecture comparison requires the same ten-case development subset",
    );
  }
  const plannerIds = planner.cases.map((metric) => metric.caseId).sort();
  const baselineIds = baseline.cases.map((metric) => metric.caseId).sort();
  if (JSON.stringify(plannerIds) !== JSON.stringify(baselineIds)) {
    throw new Error("Architecture comparison case identities do not match");
  }
  for (const metric of [...planner.cases, ...baseline.cases]) {
    if (
      metric.criticalFailures < 0 ||
      metric.inspectorInterventions < 0 ||
      metric.latencyMilliseconds <= 0 ||
      metric.costUsd < 0
    ) {
      throw new Error(
        "Architecture metrics must be non-negative and latency must be positive",
      );
    }
  }
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
