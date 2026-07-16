import { z } from "zod";

import { ArtifactReferenceSchema } from "./artifacts.js";
import {
  IdSchema,
  InspectorAttributionSchema,
  NonEmptyTextSchema,
  Sha256Schema,
  TimestampSchema,
} from "./common.js";

export const BuildingClassificationSchema = z.enum([
  "major_defect",
  "minor_defect",
  "safety_hazard",
  "other_building_condition",
]);
export type BuildingClassification = z.infer<
  typeof BuildingClassificationSchema
>;

export const TimberPestCategorySchema = z.enum([
  "visible_evidence",
  "timber_damage",
  "conducive_condition",
  "no_visible_evidence",
]);
export type TimberPestCategory = z.infer<typeof TimberPestCategorySchema>;

const ProfessionalContentFields = {
  location: NonEmptyTextSchema,
  observation: NonEmptyTextSchema,
  apparentExtent: NonEmptyTextSchema,
  qualifiedOpinion: NonEmptyTextSchema,
  uncertainty: z.array(NonEmptyTextSchema).max(50),
  furtherInvestigation: NonEmptyTextSchema.nullable(),
};

export const BuildingFindingContentSchema = z.strictObject({
  module: z.literal("building"),
  ...ProfessionalContentFields,
  classification: BuildingClassificationSchema,
});
export type BuildingFindingContent = z.infer<
  typeof BuildingFindingContentSchema
>;

export const TimberPestFindingContentSchema = z.strictObject({
  module: z.literal("timber_pest"),
  ...ProfessionalContentFields,
  category: TimberPestCategorySchema,
});
export type TimberPestFindingContent = z.infer<
  typeof TimberPestFindingContentSchema
>;

export const FindingContentSchema = z.discriminatedUnion("module", [
  BuildingFindingContentSchema,
  TimberPestFindingContentSchema,
]);
export type FindingContent = z.infer<typeof FindingContentSchema>;

export const HumanAuthorshipSchema = z.strictObject({
  origin: z.literal("human"),
  sourceArtifactReferences: z.array(ArtifactReferenceSchema).min(1),
  transcriptSpanReferences: z.array(IdSchema),
});

export const AiAuthorshipSchema = z.strictObject({
  origin: z.literal("ai"),
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(200),
  skillVersions: z.array(z.string().trim().min(1).max(200)),
  packetRevision: z.int().positive(),
  sourceArtifactReferences: z.array(ArtifactReferenceSchema).min(1),
  transcriptSpanReferences: z.array(IdSchema),
});

export const AuthorshipSchema = z.discriminatedUnion("origin", [
  HumanAuthorshipSchema,
  AiAuthorshipSchema,
]);
export type Authorship = z.infer<typeof AuthorshipSchema>;

export const VerifierPendingSchema = z.strictObject({
  status: z.literal("pending"),
});
export const VerifierPassedSchema = z.strictObject({
  status: z.literal("passed"),
  draftVersionId: IdSchema,
  contentHash: Sha256Schema,
  verifierVersion: z.string().trim().min(1).max(200),
  verifiedAt: TimestampSchema,
});
export const VerifierRejectedSchema = z.strictObject({
  status: z.literal("rejected"),
  draftVersionId: IdSchema,
  contentHash: Sha256Schema,
  reasons: z.array(NonEmptyTextSchema).min(1),
  verifiedAt: TimestampSchema,
});
export const VerifierStaleSchema = z.strictObject({
  status: z.literal("stale"),
  draftVersionId: IdSchema,
  contentHash: Sha256Schema,
  supersededByVersionId: IdSchema,
  recordedAt: TimestampSchema,
});
export const VerifierNotRequiredSchema = z.strictObject({
  status: z.literal("not_required"),
  reason: z.literal("human_authored"),
});

export const VerifierResultSchema = z.discriminatedUnion("status", [
  VerifierPendingSchema,
  VerifierPassedSchema,
  VerifierRejectedSchema,
  VerifierStaleSchema,
  VerifierNotRequiredSchema,
]);
export type VerifierResult = z.infer<typeof VerifierResultSchema>;

const FindingIdentityFields = {
  findingId: IdSchema,
  versionId: IdSchema,
  organizationId: IdSchema,
  jobId: IdSchema,
  moduleId: IdSchema,
  contentHash: Sha256Schema,
};

function validateConfirmation(
  value: {
    readonly versionId: string;
    readonly contentHash: string;
    readonly authorship: Authorship;
    readonly verifier: VerifierResult;
  },
  context: z.RefinementCtx,
) {
  if (value.authorship.origin === "ai") {
    if (value.verifier.status !== "passed") {
      context.addIssue({
        code: "custom",
        path: ["verifier", "status"],
        message:
          "AI-authored findings require a verifier pass for the exact confirmed version",
      });
      return;
    }
    if (
      value.verifier.draftVersionId !== value.versionId ||
      value.verifier.contentHash !== value.contentHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["verifier"],
        message:
          "Verifier result does not match the exact confirmed version and content hash",
      });
    }
  } else if (value.verifier.status !== "not_required") {
    context.addIssue({
      code: "custom",
      path: ["verifier", "status"],
      message:
        "Human-authored findings must explicitly record that AI verification was not required",
    });
  }
}

export const BuildingProvisionalFindingSchema = z.strictObject({
  status: z.literal("provisional"),
  ...FindingIdentityFields,
  content: BuildingFindingContentSchema,
  authorship: AuthorshipSchema,
  verifier: VerifierResultSchema,
});

export const TimberPestProvisionalFindingSchema = z.strictObject({
  status: z.literal("provisional"),
  ...FindingIdentityFields,
  content: TimberPestFindingContentSchema,
  authorship: AuthorshipSchema,
  verifier: VerifierResultSchema,
});

export const BuildingConfirmedFindingSchema = z
  .strictObject({
    status: z.literal("confirmed"),
    ...FindingIdentityFields,
    content: BuildingFindingContentSchema,
    authorship: AuthorshipSchema,
    inspectorAttribution: InspectorAttributionSchema,
    verifier: VerifierResultSchema,
  })
  .superRefine(validateConfirmation);
export type BuildingConfirmedFinding = z.infer<
  typeof BuildingConfirmedFindingSchema
>;

export const TimberPestConfirmedFindingSchema = z
  .strictObject({
    status: z.literal("confirmed"),
    ...FindingIdentityFields,
    content: TimberPestFindingContentSchema,
    authorship: AuthorshipSchema,
    inspectorAttribution: InspectorAttributionSchema,
    verifier: VerifierResultSchema,
  })
  .superRefine(validateConfirmation);
export type TimberPestConfirmedFinding = z.infer<
  typeof TimberPestConfirmedFindingSchema
>;

export const ProvisionalFindingSchema = z.union([
  BuildingProvisionalFindingSchema,
  TimberPestProvisionalFindingSchema,
]);
export type ProvisionalFinding = z.infer<typeof ProvisionalFindingSchema>;

export const ConfirmedFindingSchema = z.union([
  BuildingConfirmedFindingSchema,
  TimberPestConfirmedFindingSchema,
]);
export type ConfirmedFinding = z.infer<typeof ConfirmedFindingSchema>;

export const FindingRecordSchema = z.union([
  ProvisionalFindingSchema,
  ConfirmedFindingSchema,
]);
export type FindingRecord = z.infer<typeof FindingRecordSchema>;
