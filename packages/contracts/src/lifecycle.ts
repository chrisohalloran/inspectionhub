import { z } from "zod";

import { IdSchema, TimestampSchema } from "./common.js";

const LifecycleFields = {
  lifecycleId: IdSchema,
  organizationId: IdSchema,
  resourceType: z.enum([
    "artifact",
    "report_version",
    "module_snapshot",
    "recipient_grant",
    "contact",
  ]),
  resourceId: IdSchema,
  revision: z.int().nonnegative(),
};

export const ActiveLifecycleRecordSchema = z.strictObject({
  ...LifecycleFields,
  status: z.literal("active"),
  recordedAt: TimestampSchema,
});

export const TombstonedLifecycleRecordSchema = z.strictObject({
  ...LifecycleFields,
  status: z.literal("tombstoned"),
  tombstonedAt: TimestampSchema,
});

export const DeletionSuppressionSchema = z.strictObject({
  reason: z.enum([
    "retained_professional_reference",
    "professional_hold",
    "dispute_hold",
    "tenant_offboarding",
    "restore_reconciliation",
  ]),
  referenceIds: z.array(IdSchema).min(1),
  recordedAt: TimestampSchema,
});

export const DeletionSuppressedLifecycleRecordSchema = z.strictObject({
  ...LifecycleFields,
  status: z.literal("deletion_suppressed"),
  suppression: DeletionSuppressionSchema,
});

export const PurgeEligibleLifecycleRecordSchema = z.strictObject({
  ...LifecycleFields,
  status: z.literal("purge_eligible"),
  eligibleAt: TimestampSchema,
});

export const PurgedLifecycleRecordSchema = z.strictObject({
  ...LifecycleFields,
  status: z.literal("purged"),
  purgedAt: TimestampSchema,
  auditReferenceId: IdSchema,
});

export const LifecycleRecordSchema = z.discriminatedUnion("status", [
  ActiveLifecycleRecordSchema,
  TombstonedLifecycleRecordSchema,
  DeletionSuppressedLifecycleRecordSchema,
  PurgeEligibleLifecycleRecordSchema,
  PurgedLifecycleRecordSchema,
]);
export type LifecycleRecord = z.infer<typeof LifecycleRecordSchema>;
export type ActiveLifecycleRecord = z.infer<typeof ActiveLifecycleRecordSchema>;
