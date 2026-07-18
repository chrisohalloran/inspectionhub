import { describe, expect, it } from "vitest";

import {
  aggregateArchitectureResults,
  factPreserved,
  percentile95,
  scoreArchitectureDraft,
} from "./live-comparison-scoring.mjs";

describe("live comparison scoring", () => {
  it("uses the worst fixed trial and observed p95 without mutating input", () => {
    const latencies = [100, 300, 200];
    const aggregate = aggregateArchitectureResults(
      "agents_sdk",
      [{ case_id: "D01" }],
      [
        trial(1, 0, 1, latencies[0]!, 0.01),
        trial(2, 1, 3, latencies[1]!, 0.03),
        trial(3, 0, 2, latencies[2]!, 0.02),
      ],
    );

    expect(aggregate.cases).toEqual([
      {
        caseId: "D01",
        criticalFailures: 1,
        inspectorInterventions: 3,
        latencyMilliseconds: 300,
        costUsd: 0.02,
      },
    ]);
    expect(latencies).toEqual([100, 300, 200]);
    expect(() =>
      aggregateArchitectureResults("agents_sdk", [{ case_id: "D02" }], []),
    ).toThrow(/has no trials/u);
  });

  it("scores preserved facts and inspector-attributed classification", () => {
    const score = scoreArchitectureDraft(evalCase(), draft(), {
      passed: true,
      issues: [],
    });

    expect(score).toEqual({
      missingFacts: [],
      missingUncertainties: [],
      forbiddenClaims: [],
      oracleFailures: [],
      criticalFailures: 0,
      inspectorInterventions: 0,
    });
  });

  it("counts missing context, forbidden advice, and guard failures independently", () => {
    const unsafe = draft();
    unsafe.modules[0]!.findings[0]!.observation.text =
      "Buy the property after reviewing this item.";
    unsafe.modules[0]!.conclusion.text = "Buy after reviewing this item.";
    const score = scoreArchitectureDraft(evalCase(), unsafe, {
      passed: false,
      issues: [{ code: "source_missing", severity: "critical" }],
    });

    expect(score.missingFacts).toEqual(["cracked bathroom tiles"]);
    expect(score.missingUncertainties).toEqual(["concealed construction"]);
    expect(score.forbiddenClaims).toEqual(["purchase_advice"]);
    expect(score.oracleFailures).toContain("verifier_expected:pass");
    expect(score.criticalFailures).toBe(5);
  });

  it("rejects empty or non-finite percentile samples", () => {
    expect(percentile95([1, 2, 3, 4, 100])).toBe(100);
    expect(() => percentile95([])).toThrow(/at least one/u);
    expect(() => percentile95([1, Number.NaN])).toThrow(/finite/u);
    expect(factPreserved("Cracked bathroom tiles observed", "tiles")).toBe(
      true,
    );
  });
});

function trial(
  trialNumber: number,
  criticalFailures: number,
  inspectorInterventions: number,
  latencyMilliseconds: number,
  costUsd: number,
) {
  return {
    architecture: "agents_sdk",
    caseId: "D01",
    trial: trialNumber,
    criticalFailures,
    inspectorInterventions,
    latencyMilliseconds,
    costUsd,
  };
}

function evalCase() {
  return {
    expected: {
      required_facts: ["cracked bathroom tiles"],
      allowed_uncertainties: ["concealed construction"],
      forbidden_claims: ["purchase_advice"],
    },
    output_oracle: {
      decision: "major_defect_attributed",
      verifier: {
        expected: "pass",
        required_issue_codes: [],
        forbidden_issue_codes: [],
      },
      forbidden_output_terms: [],
      recommendation_policy: "any",
    },
  };
}

function draft() {
  return {
    modules: [
      {
        module: "building",
        moduleId: "module-building",
        noReportableFinding: false,
        limitations: [],
        conclusion: {
          kind: "observation",
          text: "Cracked bathroom tiles; concealed construction was not confirmed.",
        },
        findings: [
          {
            moduleId: "module-building",
            observation: {
              kind: "observation",
              text: "Cracked bathroom tiles were observed.",
            },
            extent: null,
            reasoning: [],
            consequences: [],
            recommendation: null,
            inspectorClassification: {
              value: "major_defect",
              attributedTo: "inspector",
              sourceRefs: ["source-d01-1"],
            },
          },
        ],
      },
    ],
  };
}
