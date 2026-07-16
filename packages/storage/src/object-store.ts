import { randomUUID } from "node:crypto";

import type { ImmutableObjectStore, StoredObjectMetadata } from "./types.js";

interface StoredObject {
  readonly metadata: StoredObjectMetadata;
  readonly bytes: Uint8Array;
}

export class InMemoryPrivateObjectStore implements ImmutableObjectStore {
  readonly #objects = new Map<string, StoredObject>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async putImmutable(
    key: string,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<StoredObjectMetadata> {
    await Promise.resolve();
    if (this.#objects.has(key)) {
      throw new Error("Immutable object key already exists");
    }
    const metadata = Object.freeze({
      key,
      version: randomUUID(),
      byteLength: bytes.byteLength,
      mediaType,
      createdAt: this.#now().toISOString(),
    });
    this.#objects.set(key, {
      metadata,
      bytes: Uint8Array.from(bytes),
    });
    return metadata;
  }

  async head(key: string): Promise<StoredObjectMetadata | undefined> {
    await Promise.resolve();
    return this.#objects.get(key)?.metadata;
  }

  async read(key: string): Promise<Uint8Array | undefined> {
    await Promise.resolve();
    const bytes = this.#objects.get(key)?.bytes;
    return bytes === undefined ? undefined : Uint8Array.from(bytes);
  }

  async list(prefix: string): Promise<readonly StoredObjectMetadata[]> {
    await Promise.resolve();
    return [...this.#objects.values()]
      .map(({ metadata }) => metadata)
      .filter(({ key }) => key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  /** Test-only corruption hook used to prove independent read verification. */
  corruptForTest(key: string, bytes: Uint8Array): void {
    const object = this.#objects.get(key);
    if (object === undefined) throw new Error("Object does not exist");
    this.#objects.set(key, {
      metadata: { ...object.metadata, byteLength: bytes.byteLength },
      bytes: Uint8Array.from(bytes),
    });
  }

  /** Test-only removal hook used by reconciliation tests. */
  removeForTest(key: string): void {
    this.#objects.delete(key);
  }
}
