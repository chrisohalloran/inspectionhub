import type {
  ModuleSnapshot,
  ModuleSnapshotInput,
  ModuleType,
} from "@inspection/contracts";
import {
  createModuleSnapshot,
  deepFreeze,
  verifyModuleSnapshotHash,
} from "@inspection/domain";

export type ModuleSnapshotKey = Readonly<{
  organizationId: string;
  jobId: string;
  module: ModuleType;
}>;

export class SnapshotConflictError extends Error {
  readonly code = "snapshot_revision_conflict";

  constructor(message: string) {
    super(message);
    this.name = "SnapshotConflictError";
  }
}

export interface SnapshotReader {
  getCurrent(key: ModuleSnapshotKey): ModuleSnapshot | undefined;
  getById(snapshotId: string): ModuleSnapshot | undefined;
}

/**
 * An immutable snapshot repository with one compare-and-set current pointer per
 * professional module. Report rendering is deliberately outside this class.
 */
export class InMemoryModuleSnapshotStore implements SnapshotReader {
  readonly #byId = new Map<string, ModuleSnapshot>();
  readonly #currentIds = new Map<string, string>();
  readonly #history = new Map<string, readonly string[]>();

  create(
    input: ModuleSnapshotInput,
    expectedCurrentRevision: number,
  ): ModuleSnapshot {
    const key = snapshotKey(input);
    const current = this.getCurrent(input);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectedCurrentRevision) {
      throw new SnapshotConflictError(
        `Expected ${expectedCurrentRevision}, current snapshot revision is ${currentRevision}`,
      );
    }
    if (input.revision !== expectedCurrentRevision + 1) {
      throw new SnapshotConflictError(
        "A new snapshot revision must advance the current module revision exactly once",
      );
    }
    if (this.#byId.has(input.snapshotId)) {
      throw new SnapshotConflictError("Snapshot identity already exists");
    }

    const created: ModuleSnapshot =
      input.module === "building"
        ? createModuleSnapshot(input)
        : createModuleSnapshot(input);
    if (!verifyModuleSnapshotHash(created)) {
      throw new Error(
        "Created module snapshot failed its canonical hash check",
      );
    }
    this.#byId.set(created.snapshotId, created);
    this.#currentIds.set(key, created.snapshotId);
    this.#history.set(
      key,
      deepFreeze([...(this.#history.get(key) ?? []), created.snapshotId]),
    );
    return created;
  }

  getCurrent(key: ModuleSnapshotKey): ModuleSnapshot | undefined {
    const snapshotId = this.#currentIds.get(snapshotKey(key));
    return snapshotId === undefined ? undefined : this.#byId.get(snapshotId);
  }

  getById(snapshotId: string): ModuleSnapshot | undefined {
    return this.#byId.get(snapshotId);
  }

  history(key: ModuleSnapshotKey): readonly ModuleSnapshot[] {
    return deepFreeze(
      (this.#history.get(snapshotKey(key)) ?? []).map((snapshotId) => {
        const snapshot = this.#byId.get(snapshotId);
        if (snapshot === undefined) {
          throw new Error(
            "Snapshot history references a missing immutable record",
          );
        }
        return snapshot;
      }),
    );
  }
}

function snapshotKey(key: ModuleSnapshotKey): string {
  return `${key.organizationId}:${key.jobId}:${key.module}`;
}
