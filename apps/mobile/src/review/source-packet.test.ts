import { describe, expect, it } from "vitest";

import { createSyntheticReviewFixture } from "./demo-review-items.js";
import {
  exactSourceIdentityEquality,
  sealSyntheticFixtureSourcePacket,
  verifyExactSourcePacket,
} from "./source-packet.js";

describe("exact source packet identity", () => {
  it("persists recomputable packets for every preloaded AI review", async () => {
    const fixture = await createSyntheticReviewFixture(digest);

    expect(fixture.sourcePackets).toHaveLength(2);
    await expect(
      Promise.all(
        fixture.sourcePackets.map((packet) =>
          verifyExactSourcePacket(packet, digest),
        ),
      ),
    ).resolves.toEqual([true, true]);
    expect(
      fixture.reviewItems.every((item) =>
        fixture.sourcePackets.some(
          (packet) =>
            packet.packetId === item.provenance.packetId &&
            packet.canonicalHash === item.provenance.packetHash,
        ),
      ),
    ).toBe(true);
  });

  it("rejects a packet whose protected source identity changes", async () => {
    const fixture = await createSyntheticReviewFixture(digest);
    const packet = fixture.sourcePackets[0]!;

    await expect(
      verifyExactSourcePacket(
        {
          ...packet,
          sources: packet.sources.map((source) => ({
            ...source,
            contentHash: "0".repeat(64),
          })),
        },
        digest,
      ),
    ).resolves.toBe(false);
  });

  it("refuses to seal duplicate packet source identities", async () => {
    const fixture = await createSyntheticReviewFixture(digest);
    const { canonicalHash, ...packet } = fixture.sourcePackets[0]!;
    expect(canonicalHash).toMatch(/^[a-f0-9]{64}$/u);
    const source = packet.sources[0]!;

    await expect(
      sealSyntheticFixtureSourcePacket(
        { ...packet, sources: [source, source] },
        digest,
      ),
    ).rejects.toThrow("unique artifact and content identities");
  });

  it("compares sorted artifact and content identities one-to-one", () => {
    const first = { artifactId: "artifact-a", contentHash: "a".repeat(64) };
    const second = { artifactId: "artifact-b", contentHash: "b".repeat(64) };

    expect(exactSourceIdentityEquality([second, first], [first, second])).toBe(
      true,
    );
    expect(
      exactSourceIdentityEquality(
        [first, second],
        [first, { ...second, contentHash: "c".repeat(64) }],
      ),
    ).toBe(false);
    expect(exactSourceIdentityEquality([first, first], [first, second])).toBe(
      false,
    );
  });
});

async function digest(payload: string): Promise<string> {
  const result = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
