import { canonicalJson } from "../integrity/canonical-json";
import type { SeededSourcePacket } from "./seeded-vertical-slice";

export type SyntheticFixtureSourcePacket = Readonly<{
  schemaVersion: "synthetic-fixture-source-packet-v1";
  fixtureId:
    | "inspectionhub.synthetic.building-review.v1"
    | "inspectionhub.synthetic.timber-pest-review.v1";
  packetId: string;
  packetRevision: 1;
  canonicalHash: string;
  organizationId: string;
  jobId: string;
  investigationId: string;
  createdAt: string;
  model: "gpt-5.6-synthetic-build-week";
  promptVersion: "inspection-draft-v1";
  skillVersions: readonly ["report-language-v1"];
  sources: readonly Readonly<{
    artifactId: string;
    contentHash: string;
  }>[];
  assumptions: readonly string[];
}>;

export type ExactSourcePacket =
  SeededSourcePacket | SyntheticFixtureSourcePacket;

type Digest = (payload: string) => Promise<string>;

export type ArtifactContentIdentity = Readonly<{
  artifactId: string;
  contentHash: string;
}>;

export async function sealSyntheticFixtureSourcePacket(
  input: Omit<SyntheticFixtureSourcePacket, "canonicalHash">,
  digest: Digest,
): Promise<SyntheticFixtureSourcePacket> {
  if (!sourceIdentitiesAreUnique(input.sources)) {
    throw new Error(
      "Source packets require unique artifact and content identities",
    );
  }
  const canonicalHash = await digest(canonicalJson(input));
  if (!/^[a-f0-9]{64}$/u.test(canonicalHash)) {
    throw new Error(
      "Source packet digest must be a lowercase SHA-256 identity",
    );
  }
  return deepFreeze({ ...input, canonicalHash });
}

export async function verifyExactSourcePacket(
  packet: ExactSourcePacket,
  digest: Digest,
): Promise<boolean> {
  const { canonicalHash, ...withoutHash } = packet;
  const sources = sourceIdentitiesForPacket(packet);
  return (
    /^[a-f0-9]{64}$/u.test(canonicalHash) &&
    sourceIdentitiesAreUnique(sources) &&
    (await digest(canonicalJson(withoutHash))) === canonicalHash
  );
}

export function sourceIdentitiesForPacket(
  packet: ExactSourcePacket,
): readonly ArtifactContentIdentity[] {
  return packet.schemaVersion === "seeded-source-packet-v1"
    ? packet.evidence.map(({ artifactId, contentHash }) => ({
        artifactId,
        contentHash,
      }))
    : packet.sources;
}

export function sourceIdentitiesAreUnique(
  sources: readonly ArtifactContentIdentity[],
): boolean {
  const artifactIds = new Set<string>();
  const identities = new Set<string>();
  for (const source of sources) {
    if (
      source.artifactId.length === 0 ||
      !/^[a-f0-9]{64}$/u.test(source.contentHash)
    ) {
      return false;
    }
    const identity = sourceIdentity(source);
    if (artifactIds.has(source.artifactId) || identities.has(identity)) {
      return false;
    }
    artifactIds.add(source.artifactId);
    identities.add(identity);
  }
  return sources.length > 0;
}

export function exactSourceIdentityEquality(
  left: readonly ArtifactContentIdentity[],
  right: readonly ArtifactContentIdentity[],
): boolean {
  if (!sourceIdentitiesAreUnique(left) || !sourceIdentitiesAreUnique(right)) {
    return false;
  }
  const leftIdentities = left.map(sourceIdentity).sort();
  const rightIdentities = right.map(sourceIdentity).sort();
  return (
    leftIdentities.length === rightIdentities.length &&
    leftIdentities.every(
      (identity, index) => identity === rightIdentities[index],
    )
  );
}

function sourceIdentity(source: ArtifactContentIdentity): string {
  return JSON.stringify([source.artifactId, source.contentHash]);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
