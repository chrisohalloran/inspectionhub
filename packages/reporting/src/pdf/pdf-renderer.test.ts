import { describe, expect, it } from "vitest";

import { createSyntheticRecipientReport } from "../render/synthetic-report.js";
import { generateModulePdf, normalisePdfText } from "./pdf-renderer.js";

describe("formal PDF renderer", () => {
  it("creates separate immutable Building and Timber Pest PDF byte streams", () => {
    const snapshot = createSyntheticRecipientReport();
    const building = generateModulePdf(snapshot, "building");
    const timberPest = generateModulePdf(snapshot, "timber_pest");
    expect(Buffer.from(building.bytes).subarray(0, 8).toString("ascii")).toBe(
      "%PDF-1.7",
    );
    expect(building.mediaType).toBe("application/pdf");
    expect(building.pageCount).toBeGreaterThan(0);
    expect(building.fileName).toMatch(/building-report-v2\.pdf$/u);
    expect(timberPest.fileName).toMatch(/timber-pest-report-v2\.pdf$/u);
    expect(building.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(building.contentHash).not.toBe(timberPest.contentHash);
  });

  it("marks the document language, marked-content intent, version, headers and page numbers", () => {
    const artifact = generateModulePdf(
      createSyntheticRecipientReport(),
      "building",
    );
    const source = Buffer.from(artifact.bytes).toString("latin1");
    expect(source).toContain("/Lang (en-AU)");
    expect(source).toContain("/Marked true");
    expect(source).toContain("/StructTreeRoot");
    expect(source).toContain("Page 1 of");
    expect(source).toContain("Report version 2");
  });

  it("normalises non-ASCII dash and quote glyphs before PDF layout", () => {
    expect(normalisePdfText("one\u2011two \u201cobserved\u201d\u2026")).toBe(
      'one-two "observed"...',
    );
  });
});
