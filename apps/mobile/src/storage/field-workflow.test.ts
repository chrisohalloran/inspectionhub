import { describe, expect, it } from "vitest";

import {
  cloneFieldWorkflow,
  initialFieldWorkflow,
  parseFieldWorkflow,
  reconcileInvestigationStatus,
} from "./field-workflow.js";

describe("protected field workflow snapshot", () => {
  it("does not rewrite an immutable workflow when durable status already agrees", () => {
    const workflow = initialFieldWorkflow([], "2026-07-16T00:00:00.000Z");

    expect(
      reconcileInvestigationStatus(
        workflow,
        "none",
        "2026-07-16T01:00:00.000Z",
      ),
    ).toBe(workflow);
  });

  it("appends an explicit reconciliation revision when durable status differs", () => {
    const workflow = initialFieldWorkflow([], "2026-07-16T00:00:00.000Z");

    expect(
      reconcileInvestigationStatus(
        workflow,
        "active",
        "2026-07-16T01:00:00.000Z",
      ),
    ).toMatchObject({
      investigationStatus: "active",
      lastTransition: "investigation_reconciled",
      revision: 2,
      updatedAt: "2026-07-16T01:00:00.000Z",
    });
  });

  it("round-trips independently approved package and delivery state", () => {
    const initial = initialFieldWorkflow([], "2026-07-16T01:00:00.000Z");
    const saved = parseFieldWorkflow({
      ...initial,
      approvedModules: ["building", "timber_pest"],
      deliveryState: "waiting_for_evidence",
      packageManifestSha256: "b".repeat(64),
      revision: 9,
    });
    const restored = cloneFieldWorkflow(saved);

    expect(restored).toEqual(saved);
    expect(restored).not.toBe(saved);
    expect(restored.approvedModules).not.toBe(saved.approvedModules);
  });

  it("fails closed on forged approval or package state", () => {
    const initial = initialFieldWorkflow([], "2026-07-16T01:00:00.000Z");
    expect(() =>
      parseFieldWorkflow({
        ...initial,
        approvedModules: ["building", "building"],
      }),
    ).toThrow("Stored field workflow is invalid");
    expect(() =>
      parseFieldWorkflow({
        ...initial,
        packageManifestSha256: "not-a-digest",
      }),
    ).toThrow("Stored field workflow is invalid");
  });
});
