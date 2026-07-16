import type { ModuleType } from "@inspection/contracts";
import type { InvestigationPacket } from "@inspection/domain";

import type {
  DraftClause,
  DraftSourceReference,
  InspectionDraft,
  VerifierIssue,
} from "./schemas.js";

const PROHIBITED_BOUNDARY_PATTERNS: readonly [RegExp, string][] = [
  [
    /\b(buy|do not buy|purchase|proceed with the purchase)\b/iu,
    "transaction_advice",
  ],
  [/\b(negotiate|offer price|price reduction)\b/iu, "negotiation_advice"],
  [
    /\b(repair cost|cost to repair|budget \$|valuation|market value)\b/iu,
    "cost_or_valuation_advice",
  ],
  [
    /\b(settlement|cooling[- ]off|contractual|legal advice)\b/iu,
    "legal_or_settlement_advice",
  ],
  [
    /\b(guarantee[ds]?|warrant(?:y|ed)|certif(?:y|ies|ied))\b/iu,
    "guarantee_or_certification",
  ],
];

const BUILDING_ONLY_TERMS = /\b(major defect|minor defect|safety hazard)\b/iu;
const PEST_ONLY_TERMS =
  /\b(termite|timber pest|wood borer|fungal decay|conducive condition)\b/iu;
const ABSOLUTE_NO_PEST =
  /\b(no termites|termite[- ]free|no timber pests?|free of (?:termite|timber pest))\b/iu;
const BOUNDED_NO_EVIDENCE = /\bno visible evidence\b/iu;
const ACCESS_TIME_BOUNDARY =
  /\b(accessible|accessed).*(at the time|on the day|during the inspection)|\b(at the time|on the day|during the inspection).*(accessible|accessed)\b/iu;

export type DeterministicGuardResult = {
  readonly passed: boolean;
  readonly issues: readonly VerifierIssue[];
};

export function runDeterministicDraftGuard(
  packet: InvestigationPacket,
  draft: InspectionDraft,
): DeterministicGuardResult {
  const issues: VerifierIssue[] = [];
  if (
    draft.packetId !== packet.packetId ||
    draft.packetHash !== packet.canonicalHash ||
    draft.packetRevision !== packet.packetRevision
  ) {
    issues.push(
      critical(
        "packet_identity_mismatch",
        "$",
        "Draft does not target the exact frozen packet",
      ),
    );
  }

  const expectedModules = new Map(
    packet.modules.map((module) => [module.module, module.moduleId]),
  );
  const seenModules = new Set<ModuleType>();
  for (const [moduleIndex, moduleDraft] of draft.modules.entries()) {
    const modulePath = `modules[${moduleIndex}]`;
    const expectedModuleId = expectedModules.get(moduleDraft.module);
    if (
      expectedModuleId === undefined ||
      expectedModuleId !== moduleDraft.moduleId ||
      seenModules.has(moduleDraft.module)
    ) {
      issues.push(
        critical(
          "module_identity_mismatch",
          modulePath,
          "Draft modules must map one-to-one to commissioned module instances",
        ),
      );
    }
    seenModules.add(moduleDraft.module);

    const clauses: DraftClause[] = [
      ...moduleDraft.limitations,
      moduleDraft.conclusion,
      ...moduleDraft.findings.flatMap((finding) => [
        finding.observation,
        ...(finding.extent === null ? [] : [finding.extent]),
        ...finding.reasoning,
        ...finding.consequences,
        ...(finding.recommendation === null ? [] : [finding.recommendation]),
      ]),
    ];
    clauses.forEach((clause, clauseIndex) => {
      const path = `${modulePath}.clauses[${clauseIndex}]`;
      issues.push(...checkClause(packet, moduleDraft.module, clause, path));
    });

    for (const [findingIndex, finding] of moduleDraft.findings.entries()) {
      const findingPath = `${modulePath}.findings[${findingIndex}]`;
      if (finding.recommendation === null) {
        issues.push(
          nonCritical(
            "missing_technical_recommendation",
            findingPath,
            "Inspector review is required because the draft has no technical further-investigation recommendation",
          ),
        );
      }
      if (
        finding.inspectorClassification !== null &&
        !classificationAppearsInSources(
          packet,
          finding.inspectorClassification.value,
          finding.inspectorClassification.sourceRefs,
        )
      ) {
        issues.push(
          critical(
            "autonomous_classification",
            `${findingPath}.inspectorClassification`,
            "A classification may only be repeated when an inspector-authored packet source states it",
          ),
        );
      }
    }
  }

  if (seenModules.size !== expectedModules.size) {
    issues.push(
      critical(
        "module_missing",
        "modules",
        "Every commissioned module requires its own draft and conclusion",
      ),
    );
  }
  return Object.freeze({
    passed: !issues.some((issue) => issue.severity === "critical"),
    issues: Object.freeze(issues),
  });
}

