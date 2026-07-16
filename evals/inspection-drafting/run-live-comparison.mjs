import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import OpenAI from "openai";
import { parse } from "yaml";

import {
  AgentsSdkDraftModel,
  ThinResponsesDraftModel,
  createDefaultInspectionSkillRegistry,
  runDeterministicDraftGuard,
  selectDraftingArchitecture,
} from "../../packages/agent/dist/index.js";
import { sha256 } from "../../packages/domain/dist/index.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  process.stderr.write(
    "OPENAI_API_KEY is required for the observed ten-case architecture comparison.\n",
  );
  process.exit(5);
}

const configuration = JSON.parse(
  await readFile(new URL("./release-config.json", import.meta.url), "utf8"),
);
const requestedTrials = Number.parseInt(
  process.env.LIVE_EVAL_TRIALS ?? String(configuration.fixedTrials),
  10,
);
if (
  !Number.isInteger(requestedTrials) ||
  requestedTrials < configuration.fixedTrials
) {
  throw new Error(
    `Live critical comparison requires at least ${configuration.fixedTrials} fixed trials`,
  );
}

const cases = (await loadCases()).filter((entry) => entry.architecture_subset);
if (cases.length !== configuration.architectureSubsetSize) {
  throw new Error(
    "Live architecture subset does not match the pinned release configuration",
  );
}

