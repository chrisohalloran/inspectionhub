import { describe, expect, it, vi } from "vitest";

import { generateModulePdf } from "../pdf/pdf-renderer.js";
import {
  InMemoryReportPublicationStore,
  ReportPublicationConflictError,
} from "./report-publication-store.js";
import {
  createReportSnapshot,
  ReportSnapshotValidationError,
} from "./report-types.js";
import {
  buildConditionOverview,
  renderReportToSemanticHtml,
  reportSemanticFacts,
} from "./semantic-report.js";
import { createSyntheticRecipientReport } from "./synthetic-report.js";

function reportInput(
  snapshot: ReturnType<typeof createSyntheticRecipientReport>,
): Parameters<typeof createReportSnapshot>[0] {
  const copy: Record<string, unknown> = { ...snapshot };
  Reflect.deleteProperty(copy, "canonicalHash");
  return copy as Parameters<typeof createReportSnapshot>[0];
}

describe("recipient report rendering", () => {
  it("opens with named major findings, a minor summary, Timber Pest conclusion and material limitations", () => {
    const snapshot = createSyntheticRecipientReport();
    const overview = buildConditionOverview(snapshot);
    expect(overview.majorBuildingSummary).toBe(
      "1 major Building defect identified.",
    );
    expect(overview.majorBuildingFindings).toEqual([
      {
        findingId: "finding_cracked_tiles",
        title: "Cracked shower and bathroom floor tiles",
        location: "Second-floor main bathroom",
      },
    ]);
    expect(overview.minorBuildingSummary).toContain("Several minor defects");
    expect(overview.timberPestSummary).toContain(
      "accessible areas at the time of inspection",
    );
    expect(overview.materialLimitations.map(({ module }) => module)).toEqual([
      "building",
      "timber_pest",
    ]);
  });

  it("keeps Building and Timber Pest semantics distinct and places major findings first", () => {
    const snapshot = createSyntheticRecipientReport();
    const html = renderReportToSemanticHtml(snapshot);
    expect(html).toContain('<section id="building"');
    expect(html).toContain('<section id="timber-pest"');
    expect(
      html.indexOf("Cracked shower and bathroom floor tiles"),
    ).toBeLessThan(html.indexOf("Loose door stop"));
    expect(html).toContain("Classification:</strong> Major defect");
    expect(html).toContain("Category:</strong> Conducive condition");
    expect(html).not.toMatch(/score|traffic light|buy signal/iu);
    expect(html).not.toMatch(/AI (?:suggestion|confidence|analysis)/u);
    expect(html).not.toContain("coverage_private");
  });

  it("context-encodes stored HTML payloads in every recipient-facing field", () => {
    const base = createSyntheticRecipientReport();
    const input = {
      ...reportInput(base),
      building: {
        ...base.building!,
        conclusion:
          '<img src=x onerror="globalThis.compromised=true"> Condition observed.',
      },
    };
    const snapshot = createReportSnapshot(input);
    const html = renderReportToSemanticHtml(snapshot);
    expect(html).toContain(
      "&lt;img src=x onerror=&quot;globalThis.compromised=true&quot;&gt;",
    );
    expect(html).not.toContain('<img src=x onerror="globalThis');
  });

  it("rejects guarantee, transaction, cost, valuation and client-visible AI language", () => {
    const base = createSyntheticRecipientReport();
    for (const prohibited of [
      "The property passed.",
      "This area is termite-free.",
      "You should not buy.",
      "Repair cost is likely low.",
      "A valuation should be obtained.",
      "AI confidence was high.",
    ]) {
      const input = reportInput(base);
      expect(() =>
        createReportSnapshot({
          ...input,
          building: {
            ...input.building!,
            conclusion: prohibited,
          },
        }),
      ).toThrow(ReportSnapshotValidationError);
    }
  });

  it("rejects unbounded no-visible-pest language and media outside the finding allowlist", () => {
    const base = createSyntheticRecipientReport();
    const input = reportInput(base);
    const timberPest = input.timberPest!;
    const noVisible = timberPest.findings[0]!;
    expect(() =>
      createReportSnapshot({
        ...input,
        timberPest: {
          ...timberPest,
          conclusion: "No visible evidence was observed.",
          findings: [
            {
              ...noVisible,
              observation: "No visible evidence was observed.",
              qualifiedOpinion: "No visible evidence was observed.",
            },
          ],
        },
      }),
    ).toThrow(/bounded to accessible areas/iu);

    const building = input.building!;
    const finding = building.findings[0]!;
    expect(() =>
      createReportSnapshot({
        ...input,
        building: {
          ...building,
          findings: [
            {
              ...finding,
              curatedMedia: [
                {
                  ...finding.curatedMedia[0]!,
                  findingId: "finding_private_coverage",
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/scoped to its report finding/iu);
  });

  it("produces a no-major-defect overview that remains bounded", () => {
    const base = createSyntheticRecipientReport();
    const input = reportInput(base);
    const building = input.building!;
    const snapshot = createReportSnapshot({
      ...input,
      building: {
        ...building,
        findings: building.findings.filter(
          ({ classification }) => classification !== "major_defect",
        ),
      },
    });
    expect(buildConditionOverview(snapshot).majorBuildingSummary).toContain(
      "accessible areas at the inspection time",
    );
  });

  it("publishes current only after every commissioned PDF renders and preserves immutable amendment history", () => {
    const current = createSyntheticRecipientReport();
    const versionTwoInput = reportInput(current);
    const versionOneInput = {
      ...versionTwoInput,
      reportVersionId: "report_demo_v1",
      versionNumber: 1,
      amendment: null,
    } as const;
    const store = new InMemoryReportPublicationStore();
    const versionOne = store.publish(versionOneInput, generateModulePdf);
    expect(store.current(current.organizationId, current.jobId)?.snapshot).toBe(
      versionOne.snapshot,
    );

    const brokenRenderer = vi.fn(
      (snapshot: typeof current, module: "building" | "timber_pest") => {
        if (module === "timber_pest") {
          throw new Error("sandboxed PDF renderer failed");
        }
        return generateModulePdf(snapshot, module);
      },
    );
    expect(() => store.publish(versionTwoInput, brokenRenderer)).toThrow(
      "sandboxed PDF renderer failed",
    );
    expect(store.current(current.organizationId, current.jobId)?.snapshot).toBe(
      versionOne.snapshot,
    );

    const versionTwo = store.publish(versionTwoInput, generateModulePdf);
    expect(store.current(current.organizationId, current.jobId)?.snapshot).toBe(
      versionTwo.snapshot,
    );
    expect(
      store
        .history(current.organizationId, current.jobId)
        .map(({ snapshot }) => snapshot.reportVersionId),
    ).toEqual(["report_demo_v1", "report_demo_v2"]);
    expect(versionOne.snapshot.canonicalHash).not.toBe(
      versionTwo.snapshot.canonicalHash,
    );
  });

  it("requires a later version to name the exact current version it amends", () => {
    const snapshot = createSyntheticRecipientReport();
    const input = reportInput(snapshot);
    const store = new InMemoryReportPublicationStore();
    expect(() => store.publish(input, generateModulePdf)).toThrow(
      ReportPublicationConflictError,
    );
  });

  it("records withdrawal as an immutable notice without rewriting the issued report", () => {
    const base = createSyntheticRecipientReport();
    const current = reportInput(base);
    const input = {
      ...current,
      reportVersionId: "report_demo_v1",
      versionNumber: 1,
      amendment: null,
    } as const;
    const store = new InMemoryReportPublicationStore();
    const published = store.publish(input, generateModulePdf);
    const originalHash = published.snapshot.canonicalHash;
    store.withdraw({
      withdrawalId: "withdrawal_building_1",
      reportVersionId: published.snapshot.reportVersionId,
      module: "building",
      withdrawnAt: "2026-07-15T05:00:00.000Z",
      withdrawnBy: "Alex Inspector",
      reason: "Further professional review required",
      replacementReportVersionId: null,
    });
    expect(
      store.withdrawal(published.snapshot.reportVersionId, "building"),
    ).toMatchObject({ replacementReportVersionId: null });
    expect(
      store.byId(published.snapshot.reportVersionId)?.snapshot.canonicalHash,
    ).toBe(originalHash);
  });

  it("uses one semantic fact set for HTML and both formal PDF records", () => {
    const snapshot = createSyntheticRecipientReport();
    const html = renderReportToSemanticHtml(snapshot);
    const htmlText = html
      .replaceAll(/<[^>]+>/gu, "")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#039;", "'");
    for (const module of ["building", "timber_pest"] as const) {
      const artifact = generateModulePdf(snapshot, module);
      const facts = reportSemanticFacts(snapshot, module);
      expect(artifact.requiredText).toEqual(facts);
      for (const fact of facts) {
        const value = fact.replace(
          /^(?:Classification|Category|Location|Observation|Apparent extent|Significance|Qualified opinion|Further investigation|Uncertainty|Evidence|Caption|Limitation|Effect on conclusion|Inspector|Credential|Reason)\s+/u,
          "",
        );
        const encodedValue = value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
        expect(html.includes(encodedValue) || htmlText.includes(value)).toBe(
          true,
        );
      }
    }
  });
});
