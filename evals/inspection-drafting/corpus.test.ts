import { readFile, readdir } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const CaseSchema = z.strictObject({
  schema_version: z.literal(1),
  case_id: z.string().regex(/^[DH]\d{2}$/u),
  split: z.enum(["development", "holdout"]),
  locked_holdout: z.boolean(),
  architecture_subset: z.boolean(),
  critical: z.literal(true),
  fixed_trials: z.number().int().min(3),
  modules: z
    .array(z.enum(["building", "timber_pest"]))
    .min(1)
    .max(2),
  scenario: z.string().min(20),
  packet_manifest: z.strictObject({
    fixture_kind: z.literal("redacted_manifest"),
    manifest_ref: z.string().min(1),
    selected_source_refs: z.array(z.string().min(1)).min(1),
    protected_artifact_refs: z.array(z.string()),
    fixture_status: z.enum(["metadata_only", "complete"]),
  }),
  expected: z.strictObject({
    required_facts: z.array(z.string().min(1)).min(1),
    allowed_uncertainties: z.array(z.string().min(1)),
    forbidden_claims: z.array(z.string().min(1)).min(1),
    inspector_decision: z.string().min(1),
    verifier: z.enum(["pass", "reject"]),
  }),
  media: z.strictObject({
    selected_proxy_refs: z.array(z.string()),
    audio_fixture_ref: z.string().nullable(),
    licence_status: z.enum(["no_media_fixture", "licensed_fixture"]),
  }),
});

describe("versioned inspection drafting corpus", () => {
  it("contains the predeclared 20-case development and locked 10-case holdout split", async () => {
    const cases = await loadCases();

    expect(cases).toHaveLength(30);
    expect(new Set(cases.map((entry) => entry.case_id)).size).toBe(30);
    expect(cases.filter((entry) => entry.split === "development")).toHaveLength(
      20,
    );
    expect(cases.filter((entry) => entry.split === "holdout")).toHaveLength(10);
    expect(
      cases
        .filter((entry) => entry.split === "holdout")
        .every((entry) => entry.locked_holdout),
    ).toBe(true);
    expect(
      cases
        .filter((entry) => entry.split === "development")
        .every((entry) => !entry.locked_holdout),
    ).toBe(true);
  });

  it("pins exactly ten development cases for the planner-versus-thin comparison", async () => {
    const cases = await loadCases();
    const comparison = cases.filter((entry) => entry.architecture_subset);

    expect(comparison).toHaveLength(10);
    expect(comparison.every((entry) => entry.split === "development")).toBe(
      true,
    );
    expect(comparison.map((entry) => entry.case_id).sort()).toEqual(
      Array.from(
        { length: 10 },
        (_, index) => `D${String(index + 1).padStart(2, "0")}`,
      ),
    );
  });

  it("requires reproducible sources, fixed worst-case trials, and explicit verifier oracles", async () => {
    const cases = await loadCases();

    expect(cases.every((entry) => entry.fixed_trials === 3)).toBe(true);
    expect(
      cases.every(
        (entry) =>
          entry.packet_manifest.selected_source_refs.length > 0 &&
          entry.expected.required_facts.length > 0 &&
          entry.expected.forbidden_claims.length > 0,
      ),
    ).toBe(true);
    expect(
      cases.filter((entry) => entry.expected.verifier === "reject").length,
    ).toBeGreaterThanOrEqual(10);
  });

  it("keeps the live architecture verdict unset until observed comparison evidence exists", async () => {
    const configuration = JSON.parse(
      await readFile(new URL("./release-config.json", import.meta.url), "utf8"),
    ) as {
      liveComparison: {
        status: string;
        reason: string;
        selectedArchitecture: string | null;
        evidenceArtifact: string | null;
      };
    };

    expect(configuration.liveComparison).toEqual({
      status: "blocked",
      reason: "openai_platform_connector_reauthentication_required",
      selectedArchitecture: null,
      evidenceArtifact: null,
    });
  });
});

async function loadCases(): Promise<z.infer<typeof CaseSchema>[]> {
  const root = new URL("./cases/", import.meta.url);
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  return Promise.all(
    directories.map(async (directory) =>
      CaseSchema.parse(
        parse(
          await readFile(
            new URL(`${directory.name}/manifest.yaml`, root),
            "utf8",
          ),
        ),
      ),
    ),
  );
}
