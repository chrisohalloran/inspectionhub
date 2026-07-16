import {
  BuildingModuleSnapshotInputSchema,
  BuildingModuleSnapshotSchema,
  ModuleSnapshotInputSchema,
  ModuleSnapshotSchema,
  TimberPestModuleSnapshotInputSchema,
  TimberPestModuleSnapshotSchema,
  type BuildingModuleSnapshot,
  type BuildingModuleSnapshotInput,
  type ModuleSnapshot,
  type ModuleSnapshotInput,
  type TimberPestModuleSnapshot,
  type TimberPestModuleSnapshotInput,
} from "@inspection/contracts";

import { deepFreeze, sha256 } from "./canonical.js";

export function createModuleSnapshot(
  input: BuildingModuleSnapshotInput,
): BuildingModuleSnapshot;
export function createModuleSnapshot(
  input: TimberPestModuleSnapshotInput,
): TimberPestModuleSnapshot;
export function createModuleSnapshot(
  input: ModuleSnapshotInput,
): ModuleSnapshot {
  const parsed = ModuleSnapshotInputSchema.parse(input);
  const canonicalHash = sha256(parsed);
  const snapshot = ModuleSnapshotSchema.parse({ ...parsed, canonicalHash });
  return deepFreeze(snapshot);
}

export function verifyModuleSnapshotHash(snapshot: ModuleSnapshot): boolean {
  const parsed = ModuleSnapshotSchema.parse(snapshot);
  const { canonicalHash, ...input } = parsed;
  const validInput =
    input.module === "building"
      ? BuildingModuleSnapshotInputSchema.parse(input)
      : TimberPestModuleSnapshotInputSchema.parse(input);
  return sha256(validInput) === canonicalHash;
}

export function parseBuildingSnapshot(
  snapshot: unknown,
): BuildingModuleSnapshot {
  return deepFreeze(BuildingModuleSnapshotSchema.parse(snapshot));
}

export function parseTimberPestSnapshot(
  snapshot: unknown,
): TimberPestModuleSnapshot {
  return deepFreeze(TimberPestModuleSnapshotSchema.parse(snapshot));
}