const pricing = configuration.pricing;
const trialResults = [];
for (const evalCase of cases) {
  for (let trial = 1; trial <= requestedTrials; trial += 1) {
    for (const architecture of ["thin_responses", "agents_sdk"]) {
      const packet = packetForCase(evalCase, configuration);
      const model =
        architecture === "thin_responses"
          ? new ThinResponsesDraftModel({
              client: new OpenAI({ apiKey }),
              pricing,
            })
          : new AgentsSdkDraftModel({
              apiKey,
              pricing,
              skills: createDefaultInspectionSkillRegistry(),
            });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const result = await model.generate({
          packet,
          signal: controller.signal,
          maxTurns: 6,
        });
        const guard = runDeterministicDraftGuard(packet, result.draft);
        const rendered = JSON.stringify(result.draft).toLocaleLowerCase(
          "en-AU",
        );
        const missingFacts = evalCase.expected.required_facts.filter(
          (fact) => !factPreserved(rendered, fact),
        );
        trialResults.push({
          caseId: evalCase.case_id,
          trial,
          architecture,
          criticalFailures:
            guard.issues.filter((issue) => issue.severity === "critical")
              .length + missingFacts.length,
          inspectorInterventions:
            missingFacts.length +
            guard.issues.filter((issue) => issue.severity === "non_critical")
              .length,
          missingFacts,
          guardIssues: guard.issues,
          latencyMilliseconds: result.latencyMilliseconds,
          costUsd: result.estimatedCostUsd,
          usage: result.usage,
          draft: result.draft,
          error: null,
        });
      } catch (error) {
        trialResults.push({
          caseId: evalCase.case_id,
          trial,
          architecture,
          criticalFailures: 1,
          inspectorInterventions: evalCase.expected.required_facts.length + 1,
          missingFacts: evalCase.expected.required_facts,
          guardIssues: [],
          latencyMilliseconds: 90_000,
          costUsd: 0,
          usage: { inputTokens: 0, outputTokens: 0, requests: 0 },
          draft: null,
          error: error instanceof Error ? error.name : "UnknownError",
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}

const planner = aggregate("agents_sdk", cases, trialResults);
const baseline = aggregate("thin_responses", cases, trialResults);
const decision = selectDraftingArchitecture({ planner, baseline });
const evidence = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  model: configuration.model,
  pricing,
  fixedTrials: requestedTrials,
  corpusCaseIds: cases.map((entry) => entry.case_id),
  baseline,
  planner,
  decision,
  worstCriticalFailureCount: Math.max(
    ...trialResults.map((result) => result.criticalFailures),
  ),
  trials: trialResults,
};
const artifactDirectory = resolve("artifacts/evals");
await mkdir(artifactDirectory, { recursive: true });
const artifactPath = resolve(
  artifactDirectory,
  `architecture-comparison-${evidence.observedAt.replaceAll(/[:.]/gu, "-")}.json`,
);
await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify({ artifactPath, decision }, null, 2)}\n`,
);

if (evidence.worstCriticalFailureCount > 0) {
  process.stderr.write(
    "Observed architecture comparison contains at least one critical failure; no runtime may be promoted.\n",
  );
  process.exit(7);
}

function aggregate(architecture, cases_, results) {
  return {
    architecture,
    cases: cases_.map((evalCase) => {
      const trials = results.filter(
        (result) =>
          result.caseId === evalCase.case_id &&
          result.architecture === architecture,
      );
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

function packetForCase(evalCase, config) {
  const modules = evalCase.modules.map((module) => ({
    module,
    moduleId: `module-${evalCase.case_id.toLocaleLowerCase("en-AU")}-${module}`,
  }));
  const skillVersions = ["report-language@1.0.0"];
  if (evalCase.modules.includes("building")) {
    skillVersions.push("building-inspection@1.0.0");
  }
  if (evalCase.modules.includes("timber_pest")) {
    skillVersions.push("timber-pest-inspection@1.0.0");
  }
  skillVersions.sort();
  const sourceId = evalCase.packet_manifest.selected_source_refs[0];
  const sourceText = [
    evalCase.scenario,
    `Inspector-recorded facts: ${evalCase.expected.required_facts.join("; ")}.`,
    evalCase.expected.allowed_uncertainties.length === 0
      ? "No additional uncertainty was recorded."
      : `Recorded uncertainty: ${evalCase.expected.allowed_uncertainties.join("; ")}.`,
    `Inspector decision: ${evalCase.expected.inspector_decision}.`,
  ].join(" ");
  const content = {
    schemaVersion: 1,
    packetId: `packet-${evalCase.case_id.toLocaleLowerCase("en-AU")}`,
    packetRevision: 1,
    organizationId: "organization-evaluation",
    jobId: `job-${evalCase.case_id.toLocaleLowerCase("en-AU")}`,
    investigationId: `investigation-${evalCase.case_id.toLocaleLowerCase("en-AU")}`,
    investigationRevision: 1,
    modules,
    moduleSchemas: modules.map((module) => ({
      ...module,
      schemaVersion: `${module.module}-finding-v1`,
    })),
    versionPins: {
      model: config.model,
      promptVersion: config.packetPromptVersion,
      skillVersions,
    },
    areaHistory: [
      {
        areaId: "evaluation-area",
        enteredAt: "2026-07-15T08:00:00.000+10:00",
        ordinal: 1,
      },
    ],
    evidence: [],
    measurements: [],
    observations: [
      {
        areaId: "evaluation-area",
        observationId: sourceId,
        recordedAt: "2026-07-15T08:01:00.000+10:00",
        recordedByInspectorId: "inspector-evaluation",
        text: sourceText,
      },
    ],
    transcriptSpans: [],
    contradictions: [],
    priorInspectorFeedback: [],
    coverage: modules.map((module, index) => ({
      areaId: "evaluation-area",
      coverageEntryId: `coverage-${evalCase.case_id.toLocaleLowerCase("en-AU")}-${index + 1}`,
      module: module.module,
      moduleId: module.moduleId,
      state: "inspected",
      detail:
        "Accessible areas represented by the synthetic evaluation fixture were visually inspected at the evaluation inspection time.",
      recordedAt: "2026-07-15T08:02:00.000+10:00",
      recordedByInspectorId: "inspector-evaluation",
      revision: 1,
    })),
    limitations: [],
    unknowns: evalCase.expected.allowed_uncertainties,
    createdAt: "2026-07-15T08:03:00.000+10:00",
  };
  return { ...content, canonicalHash: sha256(content) };
}

function factPreserved(renderedDraft, fact) {
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

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function loadCases() {
  const root = new URL("./cases/", import.meta.url);
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  return Promise.all(
    directories.map(async (directory) =>
      parse(
        await readFile(
          new URL(`${directory.name}/manifest.yaml`, root),
          "utf8",
        ),
      ),
    ),
  );
}
