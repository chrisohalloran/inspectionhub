import {
  evaluateArchitectureOutputOracle,
  findForbiddenClaims,
} from "../../packages/agent/dist/index.js";

export function aggregateArchitectureResults(architecture, cases, results) {
  return {
    architecture,
    cases: cases.map((evalCase) => {
      const trials = results.filter(
        (result) =>
          result.caseId === evalCase.case_id &&
          result.architecture === architecture,
      );
      if (trials.length === 0) {
        throw new Error(
          `Architecture ${architecture} has no trials for ${evalCase.case_id}`,
        );
      }
      return {
        caseId: evalCase.case_id,
        criticalFailures: Math.max(
          ...trials.map((trial) => trial.criticalFailures),
        ),
        inspectorInterventions: Math.max(
          ...trials.map((trial) => trial.inspectorInterventions),
        ),
        latencyMilliseconds: percentile95(
          trials.map((trial) => trial.latencyMilliseconds),
        ),
        costUsd:
          trials.reduce((total, trial) => total + trial.costUsd, 0) /
          trials.length,
      };
    }),
  };
}

export function scoreArchitectureDraft(evalCase, draft, guard) {
  const rendered = JSON.stringify(draft).toLocaleLowerCase("en-AU");
  const missingFacts = evalCase.expected.required_facts.filter(
    (fact) => !factPreserved(rendered, fact),
  );
  const missingUncertainties = evalCase.expected.allowed_uncertainties.filter(
    (uncertainty) => !factPreserved(rendered, uncertainty),
  );
  const forbiddenClaims = findForbiddenClaims(
    rendered,
    evalCase.expected.forbidden_claims,
  );
  const criticalGuardIssues = guard.issues.filter(
    (issue) => issue.severity === "critical",
  );
  const nonCriticalGuardIssues = guard.issues.filter(
    (issue) => issue.severity === "non_critical",
  );
  const oracleFailures = evaluateArchitectureOutputOracle({
    oracle: {
      decision: evalCase.output_oracle.decision,
      verifier: {
        expected: evalCase.output_oracle.verifier.expected,
        requiredIssueCodes:
          evalCase.output_oracle.verifier.required_issue_codes,
        forbiddenIssueCodes:
          evalCase.output_oracle.verifier.forbidden_issue_codes,
      },
      forbiddenOutputTerms: evalCase.output_oracle.forbidden_output_terms,
      recommendationPolicy: evalCase.output_oracle.recommendation_policy,
    },
    output: architectureOracleOutput(draft, guard, rendered),
  });
  return {
    missingFacts,
    missingUncertainties,
    forbiddenClaims,
    oracleFailures,
    criticalFailures:
      criticalGuardIssues.length +
      missingFacts.length +
      missingUncertainties.length +
      forbiddenClaims.length +
      oracleFailures.length,
    inspectorInterventions:
      nonCriticalGuardIssues.length +
      missingFacts.length +
      missingUncertainties.length +
      forbiddenClaims.length +
      oracleFailures.length,
  };
}

export function factPreserved(renderedDraft, fact) {
  const tokens = fact
    .toLocaleLowerCase("en-AU")
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 4);
  if (tokens.length === 0) {
    return renderedDraft.includes(fact.toLocaleLowerCase("en-AU"));
  }
  const present = tokens.filter((token) => renderedDraft.includes(token));
  return present.length / tokens.length >= 0.6;
}

export function percentile95(values) {
  if (values.length === 0) {
    throw new Error("A percentile requires at least one observed value");
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("A percentile requires finite observed values");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function architectureOracleOutput(draft, guard, renderedDraft) {
  return {
    renderedDraft,
    guardPassed: guard.passed,
    guardIssueCodes: guard.issues.map((issue) => issue.code),
    modules: draft.modules.map((module) => {
      const clauses = [
        ...module.limitations,
        module.conclusion,
        ...module.findings.flatMap((finding) => [
          finding.observation,
          ...(finding.extent === null ? [] : [finding.extent]),
          ...finding.reasoning,
          ...finding.consequences,
          ...(finding.recommendation === null ? [] : [finding.recommendation]),
        ]),
      ];
      return {
        module: module.module,
        moduleId: module.moduleId,
        noReportableFinding: module.noReportableFinding,
        classifications: module.findings.flatMap((finding) =>
          finding.inspectorClassification === null
            ? []
            : [
                {
                  value: finding.inspectorClassification.value,
                  attributedTo: finding.inspectorClassification.attributedTo,
                  sourceReferenceCount:
                    finding.inspectorClassification.sourceRefs.length,
                },
              ],
        ),
        findingModuleIds: module.findings.map((finding) => finding.moduleId),
        clauseKinds: clauses.map((clause) => clause.kind),
        recommendationCount: module.findings.filter(
          (finding) => finding.recommendation !== null,
        ).length,
      };
    }),
  };
}
