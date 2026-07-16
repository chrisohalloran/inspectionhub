import { describe, expect, it } from "vitest";

import { curatedDemoMedia } from "./safe-demo-media.js";

describe("server-transformed curated report media", () => {
  it("serves only allowlisted transformed PNG bytes with a stable hash", () => {
    const media = curatedDemoMedia("media_bathroom_context");
    expect(media).not.toBeNull();
    expect(Buffer.from(media!.bytes).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(media!.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(media!.module).toBe("building");
  });

  it("never exposes private coverage or unknown artifact identities", () => {
    expect(curatedDemoMedia("coverage_private_001")).toBeNull();
    expect(curatedDemoMedia("media_unknown")).toBeNull();
  });
});
