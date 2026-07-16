import { z } from "zod";

import { ArtifactReferenceSchema } from "./artifacts.js";
import {
  IdSchema,
  InspectorAttributionSchema,
  ModuleTypeSchema,
  NonEmptyTextSchema,
  Sha256Schema,
  TimestampSchema,
} from "./common.js";
import {
  BuildingConfirmedFindingSchema,
  TimberPestCategorySchema,
  TimberPestConfirmedFindingSchema,
  VerifierPassedSchema,
} from "./findings.js";

const CoverageIdentityFields = {
  coverageEntryId: IdSchema,
  module: ModuleTypeSchema,
  moduleId: IdSchema,
  areaId: IdSchema,
  recordedAt: TimestampSchema,
  recordedByInspectorId: IdSchema,
};

export const CoverageInspectedSchema = z.strictObject({
  ...CoverageIdentityFields,
  state: z.literal("inspected"),
});

export const CoverageNotApplicableSchema = z.strictObject({
  ...CoverageIdentityFields,
  state: z.literal("not_applicable"),
  reason: NonEmptyTextSchema,
});

const LimitedCoverageFields = {
  ...CoverageIdentityFields,
  limitation: NonEmptyTextSchema,
};

export const CoverageAccessLimitedSchema = z.strictObject({
  ...LimitedCoverageFields,
  state: z.literal("access_limited"),
});
export const CoverageInaccessibleSchema = z.strictObject({
  ...LimitedCoverageFields,
  state: z.literal("inaccessible"),
});
export const CoverageRevisitSchema = z.strictObject({
  ...LimitedCoverageFields,
  state: z.literal("revisit"),
});

export const CoverageEntrySchema = z.discriminatedUnion("state", [
  CoverageInspectedSchema,
  CoverageAccessLimitedSchema,
  CoverageInaccessibleSchema,
  CoverageNotApplicableSchema,
  CoverageRevisitSchema,
]);
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

export const ModuleLimitationSchema = z.strictObject({
  limitationId: IdSchema,
  module: ModuleTypeSchema,
  moduleId: IdSchema,
  areaId: IdSchema,
  material: z.boolean(),
  description: NonEmptyTextSchema,
  recordedAt: TimestampSchema,
  recordedByInspectorId: IdSchema,
});
export type ModuleLimitation = z.infer<typeof ModuleLimitationSchema>;

export const BuildingConclusionSchema = z.strictObject({
  module: z.literal("building"),
  summary: NonEmptyTextSchema,
  majorDefectCount: z.int().nonnegative(),
  minorDefectCount: z.int().nonnegative(),
});
export type BuildingConclusion = z.infer<typeof BuildingConclusionSchema>;

export const TimberPestConclusionSchema = z.strictObject({
  module: z.literal("timber_pest"),
  summary: NonEmptyTextSchema,
  visibleEvidenceObserved: z.boolean(),
  categoriesObserved: z.array(TimberPestCategorySchema),
});
export type TimberPestConclusion = z.infer<typeof TimberPestConclusionSchema>;

export const ModuleConclusionSchema = z.discriminatedUnion("module", [
  BuildingConclusionSchema,
  TimberPestConclusionSchema,
]);

const SnapshotIdentityFields = {
  snapshotId: IdSchema,
  organizationId: IdSchema,
  jobId: IdSchema,
  moduleId: IdSchema,
  revision: z.int().positive(),
  createdAt: TimestampSchema,
  inspector: InspectorAttributionSchema,
  requirementVersion: z.string().trim().min(1).max(200),
  templateVersion: z.string().trim().min(1).max(200),
  limitations: z.array(ModuleLimitationSchema),
  verifierResults: z.array(VerifierPassedSchema),
  evidenceHashes: z.array(Sha256Schema),
  mediaSelection: z.array(ArtifactReferenceSchema),
};

const BuildingSnapshotFields = {
  ...SnapshotIdentityFields,
  module: z.literal("building"),
  findings: z.array(BuildingConfirmedFindingSchema),
  coverage: z.array(CoverageEntrySchema),
  conclusion: BuildingConclusionSchema,
};

const TimberPestSnapshotFields = {
  ...SnapshotIdentityFields,
  module: z.literal("timber_pest"),
  findings: z.array(TimberPestConfirmedFindingSchema),
  coverage: z.array(CoverageEntrySchema),
  conclusion: TimberPestConclusionSchema,
};

