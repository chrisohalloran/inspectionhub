import type { InvestigationPacket } from "@inspection/domain";

import type { DraftClause, InspectionDraft } from "./schemas.js";

const packetHash = "a".repeat(64);

export function crackedTilePacket(): InvestigationPacket {
  return {
    schemaVersion: 1,
    packetId: "packet-cracked-tile",
    packetRevision: 1,
    canonicalHash: packetHash,
    organizationId: "organization-1",
    jobId: "job-1",
    investigationId: "investigation-1",
    investigationRevision: 4,
    modules: [{ module: "building", moduleId: "module-building" }],
    moduleSchemas: [
      {
        module: "building",
        moduleId: "module-building",
        schemaVersion: "building-finding-v1",
      },
    ],
    versionPins: {
      model: "gpt-5.6",
      promptVersion: "inspection-draft-v1",
      skillVersions: ["building-inspection@1.0.0", "report-language@1.0.0"],
    },
    areaHistory: [
      {
        areaId: "main-bathroom",
        enteredAt: "2026-07-14T08:00:00.000+10:00",
        ordinal: 1,
      },
    ],
    evidence: [
      {
        artifactId: "photo-cracked-tiles",
        artifactKind: "photo",
        captureAreaId: "main-bathroom",
        capturedAt: "2026-07-14T08:01:00.000+10:00",
        captureSequence: 1,
        currentAreaId: "main-bathroom",
        areaAssignmentHistory: [
          {
            areaId: "main-bathroom",
            assignedAt: "2026-07-14T08:01:00.000+10:00",
            assignedByInspectorId: "inspector-1",
            reason: "capture_context",
          },
        ],
        attachedAt: "2026-07-14T08:01:01.000+10:00",
        attachedByInspectorId: "inspector-1",
        linkOrdinal: 1,
        source: "captured_during_investigation",
      },
      {
        artifactId: "voice-cracked-tiles",
        artifactKind: "voice_note",
        captureAreaId: "main-bathroom",
        capturedAt: "2026-07-14T08:01:05.000+10:00",
        captureSequence: 2,
        currentAreaId: "main-bathroom",
        areaAssignmentHistory: [
          {
            areaId: "main-bathroom",
            assignedAt: "2026-07-14T08:01:05.000+10:00",
            assignedByInspectorId: "inspector-1",
            reason: "capture_context",
          },
        ],
        attachedAt: "2026-07-14T08:01:06.000+10:00",
        attachedByInspectorId: "inspector-1",
        linkOrdinal: 2,
        source: "captured_during_investigation",
      },
    ],
    measurements: [],
    observations: [
      {
        areaId: "main-bathroom",
        observationId: "observation-cracked-tiles",
        recordedAt: "2026-07-14T08:02:00.000+10:00",
        recordedByInspectorId: "inspector-1",
        text: "Cracking is present in several shower-base and bathroom-floor tiles on the second floor. The inspector classified this as a major defect. Engage a suitably licensed builder or tiler to investigate.",
      },
      {
        areaId: "main-bathroom",
        observationId: "observation-construction-unknown",
        recordedAt: "2026-07-14T08:02:10.000+10:00",
        recordedByInspectorId: "inspector-1",
        text: "The concealed floor construction was not visually confirmed.",
      },
    ],
    transcriptSpans: [
      {
        correctedText:
          "Suspect movement in the subfloor. The waterproof membrane may have been damaged.",
        correctionOrigin: "inspector",
        endMilliseconds: 5_200,
        spanId: "span-cracked-tiles",
        startMilliseconds: 1_000,
        voiceArtifactId: "voice-cracked-tiles",
      },
    ],
    contradictions: [
      {
        contradictionId: "contradiction-concealed-floor",
        description:
          "The apparent movement mechanism cannot be confirmed because the construction is concealed.",
        resolution: null,
        sourceArtifactIds: ["photo-cracked-tiles"],
        status: "unresolved",
      },
    ],
    priorInspectorFeedback: [],
    coverage: [
      {
        areaId: "main-bathroom",
        coverageEntryId: "coverage-main-bathroom",
        module: "building",
        moduleId: "module-building",
        state: "inspected",
        detail: null,
        recordedAt: "2026-07-14T08:03:00.000+10:00",
        recordedByInspectorId: "inspector-1",
        revision: 1,
      },
    ],
    limitations: [],
    unknowns: [
      "Subfloor construction and waterproof membrane condition were not visually confirmed.",
    ],
    createdAt: "2026-07-14T08:04:00.000+10:00",
  };
}

