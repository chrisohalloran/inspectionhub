import { deepFreeze, sha256 } from "@inspection/domain";

import type { DurabilityManifest, DurabilityManifestEntry } from "./types.js";

export function createDurabilityManifest(
  input: Readonly<{
    manifestId: string;
    organizationId: string;
    jobId: string;
    revision: number;
    entries: readonly DurabilityManifestEntry[];
  }>,
): DurabilityManifest {
  if (input.revision < 1 || !Number.isSafeInteger(input.revision)) {
    throw new Error("Durability manifest revision must be a positive integer");
  }
  const entries = [...input.entries].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId),
  );
  const identities = entries.map(({ artifactId }) => artifactId);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Durability manifest artifact identities must be unique");
  }
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/u.test(entry.contentHash)) {
      throw new Error("Durability entry has an invalid content hash");
    }
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1) {
      throw new Error("Durability entry byte length must be positive");
    }
    if (entry.status === "verified" && entry.verifiedAt === null) {
      throw new Error("Verified durability requires a verification time");
    }
    if (entry.status !== "verified" && entry.verifiedAt !== null) {
      throw new Error("Unverified durability cannot carry a verification time");
    }
  }
  const canonicalHash = sha256({ ...input, entries });
  return deepFreeze({ ...input, entries, canonicalHash });
}

export function isManifestSendable(manifest: DurabilityManifest): boolean {
  return manifest.entries.every(
    (entry) => !entry.requiredOriginal || entry.status === "verified",
  );
}

export function verifyDurabilityManifest(
  manifest: DurabilityManifest,
): boolean {
  const { canonicalHash, ...input } = manifest;
  return sha256(input) === canonicalHash;
}

export function manifestCoversEvidence(
  manifest: DurabilityManifest,
  evidenceHashes: readonly string[],
): boolean {
  const verifiedHashes = new Set(
    manifest.entries
      .filter(
        ({ requiredOriginal, status }) =>
          requiredOriginal && status === "verified",
      )
      .map(({ contentHash }) => contentHash),
  );
  return evidenceHashes.every((hash) => verifiedHashes.has(hash));
}
