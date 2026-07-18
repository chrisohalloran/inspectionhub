import { deepFreeze, sha256 } from "../canonical.js";
import { DomainConflictError } from "../errors.js";
import { currentCoverageEntries } from "./coverage.js";
import { orderedInvestigationEvidence } from "./investigation.js";
import type {
  CoverageLedger,
  Investigation,
  InvestigationPacket,
} from "./types.js";

export function createInvestigationPacket(input: {
  readonly packetId: string;
  readonly packetRevision: number;
  readonly investigation: Investigation;
  readonly coverageLedger: CoverageLedger;
  readonly selectedArtifactIds: readonly string[];
  readonly transcriptSpans?: InvestigationPacket["transcriptSpans"];
  readonly contradictions?: InvestigationPacket["contradictions"];
  readonly priorInspectorFeedback?: InvestigationPacket["priorInspectorFeedback"];
  readonly moduleSchemas: InvestigationPacket["moduleSchemas"];
  readonly versionPins: InvestigationPacket["versionPins"];
  readonly unknowns: readonly string[];
  readonly createdAt: string;
}): InvestigationPacket {
  const { investigation, coverageLedger } = input;
  if (!investigation.status.startsWith("completed_")) {
    throw new DomainConflictError(
      "investigation_not_complete",
      "Only a completed investigation can be frozen into a drafting packet",
    );
  }
  if (
    investigation.organizationId !== coverageLedger.organizationId ||
    investigation.jobId !== coverageLedger.jobId
  ) {
    throw new DomainConflictError(
      "coverage_investigation_mismatch",
      "Investigation and coverage must belong to the same organisation and job",
    );
  }
  if (
    !sameExactModuleSet(
      investigation.commissionedModules,
      coverageLedger.commissionedModules,
    )
  ) {
    throw new DomainConflictError(
      "packet_commission_mismatch",
      "Investigation and coverage must preserve the exact commissioned professional modules",
    );
  }
  if (input.packetRevision < 1 || !Number.isInteger(input.packetRevision)) {
    throw new DomainConflictError(
      "invalid_packet_revision",
      "Investigation packet revisions are positive integers",
    );
  }
  const selected = new Set(input.selectedArtifactIds);
  if (selected.size !== input.selectedArtifactIds.length) {
    throw new DomainConflictError(
      "duplicate_packet_evidence",
      "A packet cannot repeat selected evidence",
    );
  }
  const evidence = orderedInvestigationEvidence(investigation).filter((item) =>
    selected.has(item.artifactId),
  );
  if (evidence.length !== selected.size) {
    throw new DomainConflictError(
      "packet_evidence_not_attached",
      "A packet may contain only inspector-selected evidence attached to the investigation",
    );
  }
  const findingCandidates =
    investigation.completion?.outcome === "finding_candidates"
      ? investigation.completion.moduleLinks
      : [];
  const candidateArtifactIds = new Set(
    findingCandidates.flatMap((candidate) => candidate.sourceArtifactIds),
  );
  if (
    findingCandidates.length > 0 &&
    (candidateArtifactIds.size !== selected.size ||
      [...candidateArtifactIds].some((artifactId) => !selected.has(artifactId)))
  ) {
    throw new DomainConflictError(
      "packet_candidate_evidence_mismatch",
      "A finding packet must contain exactly the inspector-selected candidate evidence",
    );
  }
  const candidateObservationIds = new Set(
    findingCandidates.flatMap((candidate) => candidate.sourceObservationIds),
  );
  const observations =
    findingCandidates.length === 0
      ? investigation.observations
      : investigation.observations.filter((observation) =>
          candidateObservationIds.has(observation.observationId),
        );
  if (
    findingCandidates.length > 0 &&
    observations.length !== candidateObservationIds.size
  ) {
    throw new DomainConflictError(
      "packet_candidate_observation_mismatch",
      "A finding packet must preserve every inspector-selected candidate observation",
    );
  }
  const modules = investigation.commissionedModules;
  validatePacketContext({
    findingCandidates,
    selectedArtifactIds: selected,
    modules,
    moduleSchemas: input.moduleSchemas,
    transcriptSpans: input.transcriptSpans ?? [],
    contradictions: input.contradictions ?? [],
    priorInspectorFeedback: input.priorInspectorFeedback ?? [],
    versionPins: input.versionPins,
  });
  const activeLimitations = coverageLedger.limitations.filter(
    (limitation) => limitation.status === "active",
  );
  const content = {
    schemaVersion: 1 as const,
    packetId: input.packetId,
    packetRevision: input.packetRevision,
    organizationId: investigation.organizationId,
    jobId: investigation.jobId,
    investigationId: investigation.investigationId,
    investigationRevision: investigation.revision,
    modules,
    findingCandidates,
    moduleSchemas: input.moduleSchemas,
    versionPins: input.versionPins,
    areaHistory: investigation.areaVisits,
    evidence,
    measurements: investigation.measurements,
    observations,
    transcriptSpans: input.transcriptSpans ?? [],
    contradictions: input.contradictions ?? [],
    priorInspectorFeedback: input.priorInspectorFeedback ?? [],
    coverage: currentCoverageEntries(coverageLedger),
    limitations: activeLimitations,
    unknowns: input.unknowns.map((unknown) => unknown.trim()).filter(Boolean),
    createdAt: input.createdAt,
  };
  return deepFreeze({ ...content, canonicalHash: sha256(content) });
}

