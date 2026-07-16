import { ArtifactSchema, type Artifact } from "@inspection/contracts";

import { deepFreeze } from "./canonical.js";

export function createImmutableArtifact(input: unknown): Artifact {
  return deepFreeze(ArtifactSchema.parse(input));
}