type SnapshotRefinementValue = {
  readonly organizationId: string;
  readonly jobId: string;
  readonly moduleId: string;
  readonly module: "building" | "timber_pest";
  readonly inspector: {
    readonly inspectorId: string;
    readonly credentialVersion: string;
  };
  readonly findings: readonly {
    readonly findingId: string;
    readonly organizationId: string;
    readonly jobId: string;
    readonly moduleId: string;
    readonly content: { readonly module: "building" | "timber_pest" };
    readonly versionId: string;
    readonly contentHash: string;
    readonly authorship: { readonly origin: "human" | "ai" };
    readonly inspectorAttribution: {
      readonly inspectorId: string;
      readonly credentialVersion: string;
    };
    readonly verifier: { readonly status: string };
  }[];
  readonly coverage: readonly {
    readonly module: "building" | "timber_pest";
    readonly moduleId: string;
  }[];
  readonly limitations: readonly {
    readonly module: "building" | "timber_pest";
    readonly moduleId: string;
  }[];
  readonly evidenceHashes: readonly string[];
  readonly mediaSelection: readonly { readonly contentHash: string }[];
  readonly verifierResults: readonly {
    readonly status: "passed";
    readonly draftVersionId: string;
    readonly contentHash: string;
  }[];
};

function validateSnapshotRelationships(
  value: SnapshotRefinementValue,
  context: z.RefinementCtx,
) {
  for (const [index, finding] of value.findings.entries()) {
    if (
      finding.organizationId !== value.organizationId ||
      finding.jobId !== value.jobId ||
      finding.moduleId !== value.moduleId ||
      finding.content.module !== value.module
    ) {
      context.addIssue({
        code: "custom",
        path: ["findings", index],
        message:
          "Finding does not belong to this exact organisation, job, and professional module",
      });
    }
    if (
      finding.inspectorAttribution.inspectorId !==
        value.inspector.inspectorId ||
      finding.inspectorAttribution.credentialVersion !==
        value.inspector.credentialVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["findings", index, "inspectorAttribution"],
        message:
          "Finding confirmation must be attributed to the snapshot inspector and credential version",
      });
    }
    if (
      finding.authorship.origin === "ai" &&
      !value.verifierResults.some(
        (result) =>
          result.draftVersionId === finding.versionId &&
          result.contentHash === finding.contentHash,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["verifierResults"],
        message:
          "AI-authored findings require the exact verifier pass in the immutable snapshot",
      });
    }
  }
  for (const [index, coverage] of value.coverage.entries()) {
    if (
      coverage.module !== value.module ||
      coverage.moduleId !== value.moduleId
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", index],
        message:
          "Coverage is module-scoped and cannot cross professional modules",
      });
    }
  }
  for (const [index, limitation] of value.limitations.entries()) {
    if (
      limitation.module !== value.module ||
      limitation.moduleId !== value.moduleId
    ) {
      context.addIssue({
        code: "custom",
        path: ["limitations", index],
        message:
          "Limitation is module-scoped and cannot cross professional modules",
      });
    }
  }
  const evidenceHashes = new Set(value.evidenceHashes);
  for (const [index, media] of value.mediaSelection.entries()) {
    if (!evidenceHashes.has(media.contentHash)) {
      context.addIssue({
        code: "custom",
        path: ["mediaSelection", index, "contentHash"],
        message:
          "Selected report media must be represented in the snapshot evidence hash set",
      });
    }
  }
  const findingIds = value.findings.map(({ findingId }) => findingId);
  if (new Set(findingIds).size !== findingIds.length) {
    context.addIssue({
      code: "custom",
      path: ["findings"],
      message: "Snapshot findings must be unique",
    });
  }
}

export const BuildingModuleSnapshotInputSchema = z
  .strictObject(BuildingSnapshotFields)
  .superRefine(validateSnapshotRelationships);
export type BuildingModuleSnapshotInput = z.infer<
  typeof BuildingModuleSnapshotInputSchema
>;

export const TimberPestModuleSnapshotInputSchema = z
  .strictObject(TimberPestSnapshotFields)
  .superRefine(validateSnapshotRelationships);
export type TimberPestModuleSnapshotInput = z.infer<
  typeof TimberPestModuleSnapshotInputSchema
>;

export const ModuleSnapshotInputSchema = z.union([
  BuildingModuleSnapshotInputSchema,
  TimberPestModuleSnapshotInputSchema,
]);
export type ModuleSnapshotInput = z.infer<typeof ModuleSnapshotInputSchema>;

export const BuildingModuleSnapshotSchema = z
  .strictObject({ ...BuildingSnapshotFields, canonicalHash: Sha256Schema })
  .superRefine(validateSnapshotRelationships);
export type BuildingModuleSnapshot = z.infer<
  typeof BuildingModuleSnapshotSchema
>;

export const TimberPestModuleSnapshotSchema = z
  .strictObject({ ...TimberPestSnapshotFields, canonicalHash: Sha256Schema })
  .superRefine(validateSnapshotRelationships);
export type TimberPestModuleSnapshot = z.infer<
  typeof TimberPestModuleSnapshotSchema
>;

export const ModuleSnapshotSchema = z.union([
  BuildingModuleSnapshotSchema,
  TimberPestModuleSnapshotSchema,
]);
export type ModuleSnapshot = z.infer<typeof ModuleSnapshotSchema>;

