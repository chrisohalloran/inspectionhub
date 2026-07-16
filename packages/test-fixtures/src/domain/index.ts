import type {
  ArtifactReference,
  BuildingConfirmedFinding,
  BuildingModuleSnapshotInput,
  TimberPestConfirmedFinding,
  TimberPestModuleSnapshotInput,
} from "@inspection/contracts";

export const domainFixtureIds = {
  organizationId: "50000000-0000-4000-8000-000000000001",
  jobId: "50000000-0000-4000-8000-000000000002",
  buildingModuleId: "50000000-0000-4000-8000-000000000003",
  timberPestModuleId: "50000000-0000-4000-8000-000000000004",
  inspectorId: "50000000-0000-4000-8000-000000000005",
  artifactId: "50000000-0000-4000-8000-000000000006",
} as const;

export const domainFixtureTimestamp = "2026-07-14T07:00:00.000Z";

export const sharedOriginalArtifactReference: ArtifactReference = {
  kind: "original",
  artifactId: domainFixtureIds.artifactId,
  contentHash: "a".repeat(64),
};

const inspectorAttribution = {
  inspectorId: domainFixtureIds.inspectorId,
  displayName: "Licensed Inspector",
  credentialVersion: "fixture-credential-v1",
  confirmedAt: domainFixtureTimestamp,
};

export const confirmedBuildingFinding: BuildingConfirmedFinding = {
  status: "confirmed",
  findingId: "50000000-0000-4000-8000-000000000007",
  versionId: "50000000-0000-4000-8000-000000000008",
  organizationId: domainFixtureIds.organizationId,
  jobId: domainFixtureIds.jobId,
  moduleId: domainFixtureIds.buildingModuleId,
  contentHash: "b".repeat(64),
  content: {
    module: "building",
    location: "Second floor / Main bathroom",
    observation: "Cracking is visible in several shower-base and floor tiles.",
    apparentExtent:
      "Several tiles in the shower base and main bathroom floor area.",
    qualifiedOpinion:
      "Movement in the supporting floor assembly may have contributed.",
    uncertainty: [
      "Concealed construction and membrane condition were not visually confirmed.",
    ],
    furtherInvestigation:
      "Engage a suitably licensed and qualified builder or tiler to investigate.",
    classification: "major_defect",
  },
  authorship: {
    origin: "human",
    sourceArtifactReferences: [sharedOriginalArtifactReference],
    transcriptSpanReferences: [],
  },
  inspectorAttribution,
  verifier: { status: "not_required", reason: "human_authored" },
};

export const confirmedTimberPestFinding: TimberPestConfirmedFinding = {
  status: "confirmed",
  findingId: "50000000-0000-4000-8000-000000000009",
  versionId: "50000000-0000-4000-8000-000000000010",
  organizationId: domainFixtureIds.organizationId,
  jobId: domainFixtureIds.jobId,
  moduleId: domainFixtureIds.timberPestModuleId,
  contentHash: "c".repeat(64),
  content: {
    module: "timber_pest",
    location: "Subfloor / Bearer 2",
    observation: "Surface damage is visible on the timber member.",
    apparentExtent: "The photographed face only.",
    qualifiedOpinion:
      "The observed condition requires timber-pest-specific investigation.",
    uncertainty: [
      "Concealed faces and adjacent enclosed timbers were not accessible.",
    ],
    furtherInvestigation:
      "Undertake further inspection of the member and adjacent accessible timbers.",
    category: "timber_damage",
  },
  authorship: {
    origin: "human",
    sourceArtifactReferences: [sharedOriginalArtifactReference],
    transcriptSpanReferences: [],
  },
  inspectorAttribution,
  verifier: { status: "not_required", reason: "human_authored" },
};

export function buildingModuleSnapshotFixture(
  revision = 1,
): BuildingModuleSnapshotInput {
  return {
    snapshotId: `50000000-0000-4000-8000-${(100 + revision).toString().padStart(12, "0")}`,
    organizationId: domainFixtureIds.organizationId,
    jobId: domainFixtureIds.jobId,
    moduleId: domainFixtureIds.buildingModuleId,
    module: "building",
    revision,
    createdAt: domainFixtureTimestamp,
    inspector: inspectorAttribution,
    requirementVersion: "fixture-building-requirements-v1",
    templateVersion: "fixture-building-template-v1",
    findings: [confirmedBuildingFinding],
    coverage: [],
    limitations: [],
    conclusion: {
      module: "building",
      summary: "A major Building defect was identified.",
      majorDefectCount: 1,
      minorDefectCount: 0,
    },
    verifierResults: [],
    evidenceHashes: [sharedOriginalArtifactReference.contentHash],
    mediaSelection: [sharedOriginalArtifactReference],
  };
}

export function timberPestModuleSnapshotFixture(
  revision = 1,
): TimberPestModuleSnapshotInput {
  return {
    snapshotId: `50000000-0000-4000-8000-${(200 + revision).toString().padStart(12, "0")}`,
    organizationId: domainFixtureIds.organizationId,
    jobId: domainFixtureIds.jobId,
    moduleId: domainFixtureIds.timberPestModuleId,
    module: "timber_pest",
    revision,
    createdAt: domainFixtureTimestamp,
    inspector: inspectorAttribution,
    requirementVersion: "fixture-timber-pest-requirements-v1",
    templateVersion: "fixture-timber-pest-template-v1",
    findings: [confirmedTimberPestFinding],
    coverage: [],
    limitations: [],
    conclusion: {
      module: "timber_pest",
      summary:
        "Visible timber damage was recorded in an accessible inspected area.",
      visibleEvidenceObserved: true,
      categoriesObserved: ["timber_damage"],
    },
    verifierResults: [],
    evidenceHashes: [sharedOriginalArtifactReference.contentHash],
    mediaSelection: [sharedOriginalArtifactReference],
  };
}
