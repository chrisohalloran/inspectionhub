import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import OpenAI from "openai";
import { parse } from "yaml";

import {
  AgentsSdkDraftModel,
  ThinResponsesDraftModel,
  createDefaultInspectionSkillRegistry,
  prepareInvestigationAiRequest,
  runDeterministicDraftGuard,
  selectDraftingArchitecture,
} from "../../packages/agent/dist/index.js";
import { sha256 } from "../../packages/domain/dist/index.js";
import {
  aggregateArchitectureResults,
  scoreArchitectureDraft,
} from "./live-comparison-scoring.mjs";

const arguments_ = process.argv.slice(2);
const preflightOnly = arguments_.includes("--preflight");
if (arguments_.some((argument) => argument !== "--preflight")) {
  throw new Error("The live comparison accepts only the --preflight option");
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
  requestedTrials !== configuration.fixedTrials
) {
  throw new Error(
    `Live critical comparison requires exactly ${configuration.fixedTrials} predeclared trials`,
  );
}

const cases = (await loadCases()).filter((entry) => entry.architecture_subset);
if (
  cases.length !== configuration.architectureSubsetSize ||
  cases.some(
    (entry) =>
      entry.split !== "development" ||
      entry.locked_holdout !== false ||
      entry.model_input === undefined ||
      entry.output_oracle === undefined ||
      entry.expected.inspector_decision !== undefined ||
      entry.expected.verifier !== undefined ||
      (entry.expected.system_scenario_codes?.length ?? 0) > 0,
  )
) {
  throw new Error(
    "Live architecture subset must be the pinned development-only set with independent model input",
  );
}

const noProxyProvenance = Object.freeze({
  async resolveVerifiedSafeProxy() {
    throw new Error(
      "Architecture fixtures declare no media proxy; provenance resolution must not run",
    );
  },
});

const preparedCases = await Promise.all(
  cases.map(async (evalCase) => {
    const packet = packetForCase(evalCase, configuration);
    const request = await prepareInvestigationAiRequest({
      packet,
      selectedSafeProxies: [],
      provenance: noProxyProvenance,
    });
    assertOracleExcluded(request);
    return { evalCase, packet, request };
  }),
);

if (preflightOnly) {
  process.stdout.write(
    `${JSON.stringify({
      status: "passed",
      evidenceKind: "architecture_development_preflight",
      preparedRequestVersion: "prepared-ai-request-v2",
      developmentCaseIds: preparedCases.map(({ evalCase }) => evalCase.case_id),
      lockedHoldoutEvaluated: false,
      releaseEligible: false,
    })}\n`,
  );
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  process.stderr.write(
    "OPENAI_API_KEY is required for the observed ten-case architecture comparison.\n",
  );
  process.exit(5);
}