function sameExactModuleSet(
  left: Investigation["commissionedModules"],
  right: CoverageLedger["commissionedModules"],
): boolean {
  const leftKeys = left.map(moduleIdentity).sort();
  const rightKeys = right.map(moduleIdentity).sort();
  return (
    new Set(leftKeys).size === leftKeys.length &&
    new Set(rightKeys).size === rightKeys.length &&
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index])
  );
}

function moduleIdentity(reference: {
  readonly module: string;
  readonly moduleId: string;
}): string {
  return JSON.stringify([reference.module, reference.moduleId]);
}

function validatePacketContext(input: {
  readonly findingCandidates: InvestigationPacket["findingCandidates"];
  readonly selectedArtifactIds: ReadonlySet<string>;
  readonly modules: InvestigationPacket["modules"];
  readonly moduleSchemas: InvestigationPacket["moduleSchemas"];
  readonly transcriptSpans: InvestigationPacket["transcriptSpans"];
  readonly contradictions: InvestigationPacket["contradictions"];
  readonly priorInspectorFeedback: InvestigationPacket["priorInspectorFeedback"];
  readonly versionPins: InvestigationPacket["versionPins"];
}): void {
  assertNonBlank(input.versionPins.model, "model version");
  assertNonBlank(input.versionPins.promptVersion, "prompt version");
  for (const version of input.versionPins.skillVersions) {
    assertNonBlank(version, "skill version");
  }
  const moduleKeys = new Set(
    input.modules.map((module) => `${module.module}:${module.moduleId}`),
  );
  const candidateIds = new Set<string>();
  for (const candidate of input.findingCandidates) {
    const moduleKey = `${candidate.module}:${candidate.moduleId}`;
    if (
      candidateIds.has(candidate.findingCandidateId) ||
      !moduleKeys.has(moduleKey) ||
      candidate.sourceArtifactIds.length === 0 ||
      candidate.sourceObservationIds.length === 0 ||
      new Set(candidate.sourceArtifactIds).size !==
        candidate.sourceArtifactIds.length ||
      new Set(candidate.sourceObservationIds).size !==
        candidate.sourceObservationIds.length ||
      candidate.sourceArtifactIds.some(
        (artifactId) => !input.selectedArtifactIds.has(artifactId),
      )
    ) {
      throw new DomainConflictError(
        "invalid_packet_finding_candidate",
        "Packet finding candidates must preserve unique module-bound inspector source selections",
      );
    }
    candidateIds.add(candidate.findingCandidateId);
  }
  const schemaKeys = new Set<string>();
  for (const schema of input.moduleSchemas) {
    assertNonBlank(schema.schemaVersion, "module schema version");
    const key = `${schema.module}:${schema.moduleId}`;
    if (!moduleKeys.has(key) || schemaKeys.has(key)) {
      throw new DomainConflictError(
        "packet_module_schema_mismatch",
        "Packet module schemas must map one-to-one to the exact professional modules",
      );
    }
    schemaKeys.add(key);
  }
  if (schemaKeys.size !== moduleKeys.size) {
    throw new DomainConflictError(
      "packet_module_schema_missing",
      "Every packet professional module requires an exact schema version",
    );
  }

  const spanIds = new Set<string>();
  for (const span of input.transcriptSpans) {
    if (
      spanIds.has(span.spanId) ||
      !input.selectedArtifactIds.has(span.voiceArtifactId) ||
      span.startMilliseconds < 0 ||
      span.endMilliseconds <= span.startMilliseconds
    ) {
      throw new DomainConflictError(
        "invalid_packet_transcript_span",
        "Transcript spans must be unique, bounded, and reference selected voice evidence",
      );
    }
    assertNonBlank(span.correctedText, "corrected transcript span");
    spanIds.add(span.spanId);
  }

  const contradictionIds = new Set<string>();
  for (const contradiction of input.contradictions) {
    if (
      contradictionIds.has(contradiction.contradictionId) ||
      contradiction.sourceArtifactIds.length === 0 ||
      contradiction.sourceArtifactIds.some(
        (artifactId) => !input.selectedArtifactIds.has(artifactId),
      ) ||
      (contradiction.status === "resolved" &&
        (contradiction.resolution?.trim().length ?? 0) === 0) ||
      (contradiction.status === "unresolved" &&
        contradiction.resolution !== null)
    ) {
      throw new DomainConflictError(
        "invalid_packet_contradiction",
        "Contradictions must be unique, source-linked, and have a consistent resolution state",
      );
    }
    assertNonBlank(contradiction.description, "contradiction description");
    contradictionIds.add(contradiction.contradictionId);
  }

  const feedbackIds = new Set<string>();
  const moduleTypes = new Set(input.modules.map((module) => module.module));
  for (const feedback of input.priorInspectorFeedback) {
    if (
      feedbackIds.has(feedback.feedbackId) ||
      feedback.modules.length === 0 ||
      feedback.modules.some((module) => !moduleTypes.has(module))
    ) {
      throw new DomainConflictError(
        "invalid_packet_feedback",
        "Prior inspector feedback must be unique and scoped to packet modules",
      );
    }
    assertNonBlank(feedback.text, "prior inspector feedback");
    feedbackIds.add(feedback.feedbackId);
  }
}

function assertNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new DomainConflictError(
      "blank_packet_context",
      `Packet ${label} cannot be blank`,
    );
  }
}
