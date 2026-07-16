import {
  CommissionedModulesSchema,
  IdSchema,
  TimestampSchema,
} from "@inspection/contracts";
import { z } from "zod";

export const AgreementScopeSectionSchema = z.strictObject({
  heading: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
});

export const AgreementTemplateVersionSchema = z.strictObject({
  templateId: IdSchema,
  version: z.int().positive(),
  status: z.enum(["draft", "published", "retired"]),
  publishedAt: TimestampSchema.nullable(),
  title: z.string().trim().min(1).max(300),
  introductoryText: z.string().trim().min(1).max(20_000),
  building: AgreementScopeSectionSchema.nullable(),
  timberPest: AgreementScopeSectionSchema.nullable(),
  acknowledgementText: z.string().trim().min(1).max(4_000),
});
export type AgreementTemplateVersion = z.infer<
  typeof AgreementTemplateVersionSchema
>;

export const AgreementSignerSnapshotSchema = z.strictObject({
  assignmentId: IdSchema,
  contactId: IdSchema,
  name: z.string().trim().min(1).max(200),
  email: z.email(),
});

export const SignedAgreementScopeSectionSchema = z.strictObject({
  module: z.enum(["building", "timber_pest"]),
  heading: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
});

const SignedAgreementSnapshotFields = {
  agreementId: IdSchema,
  bookingId: IdSchema,
  organizationId: IdSchema,
  templateId: IdSchema,
  templateVersion: z.int().positive(),
  templateTitle: z.string().trim().min(1).max(300),
  introductoryText: z.string().trim().min(1).max(20_000),
  commissionedModules: CommissionedModulesSchema,
  scopeSections: z.array(SignedAgreementScopeSectionSchema).min(1).max(2),
  acknowledgementText: z.string().trim().min(1).max(4_000),
  acknowledgementAccepted: z.literal(true),
  signer: AgreementSignerSnapshotSchema,
  typedName: z.string().trim().min(1).max(200),
  signatureMethod: z.literal("typed_name_and_acknowledgement"),
  signedAt: TimestampSchema,
};

export const SignedAgreementSnapshotInputSchema = z.strictObject(
  SignedAgreementSnapshotFields,
);
export type SignedAgreementSnapshotInput = z.infer<
  typeof SignedAgreementSnapshotInputSchema
>;

export const SignedAgreementSnapshotSchema = z.strictObject({
  ...SignedAgreementSnapshotFields,
  canonicalHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type SignedAgreementSnapshot = z.infer<
  typeof SignedAgreementSnapshotSchema
>;