const pricing = configuration.pricing;
const trialResults = [];
for (const { evalCase, packet, request } of preparedCases) {
  for (let trial = 1; trial <= requestedTrials; trial += 1) {
    for (const architecture of ["thin_responses", "agents_sdk"]) {
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
          request,
          signal: controller.signal,
          maxTurns: 6,
        });
        const guard = runDeterministicDraftGuard(packet, result.draft);
        const score = scoreArchitectureDraft(evalCase, result.draft, guard);
        trialResults.push({
          caseId: evalCase.case_id,
          trial,
          architecture,
          criticalFailures: score.criticalFailures,
          inspectorInterventions: score.inspectorInterventions,
          missingFacts: score.missingFacts,
          missingUncertainties: score.missingUncertainties,
          forbiddenClaims: score.forbiddenClaims,
          oracleFailures: score.oracleFailures,
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
          missingUncertainties: evalCase.expected.allowed_uncertainties,
          forbiddenClaims: [],
          oracleFailures: ["model_generation_failed"],
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

const planner = aggregateArchitectureResults("agents_sdk", cases, trialResults);
const baseline = aggregateArchitectureResults(
  "thin_responses",
  cases,
  trialResults,
);
const decision = selectDraftingArchitecture({ planner, baseline });
const evidence = {
  schemaVersion: 1,
  evidenceKind: "architecture_development_comparison",
  observedAt: new Date().toISOString(),
  model: configuration.model,
  pricing,
  fixedTrials: requestedTrials,
  corpusCaseIds: cases.map((entry) => entry.case_id),
  baseline,
  planner,
  decision,
  developmentPassed: trialResults.every(
    (result) => result.criticalFailures === 0,
  ),
  lockedHoldoutPassed: false,
  releaseEligible: false,
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
  const modelInput = evalCase.model_input;
  const areaId = "evaluation-area";
  const moduleId = (module) =>
    modules.find((candidate) => candidate.module === module)?.moduleId;
  const observations = (modelInput.observations ?? []).map((source) => ({
    areaId,
    observationId: source.observation_id,
    recordedAt: "2026-07-15T08:01:00.000+10:00",
    recordedByInspectorId: "inspector-evaluation",
    text: source.text,
  }));
  const evidence = (modelInput.evidence ?? []).map((source, index) => ({
    artifactId: source.artifact_id,
    artifactKind: source.artifact_kind,
    captureAreaId: areaId,
    capturedAt: "2026-07-15T08:00:30.000+10:00",
    captureSequence: index + 1,
    currentAreaId: areaId,
    areaAssignmentHistory: [],
    attachedAt: "2026-07-15T08:01:00.000+10:00",
    attachedByInspectorId: "inspector-evaluation",
    linkOrdinal: index + 1,
    source: "captured_during_investigation",
  }));
  const transcriptSpans = (modelInput.transcript_spans ?? []).map(
    (source, index) => ({
      correctedText: source.corrected_text,
      correctionOrigin: source.correction_origin,
      endMilliseconds: (index + 1) * 5_000,
      spanId: source.span_id,
      startMilliseconds: index * 5_000,
      voiceArtifactId: source.voice_artifact_id,
    }),
  );
  const measurements = (modelInput.measurements ?? []).map((source) => ({
    areaId,
    measuredAt: "2026-07-15T08:01:30.000+10:00",
    measuredByInspectorId: "inspector-evaluation",
    measurementId: source.measurement_id,
    kind: source.kind,
    value: source.value,
    unit: source.unit,
    note: source.note,
  }));
  const limitations = (modelInput.limitations ?? []).map((source) => ({
    areaId,
    limitationId: source.limitation_id,
    module: source.module,
    moduleId: moduleId(source.module),
    description: source.description,
    material: source.material,
    recordedAt: "2026-07-15T08:02:00.000+10:00",
    status: "active",
    supersededAt: null,
  }));
  const contradictions = (modelInput.contradictions ?? []).map((source) => ({
    contradictionId: source.contradiction_id,
    description: source.description,
    resolution: source.resolution,
    sourceArtifactIds: source.source_artifact_ids,
    status: source.status,
  }));
  const coverageInput = modelInput.coverage ?? [];
  const coverage = modules.map((module, index) => {
    const declared = coverageInput.find(
      (candidate) => candidate.module === module.module,
    );
    return {
      areaId,
      coverageEntryId: `coverage-${evalCase.case_id.toLocaleLowerCase("en-AU")}-${index + 1}`,
      module: module.module,
      moduleId: module.moduleId,
      state: declared?.state ?? "inspected",
      detail:
        declared?.detail ??
        "Accessible areas represented by the synthetic evaluation fixture were visually inspected at the evaluation inspection time.",
      recordedAt: "2026-07-15T08:02:00.000+10:00",
      recordedByInspectorId: "inspector-evaluation",
      revision: 1,
    };
  });
  const packetSourceIds = new Set([
    ...observations.map((source) => source.observationId),
    ...evidence.map((source) => source.artifactId),
    ...transcriptSpans.map((source) => source.spanId),
    ...measurements.map((source) => source.measurementId),
    ...limitations.map((source) => source.limitationId),
  ]);
  if (
    evalCase.packet_manifest.selected_source_refs.some(
      (sourceId) => !packetSourceIds.has(sourceId),
    ) ||
    [...packetSourceIds].some(
      (sourceId) =>
        !evalCase.packet_manifest.selected_source_refs.includes(sourceId),
    )
  ) {
    throw new Error(
      `Architecture case ${evalCase.case_id} must select exactly its typed packet sources`,
    );
  }
  const content = {
    schemaVersion: 1,
    packetId: `packet-${evalCase.case_id.toLocaleLowerCase("en-AU")}`,
    packetRevision: 1,
    organizationId: "organization-evaluation",
    jobId: `job-${evalCase.case_id.toLocaleLowerCase("en-AU")}`,
    investigationId: `investigation-${evalCase.case_id.toLocaleLowerCase("en-AU")}`,
    investigationRevision: 1,
    modules,
    findingCandidates: modules.map((module) => ({
      findingCandidateId: `candidate-${evalCase.case_id.toLocaleLowerCase("en-AU")}-${module.module}`,
      module: module.module,
      moduleId: module.moduleId,
      sourceArtifactIds: evidence.map((source) => source.artifactId),
      sourceObservationIds: observations.map((source) => source.observationId),
    })),
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
        areaId,
        enteredAt: "2026-07-15T08:00:00.000+10:00",
        ordinal: 1,
      },
    ],
    evidence,
    measurements,
    observations,
    transcriptSpans,
    contradictions,
    priorInspectorFeedback: [],
    coverage,
    limitations,
    unknowns: modelInput.unknowns,
    createdAt: "2026-07-15T08:03:00.000+10:00",
  };
  return { ...content, canonicalHash: sha256(content) };
}

function assertOracleExcluded(request) {
  const serialized = JSON.stringify(request.input).toLocaleLowerCase("en-AU");
  for (const oracleKey of [
    "required_facts",
    "forbidden_claims",
    "inspector_decision",
    '"verifier"',
  ]) {
    if (serialized.includes(oracleKey)) {
      throw new Error(
        `Prepared architecture request contains scoring-oracle key ${oracleKey}`,
      );
    }
  }
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
