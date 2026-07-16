import { z } from "zod";

import { IdSchema, Sha256Schema, TimestampSchema } from "./common.js";

export const OriginalArtifactReferenceSchema = z.strictObject({
  kind: z.literal("original"),
  artifactId: IdSchema,
  contentHash: Sha256Schema,
});

export const DerivativeArtifactReferenceSchema = z.strictObject({
  kind: z.literal("derivative"),
  artifactId: IdSchema,
  contentHash: Sha256Schema,
  parentArtifactId: IdSchema,
  transformation: z.enum([
    "annotation",
    "crop",
    "compression_proxy",
    "safe_proxy",
    "caption_render",
  ]),
});

export const ArtifactReferenceSchema = z.discriminatedUnion("kind", [
  OriginalArtifactReferenceSchema,
  DerivativeArtifactReferenceSchema,
]);
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

export const OriginalArtifactSchema = z.strictObject({
  kind: z.literal("original"),
  artifactId: IdSchema,
  captureId: IdSchema,
  organizationId: IdSchema,
  jobId: IdSchema,
  contentHash: Sha256Schema,
  mediaType: z.enum(["image/jpeg", "image/heic", "audio/m4a", "audio/wav"]),
  byteLength: z.int().positive(),
  capturedAt: TimestampSchema,
  captureAreaId: IdSchema,
  deviceId: IdSchema,
  sequence: z.int().positive(),
});
export type OriginalArtifact = z.infer<typeof OriginalArtifactSchema>;

export const DerivativeArtifactSchema = z.strictObject({
  kind: z.literal("derivative"),
  artifactId: IdSchema,
  organizationId: IdSchema,
  jobId: IdSchema,
  parentArtifactId: IdSchema,
  contentHash: Sha256Schema,
  mediaType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  byteLength: z.int().positive(),
  createdAt: TimestampSchema,
  transformation: z.enum([
    "annotation",
    "crop",
    "compression_proxy",
    "safe_proxy",
    "caption_render",
  ]),
  transformationVersion: z.string().trim().min(1).max(100),
});
export type DerivativeArtifact = z.infer<typeof DerivativeArtifactSchema>;

export const ArtifactSchema = z.discriminatedUnion("kind", [
  OriginalArtifactSchema,
  DerivativeArtifactSchema,
]);
export type Artifact = z.infer<typeof ArtifactSchema>;
