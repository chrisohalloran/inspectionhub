import { z } from "zod";

import { ArtifactReferenceSchema } from "./artifacts.js";
import {
  ActorSchema,
  IdSchema,
  Sha256Schema,
  TimestampSchema,
} from "./common.js";

const eventFamilies = [
  "booking",
  "agreement",
  "payment",
  "access",
  "inspection",
  "area",
  "artifact",
  "investigation",
  "transcription",
  "agent",
  "tool",
  "verifier",
  "finding",
  "approval",
  "report",
  "delivery",
  "recipient_access",
  "amendment",
  "system",
] as const;

export const EventTypeSchema = z
  .string()
  .regex(/^[a-z_]+\.[a-z0-9_]+$/u)
  .refine(
    (value) => eventFamilies.some((family) => value.startsWith(`${family}.`)),
    {
      message: "Event type must belong to an approved event family",
    },
  );

export const SafeMetadataSchema = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/u),
  z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]),
);

export const EventDraftV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: IdSchema,
  eventType: EventTypeSchema,
  organizationId: IdSchema,
  aggregate: z.strictObject({
    type: z.string().trim().min(1).max(100),
    id: IdSchema,
  }),
  aggregateVersion: z.int().positive(),
  sessionId: IdSchema,
  actor: ActorSchema,
  clientOccurredAt: TimestampSchema.nullable(),
  serverRecordedAt: TimestampSchema,
  idempotencyKey: z.string().trim().min(1).max(300),
  safeMetadata: SafeMetadataSchema,
  protectedArtifactReferences: z.array(ArtifactReferenceSchema),
  correlationId: IdSchema,
  causationId: IdSchema.nullable(),
});
export type EventDraftV1 = z.infer<typeof EventDraftV1Schema>;

export const EventEnvelopeV1Schema = z.strictObject({
  ...EventDraftV1Schema.shape,
  payloadHash: Sha256Schema,
  previousEventHash: Sha256Schema.nullable(),
  eventHash: Sha256Schema,
});
export type EventEnvelopeV1 = z.infer<typeof EventEnvelopeV1Schema>;