function checkClause(
  packet: InvestigationPacket,
  module: ModuleType,
  clause: DraftClause,
  path: string,
): readonly VerifierIssue[] {
  const issues: VerifierIssue[] = [];
  for (const [pattern, code] of PROHIBITED_BOUNDARY_PATTERNS) {
    if (pattern.test(clause.text)) {
      issues.push(
        critical(
          code,
          path,
          "Draft crosses the condition-reporting professional boundary",
        ),
      );
    }
  }
  if (module === "building" && PEST_ONLY_TERMS.test(clause.text)) {
    issues.push(
      critical(
        "module_taxonomy_leakage",
        path,
        "Timber Pest language cannot appear in the Building module draft",
      ),
    );
  }
  if (module === "timber_pest" && BUILDING_ONLY_TERMS.test(clause.text)) {
    issues.push(
      critical(
        "module_taxonomy_leakage",
        path,
        "Building classification language cannot appear in the Timber Pest module draft",
      ),
    );
  }
  if (ABSOLUTE_NO_PEST.test(clause.text)) {
    issues.push(
      critical(
        "absolute_no_pest_claim",
        path,
        "The inspection cannot establish an absolute absence of termites or timber pests",
      ),
    );
  }
  if (module === "timber_pest" && BOUNDED_NO_EVIDENCE.test(clause.text)) {
    if (!ACCESS_TIME_BOUNDARY.test(clause.text)) {
      issues.push(
        critical(
          "unbounded_no_evidence_claim",
          path,
          "A no-visible-evidence statement must name accessible inspected areas and the inspection time context",
        ),
      );
    }
    if (!clause.sourceRefs.some((reference) => reference.kind === "coverage")) {
      issues.push(
        critical(
          "no_evidence_without_coverage",
          path,
          "A bounded no-visible-evidence statement requires packet coverage provenance",
        ),
      );
    }
  }
  const expectedQualification = expectedQualificationFor(clause.kind);
  if (!expectedQualification.includes(clause.qualification)) {
    issues.push(
      critical(
        "lost_qualification",
        path,
        `Clause kind ${clause.kind} is not correctly qualified`,
      ),
    );
  }
  for (const [sourceIndex, source] of clause.sourceRefs.entries()) {
    if (!packetAuthorizesSource(packet, source)) {
      issues.push(
        critical(
          "unauthorized_provenance",
          `${path}.sourceRefs[${sourceIndex}]`,
          "Clause references evidence outside the frozen packet",
        ),
      );
    }
  }
  return issues;
}

function expectedQualificationFor(
  kind: DraftClause["kind"],
): readonly DraftClause["qualification"][] {
  switch (kind) {
    case "observation":
    case "extent":
      return ["observed", "inspector_opinion"];
    case "assumption":
      return ["assumption"];
    case "hypothesis":
    case "consequence":
      return ["possibility", "inspector_opinion"];
    case "recommendation":
      return ["recommendation"];
    case "limitation":
      return ["limitation"];
    case "conclusion":
      return ["inspector_opinion", "observed", "limitation"];
  }
}

export function packetAuthorizesSource(
  packet: InvestigationPacket,
  source: DraftSourceReference,
): boolean {
  switch (source.kind) {
    case "artifact":
      return packet.evidence.some(
        (item) => item.artifactId === source.sourceId,
      );
    case "transcript_span":
      return packet.transcriptSpans.some(
        (item) =>
          item.spanId === source.sourceId &&
          item.voiceArtifactId === source.voiceArtifactId,
      );
    case "observation":
      return packet.observations.some(
        (item) => item.observationId === source.sourceId,
      );
    case "measurement":
      return packet.measurements.some(
        (item) => item.measurementId === source.sourceId,
      );
    case "limitation":
      return packet.limitations.some(
        (item) => item.limitationId === source.sourceId,
      );
    case "coverage":
      return packet.coverage.some(
        (item) => item.coverageEntryId === source.sourceId,
      );
  }
}

function classificationAppearsInSources(
  packet: InvestigationPacket,
  classification: string,
  sources: readonly DraftSourceReference[],
): boolean {
  const needle = classification.replaceAll("_", " ").toLocaleLowerCase("en-AU");
  return sources.some((source) =>
    sourceText(packet, source).toLocaleLowerCase("en-AU").includes(needle),
  );
}

function sourceText(
  packet: InvestigationPacket,
  source: DraftSourceReference,
): string {
  switch (source.kind) {
    case "transcript_span":
      return (
        packet.transcriptSpans.find((item) => item.spanId === source.sourceId)
          ?.correctedText ?? ""
      );
    case "observation":
      return (
        packet.observations.find(
          (item) => item.observationId === source.sourceId,
        )?.text ?? ""
      );
    case "measurement":
      return (
        packet.measurements.find(
          (item) => item.measurementId === source.sourceId,
        )?.note ?? ""
      );
    case "limitation":
      return (
        packet.limitations.find((item) => item.limitationId === source.sourceId)
          ?.description ?? ""
      );
    case "coverage":
      return (
        packet.coverage.find((item) => item.coverageEntryId === source.sourceId)
          ?.detail ?? ""
      );
    case "artifact":
      return "";
  }
}

function critical(code: string, path: string, message: string): VerifierIssue {
  return { code, severity: "critical", path, message };
}

function nonCritical(
  code: string,
  path: string,
  message: string,
): VerifierIssue {
  return { code, severity: "non_critical", path, message };
}
