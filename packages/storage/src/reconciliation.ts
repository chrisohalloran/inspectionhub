import { sha256 } from "./hash.js";
import type { InMemorySyncRepository } from "./repository.js";
import type { ImmutableObjectStore, ReconciliationFinding } from "./types.js";

export async function reconcileEvidence(options: {
  organizationId: string;
  store: ImmutableObjectStore;
  repository: InMemorySyncRepository;
}): Promise<readonly ReconciliationFinding[]> {
  const prefix = `quarantine/${options.organizationId}/`;
  const objects = await options.store.list(prefix);
  const objectKeys = new Set(objects.map(({ key }) => key));
  const findings: ReconciliationFinding[] = [];

  for (const object of objects) {
    const artifact = options.repository.artifactByStorageKey(object.key);
    if (artifact === undefined) {
      findings.push({
        state: options.repository.deletionSuppressions().has(object.key)
          ? "deletion_suppression"
          : "object_only",
        organizationId: options.organizationId,
        key: object.key,
        detail: "Object exists without a committed artifact row.",
      });
      continue;
    }
    if (!options.repository.hasDurabilityReceipt(artifact.artifactId)) {
      findings.push({
        state: "row_only",
        organizationId: options.organizationId,
        key: object.key,
        artifactId: artifact.artifactId,
        detail: "Artifact row exists without its atomic durability receipt.",
      });
      continue;
    }
    const bytes = await options.store.read(object.key);
    if (bytes === undefined || sha256(bytes) !== artifact.sha256) {
      findings.push({
        state: "divergent_checksum",
        organizationId: options.organizationId,
        key: object.key,
        artifactId: artifact.artifactId,
        detail: "Current object bytes diverge from the immutable receipt.",
      });
      continue;
    }
    const assessment = options.repository.assessment(artifact.artifactId);
    if (assessment?.state !== "accepted") {
      findings.push({
        state: "content_quarantine",
        organizationId: options.organizationId,
        key: object.key,
        artifactId: artifact.artifactId,
        detail: "Original is durable but has no accepted safe proxy.",
      });
      continue;
    }
    const proxy =
      assessment.safeProxyArtifactId === undefined
        ? undefined
        : options.repository.proxy(assessment.safeProxyArtifactId);
    if (
      proxy === undefined ||
      proxy.organizationId !== artifact.organizationId ||
      proxy.parentArtifactId !== artifact.artifactId ||
      proxy.parentSha256 !== artifact.sha256
    ) {
      findings.push({
        state: "content_quarantine",
        organizationId: options.organizationId,
        key: artifact.storageKey,
        artifactId: artifact.artifactId,
        detail: "Accepted assessment has no matching safe-proxy provenance.",
      });
      continue;
    }
    const proxyMetadata = await options.store.head(proxy.storageKey);
    const proxyBytes = await options.store.read(proxy.storageKey);
    if (proxyMetadata === undefined || proxyBytes === undefined) {
      findings.push({
        state: "missing_object",
        organizationId: options.organizationId,
        key: proxy.storageKey,
        artifactId: proxy.artifactId,
        detail: "Trusted proxy row exists but its immutable object is missing.",
      });
      continue;
    }
    if (
      proxyMetadata.version !== proxy.objectVersion ||
      proxyMetadata.byteLength !== proxyBytes.byteLength ||
      proxy.byteLength !== proxyBytes.byteLength ||
      proxyMetadata.mediaType !== proxy.mediaType ||
      sha256(proxyBytes) !== proxy.sha256
    ) {
      findings.push({
        state: "divergent_checksum",
        organizationId: options.organizationId,
        key: proxy.storageKey,
        artifactId: proxy.artifactId,
        detail: "Trusted proxy object diverges from its immutable provenance.",
      });
      continue;
    }
    findings.push({
      state: "consistent",
      organizationId: options.organizationId,
      key: object.key,
      artifactId: artifact.artifactId,
      detail: "Object, receipt, assessment and safe proxy agree.",
    });
  }

  for (const artifact of options.repository.artifacts()) {
    if (
      artifact.organizationId === options.organizationId &&
      !objectKeys.has(artifact.storageKey)
    ) {
      findings.push({
        state: "missing_object",
        organizationId: options.organizationId,
        key: artifact.storageKey,
        artifactId: artifact.artifactId,
        detail: "Durability row exists but the object cannot be listed.",
      });
    }
  }
  for (const key of options.repository.duplicateKeys()) {
    if (key.startsWith(prefix)) {
      findings.push({
        state: "duplicate_attempt",
        organizationId: options.organizationId,
        key,
        detail:
          "A repeated capture finalisation resolved to the existing identity.",
      });
    }
  }
  for (const key of options.repository.unknownProviderKeys()) {
    findings.push({
      state: "unknown_provider",
      organizationId: options.organizationId,
      key,
      detail: "Provider outcome requires observation before retry.",
    });
  }
  const safeObjects = await options.store.list(
    `safe/${options.organizationId}/`,
  );
  for (const object of safeObjects) {
    if (options.repository.proxyByStorageKey(object.key) === undefined) {
      findings.push({
        state: options.repository.deletionSuppressions().has(object.key)
          ? "deletion_suppression"
          : "object_only",
        organizationId: options.organizationId,
        key: object.key,
        detail:
          "Safe-namespace object has no fenced proxy provenance and remains untrusted.",
      });
    }
  }
  return findings.sort((left, right) =>
    `${left.key}:${left.state}`.localeCompare(`${right.key}:${right.state}`),
  );
}