function clause(
  clauseId: string,
  kind: DraftClause["kind"],
  text: string,
  qualification: DraftClause["qualification"],
  sourceId: string,
  sourceKind: "observation" | "transcript_span" = "observation",
): DraftClause {
  return {
    clauseId,
    kind,
    text,
    qualification,
    sourceRefs: [
      sourceKind === "transcript_span"
        ? {
            kind: sourceKind,
            sourceId,
            voiceArtifactId: "voice-cracked-tiles",
          }
        : { kind: sourceKind, sourceId },
    ],
  };
}

export function cleanCrackedTileDraft(): InspectionDraft {
  return {
    packetId: "packet-cracked-tile",
    packetHash,
    packetRevision: 1,
    origin: "ai",
    model: "gpt-5.6",
    promptVersion: "inspection-draft-v1",
    skillVersions: ["building-inspection@1.0.0", "report-language@1.0.0"],
    modules: [
      {
        module: "building",
        moduleId: "module-building",
        findings: [
          {
            findingCandidateId: "candidate-cracked-tiles",
            module: "building",
            moduleId: "module-building",
            title: "Cracked bathroom floor and shower-base tiles",
            observation: clause(
              "clause-observation",
              "observation",
              "Several shower-base and bathroom-floor tiles were visibly cracked on the second floor.",
              "observed",
              "observation-cracked-tiles",
            ),
            extent: clause(
              "clause-extent",
              "extent",
              "Cracking was visible in several tiles across the shower base and main bathroom floor area.",
              "observed",
              "observation-cracked-tiles",
            ),
            reasoning: [
              {
                clauseId: "clause-hypothesis",
                kind: "hypothesis",
                text: "Movement in the concealed subfloor is a possible cause; the construction was not visually confirmed.",
                qualification: "possibility",
                sourceRefs: [
                  {
                    kind: "transcript_span",
                    sourceId: "span-cracked-tiles",
                    voiceArtifactId: "voice-cracked-tiles",
                  },
                  {
                    kind: "observation",
                    sourceId: "observation-construction-unknown",
                  },
                ],
              },
            ],
            consequences: [
              clause(
                "clause-consequence",
                "consequence",
                "The waterproof membrane may have been damaged.",
                "possibility",
                "span-cracked-tiles",
                "transcript_span",
              ),
            ],
            inspectorClassification: {
              value: "major_defect",
              attributedTo: "inspector",
              sourceRefs: [
                { kind: "observation", sourceId: "observation-cracked-tiles" },
              ],
            },
            recommendation: clause(
              "clause-recommendation",
              "recommendation",
              "Engage a suitably licensed builder or tiler to investigate the cracking and concealed construction.",
              "recommendation",
              "observation-cracked-tiles",
            ),
          },
        ],
        limitations: [
          {
            clauseId: "clause-limitation",
            kind: "limitation",
            text: "The subfloor construction and waterproof membrane condition were concealed and not visually confirmed.",
            qualification: "limitation",
            sourceRefs: [
              {
                kind: "observation",
                sourceId: "observation-construction-unknown",
              },
              {
                kind: "transcript_span",
                sourceId: "span-cracked-tiles",
                voiceArtifactId: "voice-cracked-tiles",
              },
            ],
          },
        ],
        conclusion: clause(
          "clause-conclusion",
          "conclusion",
          "Cracked bathroom tiles were observed and recorded by the inspector as a major defect.",
          "inspector_opinion",
          "observation-cracked-tiles",
        ),
        noReportableFinding: false,
      },
    ],
  };
}
