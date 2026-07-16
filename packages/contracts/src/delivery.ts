import { z } from "zod";

import {
  CommissionedModulesSchema,
  IdSchema,
  ModuleTypeSchema,
  NonEmptyTextSchema,
  Sha256Schema,
  TimestampSchema,
} from "./common.js";

export const PackageModuleSnapshotReferenceSchema = z.strictObject({
  module: ModuleTypeSchema,
  moduleId: IdSchema,
  snapshotId: IdSchema,
  snapshotHash: Sha256Schema,
  approvalId: IdSchema,
});
export type PackageModuleSnapshotReference = z.infer<
  typeof PackageModuleSnapshotReferenceSchema
>;

const DeliveryPackageFields = {
  packageId: IdSchema,
  organizationId: IdSchema,
  jobId: IdSchema,
  commissionedModules: CommissionedModulesSchema,
  revision: z.int().nonnegative(),
};

export const PendingDeliveryPackageSchema = z.strictObject({
  ...DeliveryPackageFields,
  status: z.literal("pending"),
  moduleSnapshots: z.array(PackageModuleSnapshotReferenceSchema).max(0),
  blockers: z.array(
    z.enum([
      "building_not_approved",
      "timber_pest_not_approved",
      "evidence_not_durable",
    ]),
  ),
});

export const ConfirmedDeliveryPackageSchema = z
  .strictObject({
    ...DeliveryPackageFields,
    status: z.literal("confirmed"),
    moduleSnapshots: z
      .array(PackageModuleSnapshotReferenceSchema)
      .min(1)
      .max(2),
    confirmedAt: TimestampSchema,
  })
  .superRefine((value, context) => {
    const actualModules = value.moduleSnapshots.map(({ module }) => module);
    if (
      JSON.stringify(actualModules) !==
      JSON.stringify(value.commissionedModules)
    ) {
      context.addIssue({
        code: "custom",
        path: ["moduleSnapshots"],
        message:
          "Delivery package must bind the exact commissioned module set in canonical order",
      });
    }
  });

export const CancelledDeliveryPackageSchema = z.strictObject({
  ...DeliveryPackageFields,
  status: z.literal("cancelled"),
  moduleSnapshots: z.array(PackageModuleSnapshotReferenceSchema).max(2),
  cancelledAt: TimestampSchema,
  cancellationReason: z.enum([
    "module_withdrawn",
    "module_amended",
    "grant_revoked",
    "stale_snapshot",
  ]),
});

export const SuppressedDeliveryPackageSchema = z.strictObject({
  ...DeliveryPackageFields,
  status: z.literal("suppressed"),
  moduleSnapshots: z.array(PackageModuleSnapshotReferenceSchema).max(2),
  suppressedAt: TimestampSchema,
  suppressionReason: z.enum([
    "restore_reconciliation",
    "professional_hold",
    "dispute_hold",
  ]),
});

export const DeliveryPackageSchema = z.discriminatedUnion("status", [
  PendingDeliveryPackageSchema,
  ConfirmedDeliveryPackageSchema,
  CancelledDeliveryPackageSchema,
  SuppressedDeliveryPackageSchema,
]);
export type DeliveryPackage = z.infer<typeof DeliveryPackageSchema>;

export const RecipientGrantActionSchema = z.enum([
  "read_report",
  "download_pdf",
  "view_curated_media",
  "invite_recipient",
]);

const RecipientGrantFields = {
  grantId: IdSchema,
  organizationId: IdSchema,
  jobId: IdSchema,
  principalId: IdSchema,
  reportVersionId: IdSchema,
  permittedModules: CommissionedModulesSchema,
  permittedActions: z.array(RecipientGrantActionSchema).min(1),
  issuedBy: IdSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  revision: z.int().nonnegative(),
};

export const ActiveRecipientGrantSchema = z.strictObject({
  ...RecipientGrantFields,
  status: z.literal("active"),
});
export const RevokedRecipientGrantSchema = z.strictObject({
  ...RecipientGrantFields,
  status: z.literal("revoked"),
  revokedBy: IdSchema,
  revokedAt: TimestampSchema,
  revocationReason: NonEmptyTextSchema,
});
export const RecipientGrantSchema = z.discriminatedUnion("status", [
  ActiveRecipientGrantSchema,
  RevokedRecipientGrantSchema,
]);
export type RecipientGrant = z.infer<typeof RecipientGrantSchema>;
