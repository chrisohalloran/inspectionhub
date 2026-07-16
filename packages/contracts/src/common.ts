import { z } from "zod";

export const IdSchema = z.uuid();
export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "Expected a lowercase SHA-256 digest");
export const TimestampSchema = z.iso.datetime({ offset: true });
export const NonEmptyTextSchema = z.string().trim().min(1).max(4_000);
export const RevisionSchema = z.int().nonnegative();

export const ModuleTypeSchema = z.enum(["building", "timber_pest"]);
export type ModuleType = z.infer<typeof ModuleTypeSchema>;

export const CommissionedModulesSchema = z.union([
  z.tuple([z.literal("building")]),
  z.tuple([z.literal("timber_pest")]),
  z.tuple([z.literal("building"), z.literal("timber_pest")]),
]);
export type CommissionedModules = z.infer<typeof CommissionedModulesSchema>;

const IdentifiedActorSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("inspector"), id: IdSchema }),
  z.strictObject({ type: z.literal("administrator"), id: IdSchema }),
  z.strictObject({ type: z.literal("client"), id: IdSchema }),
  z.strictObject({ type: z.literal("recipient"), id: IdSchema }),
  z.strictObject({ type: z.literal("access_contact"), id: IdSchema }),
  z.strictObject({ type: z.literal("provider"), id: IdSchema }),
]);

export const ActorSchema = z.union([
  IdentifiedActorSchema,
  z.strictObject({ type: z.literal("system"), id: z.null() }),
]);
export type Actor = z.infer<typeof ActorSchema>;

export const InspectorAttributionSchema = z.strictObject({
  inspectorId: IdSchema,
  displayName: z.string().trim().min(1).max(200),
  credentialVersion: z.string().trim().min(1).max(200),
  confirmedAt: TimestampSchema,
});
export type InspectorAttribution = z.infer<typeof InspectorAttributionSchema>;
