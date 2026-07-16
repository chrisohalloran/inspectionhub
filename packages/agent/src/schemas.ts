import { z } from "zod";

export const DraftModuleSchema = z.enum(["building", "timber_pest"]);

const SourceReferenceFields = {
  sourceId: z.string().trim().min(1).max(200),
};

export const DraftSourceReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("artifact"), ...SourceReferenceFields }),
  z.strictObject({
    kind: z.literal("transcript_span"),
    ...SourceReferenceFields,
    voiceArtifactId: z.string().trim().min(1).max(200),
  }),
  z.strictObject({ kind: z.literal("observation"), ...SourceReferenceFields }),
  z.strictObject({ kind: z.literal("measurement"), ...SourceReferenceFields }),
  z.strictObject({ kind: z.literal("limitation"), ...SourceReferenceFields }),
  z.strictObject({ kind: z.literal("coverage"), ...SourceReferenceFields }),
]);
export type DraftSourceReference = z.infer<typeof DraftSourceReferenceSchema>;

export const DraftClauseKindSchema = z.enum([
  "observation",
  "extent",
  "assumption",
  "hypothesis",
  "consequence",
  "recommendation",
  "limitation",
  "conclusion",
]);

export const DraftQualificationSchema = z.enum([
  "observed",
  "inspector_opinion",
  "assumption",
  "possibility",
  "limitation",
  "recommendation",
]);

export const DraftClauseSchema = z.strictObject({
  clauseId: z.string().trim().min(1).max(200),
  kind: DraftClauseKindSchema,
  text: z.string().trim().min(1).max(4_000),
  qualification: DraftQualificationSchema,
  sourceRefs: z.array(DraftSourceReferenceSchema).min(1).max(100),
});
export type DraftClause = z.infer<typeof DraftClauseSchema>;

export const InspectorClassificationSchema = z.strictObject({
  value: z.string().trim().min(1).max(200),
  attributedTo: z.literal("inspector"),
  sourceRefs: z.array(DraftSourceReferenceSchema).min(1).max(20),
});

export const FindingDraftSchema = z.strictObject({
  findingCandidateId: z.string().trim().min(1).max(200),
  module: DraftModuleSchema,
  moduleId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  observation: DraftClauseSchema,
  extent: DraftClauseSchema.nullable(),
  reasoning: z.array(DraftClauseSchema).max(20),
  consequences: z.array(DraftClauseSchema).max(20),
  inspectorClassification: InspectorClassificationSchema.nullable(),
  recommendation: DraftClauseSchema.nullable(),
});
export type FindingDraft = z.infer<typeof FindingDraftSchema>;

export const ModuleDraftSchema = z
  .strictObject({
    module: DraftModuleSchema,
    moduleId: z.string().trim().min(1).max(200),
    findings: z.array(FindingDraftSchema).max(100),
    limitations: z.array(DraftClauseSchema).max(100),
    conclusion: DraftClauseSchema,
    noReportableFinding: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.findings.some((finding) => finding.module !== value.module)) {
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message: "A module draft cannot contain findings from another module",
      });
    }
    if (value.findings.some((finding) => finding.moduleId !== value.moduleId)) {
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message:
          "Every finding must reference the exact professional module instance",
      });
    }
    if (value.noReportableFinding !== (value.findings.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["noReportableFinding"],
        message:
          "No-reportable-finding state must match the finding collection",
      });
    }
  });
export type ModuleDraft = z.infer<typeof ModuleDraftSchema>;

export const InspectionDraftSchema = z.strictObject({
  packetId: z.string().trim().min(1).max(200),
  packetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  packetRevision: z.int().positive(),
  origin: z.enum(["ai", "human"]),
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(200),
  skillVersions: z.array(z.string().trim().min(1).max(200)).max(20),
  modules: z.array(ModuleDraftSchema).min(1).max(2),
});
export type InspectionDraft = z.infer<typeof InspectionDraftSchema>;

export const VerifierIssueSchema = z.strictObject({
  code: z.string().trim().min(1).max(200),
  severity: z.enum(["critical", "non_critical"]),
  path: z.string().trim().min(1).max(500),
  message: z.string().trim().min(1).max(1_000),
});
export type VerifierIssue = z.infer<typeof VerifierIssueSchema>;

export const DraftVerificationSchema = z.strictObject({
  verifierVersion: z.string().trim().min(1).max(200),
  packetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  draftHash: z.string().regex(/^[a-f0-9]{64}$/u),
  passed: z.boolean(),
  issues: z.array(VerifierIssueSchema).max(500),
  verifiedAt: z.iso.datetime({ offset: true }),
});
export type DraftVerification = z.infer<typeof DraftVerificationSchema>;