export const ModuleApprovalSchema = z.strictObject({
  approvalId: IdSchema,
  organizationId: IdSchema,
  jobId: IdSchema,
  moduleId: IdSchema,
  module: ModuleTypeSchema,
  snapshotId: IdSchema,
  snapshotHash: Sha256Schema,
  inspectorId: IdSchema,
  approvedAt: TimestampSchema,
});
export type ModuleApproval = z.infer<typeof ModuleApprovalSchema>;

export const AmendmentRecordSchema = z.strictObject({
  amendmentId: IdSchema,
  priorSnapshotId: IdSchema,
  replacementSnapshotId: IdSchema,
  reason: NonEmptyTextSchema,
  amendedByInspectorId: IdSchema,
  amendedAt: TimestampSchema,
});
export type AmendmentRecord = z.infer<typeof AmendmentRecordSchema>;

export const WithdrawalRecordSchema = z.strictObject({
  reason: NonEmptyTextSchema,
  withdrawnByInspectorId: IdSchema,
  withdrawnAt: TimestampSchema,
  withdrawnSnapshotId: IdSchema,
});

export const EvidenceRiskRecordSchema = z.strictObject({
  artifactIds: z.array(IdSchema).min(1),
  reason: z.literal("device_lost_before_server_durability"),
  recordedAt: TimestampSchema,
});

export const ProfessionalModuleStateSchema = z
  .strictObject({
    organizationId: IdSchema,
    jobId: IdSchema,
    moduleId: IdSchema,
    module: ModuleTypeSchema,
    revision: z.int().nonnegative(),
    status: z.enum(["draft", "approved", "withdrawn", "evidence_at_risk"]),
    snapshots: z.array(ModuleSnapshotSchema),
    approvals: z.array(ModuleApprovalSchema),
    amendments: z.array(AmendmentRecordSchema),
    currentSnapshotId: IdSchema.nullable(),
    currentApprovalId: IdSchema.nullable(),
    withdrawal: WithdrawalRecordSchema.nullable(),
    evidenceRisk: EvidenceRiskRecordSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.snapshots.some(
        (snapshot) =>
          snapshot.organizationId !== value.organizationId ||
          snapshot.jobId !== value.jobId ||
          snapshot.module !== value.module ||
          snapshot.moduleId !== value.moduleId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["snapshots"],
        message: "Snapshot module mismatch",
      });
    }
    if (
      value.approvals.some(
        (approval) =>
          approval.organizationId !== value.organizationId ||
          approval.jobId !== value.jobId ||
          approval.module !== value.module ||
          approval.moduleId !== value.moduleId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["approvals"],
        message: "Approval module mismatch",
      });
    }
    if (
      value.currentSnapshotId !== null &&
      !value.snapshots.some(
        (snapshot) => snapshot.snapshotId === value.currentSnapshotId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentSnapshotId"],
        message: "Current snapshot is missing",
      });
    }
    if (
      value.currentApprovalId !== null &&
      !value.approvals.some(
        (approval) => approval.approvalId === value.currentApprovalId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentApprovalId"],
        message: "Current approval is missing",
      });
    }
    if (value.status === "approved" && value.currentApprovalId === null) {
      context.addIssue({
        code: "custom",
        path: ["currentApprovalId"],
        message: "Approved module needs an approval",
      });
    }
    if (
      value.status === "approved" &&
      value.currentApprovalId !== null &&
      value.currentSnapshotId !== null
    ) {
      const currentApproval = value.approvals.find(
        ({ approvalId }) => approvalId === value.currentApprovalId,
      );
      const currentSnapshot = value.snapshots.find(
        ({ snapshotId }) => snapshotId === value.currentSnapshotId,
      );
      if (
        currentApproval === undefined ||
        currentSnapshot === undefined ||
        currentApproval.snapshotId !== currentSnapshot.snapshotId ||
        currentApproval.snapshotHash !== currentSnapshot.canonicalHash
      ) {
        context.addIssue({
          code: "custom",
          path: ["currentApprovalId"],
          message:
            "Current approval must bind the exact current snapshot and canonical hash",
        });
      }
    }
    if (value.status === "withdrawn" && value.withdrawal === null) {
      context.addIssue({
        code: "custom",
        path: ["withdrawal"],
        message: "Withdrawal details are required",
      });
    }
    if (value.status === "evidence_at_risk" && value.evidenceRisk === null) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRisk"],
        message: "Evidence risk details are required",
      });
    }
    if (
      (value.status === "withdrawn" || value.status === "evidence_at_risk") &&
      value.currentApprovalId !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentApprovalId"],
        message:
          "Withdrawn or evidence-at-risk modules cannot retain a current approval",
      });
    }
    if (value.status !== "withdrawn" && value.withdrawal !== null) {
      context.addIssue({
        code: "custom",
        path: ["withdrawal"],
        message: "Only withdrawn modules retain current withdrawal state",
      });
    }
    if (value.status !== "evidence_at_risk" && value.evidenceRisk !== null) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRisk"],
        message:
          "Only evidence-at-risk modules retain current evidence risk state",
      });
    }
  });
export type ProfessionalModuleState = z.infer<
  typeof ProfessionalModuleStateSchema
>;
