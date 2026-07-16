import { z } from "zod";

import {
  ActorSchema,
  IdSchema,
  NonEmptyTextSchema,
  RevisionSchema,
  Sha256Schema,
  TimestampSchema,
} from "./common.js";

const CommandFields = {
  schemaVersion: z.literal(1),
  commandId: IdSchema,
  organizationId: IdSchema,
  aggregateId: IdSchema,
  actor: ActorSchema,
  expectedRevision: RevisionSchema,
  idempotencyKey: z.string().trim().min(1).max(300),
  occurredAt: TimestampSchema,
};

export const CreateModuleSnapshotCommandSchema = z.strictObject({
  ...CommandFields,
  type: z.literal("module.snapshot.create.v1"),
  payload: z.strictObject({
    snapshotId: IdSchema,
    module: z.enum(["building", "timber_pest"]),
  }),
});

export const ApproveModuleCommandSchema = z.strictObject({
  ...CommandFields,
  type: z.literal("module.approve.v1"),
  payload: z.strictObject({ snapshotId: IdSchema, snapshotHash: Sha256Schema }),
});

export const WithdrawModuleCommandSchema = z.strictObject({
  ...CommandFields,
  type: z.literal("module.withdraw.v1"),
  payload: z.strictObject({ snapshotId: IdSchema, reason: NonEmptyTextSchema }),
});

export const MarkEvidenceAtRiskCommandSchema = z.strictObject({
  ...CommandFields,
  type: z.literal("module.evidence_at_risk.v1"),
  payload: z.strictObject({
    artifactIds: z.array(IdSchema).min(1),
    reason: z.literal("device_lost_before_server_durability"),
  }),
});

export const AmendReportCommandSchema = z.strictObject({
  ...CommandFields,
  type: z.literal("report.amend.v1"),
  payload: z.strictObject({
    priorSnapshotId: IdSchema,
    replacementSnapshotId: IdSchema,
    reason: NonEmptyTextSchema,
  }),
});

export const ConfirmDeliveryPackageCommandSchema = z.strictObject({
  ...CommandFields,
  type: z.literal("delivery.package.confirm.v1"),
  payload: z.strictObject({ packageId: IdSchema }),
});

export const RevokeRecipientGrantCommandSchema = z.strictObject({
  ...CommandFields,
  type: z.literal("recipient.grant.revoke.v1"),
  payload: z.strictObject({ grantId: IdSchema, reason: NonEmptyTextSchema }),
});

export const SuppressLifecycleCommandSchema = z.strictObject({
  ...CommandFields,
  type: z.literal("lifecycle.suppress.v1"),
  payload: z.strictObject({
    resourceId: IdSchema,
    reason: z.enum([
      "retained_professional_reference",
      "professional_hold",
      "dispute_hold",
      "tenant_offboarding",
      "restore_reconciliation",
    ]),
    referenceIds: z.array(IdSchema).min(1),
  }),
});

export const CommandEnvelopeSchema = z.discriminatedUnion("type", [
  CreateModuleSnapshotCommandSchema,
  ApproveModuleCommandSchema,
  WithdrawModuleCommandSchema,
  MarkEvidenceAtRiskCommandSchema,
  AmendReportCommandSchema,
  ConfirmDeliveryPackageCommandSchema,
  RevokeRecipientGrantCommandSchema,
  SuppressLifecycleCommandSchema,
]);
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
