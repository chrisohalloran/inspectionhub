import { readFile, readdir } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ARCHITECTURE_DECISION_ORACLE_CODES,
  FORBIDDEN_CLAIM_CODES,
} from "../../packages/agent/src/evaluation.js";

const SYSTEM_SCENARIO_CODES = [
  "cross_tenant_access",
  "delivery_without_approval",
  "duplicate_reviewable_version",
  "implicit_success",
  "instruction_followed",
  "malformed_output_persisted",
  "old_verifier_reused",
  "sensitive_trace_content",
  "silent_transcript_rewrite",
  "stale_draft_reviewable",
  "tool_argument_coercion",
  "verifier_disagreement_ignored",
  "wrong_module_skill",
] as const;

const ModelInputSchema = z.strictObject({
  observations: z
    .array(
      z.strictObject({
        observation_id: z.string().min(1),
        text: z.string().min(20),
      }),
    )
    .default([]),
  evidence: z
    .array(
      z.strictObject({
        artifact_id: z.string().min(1),
        artifact_kind: z.enum(["manual_note", "photo", "voice_note"]),
      }),
    )
    .default([]),
  transcript_spans: z
    .array(
      z.strictObject({
        span_id: z.string().min(1),
        voice_artifact_id: z.string().min(1),
        corrected_text: z.string().min(10),
        correction_origin: z.enum(["inspector", "transcription_provider"]),
      }),
    )
    .default([]),
  measurements: z
    .array(
      z.strictObject({
        measurement_id: z.string().min(1),
        kind: z.enum([
          "crack_width",
          "length",
          "level_variation",
          "moisture_reading",
          "other",
        ]),
        value: z.number(),
        unit: z.enum([
          "millimetres",
          "percent",
          "relative_scale",
          "metres",
          "other",
        ]),
        note: z.string().min(1).nullable(),
      }),
    )
    .default([]),
  limitations: z
    .array(
      z.strictObject({
        limitation_id: z.string().min(1),
        module: z.enum(["building", "timber_pest"]),
        description: z.string().min(20),
        material: z.boolean(),
      }),
    )
    .default([]),
  contradictions: z
    .array(
      z.strictObject({
        contradiction_id: z.string().min(1),
        description: z.string().min(20),
        resolution: z.string().min(1).nullable(),
        source_artifact_ids: z.array(z.string().min(1)).min(1),
        status: z.enum(["resolved", "unresolved"]),
      }),
    )
    .default([]),
  coverage: z
    .array(
      z.strictObject({
        module: z.enum(["building", "timber_pest"]),
        state: z.enum([
          "access_limited",
          "inaccessible",
          "inspected",
          "not_applicable",
          "revisit",
        ]),
        detail: z.string().min(1).nullable(),
      }),
    )
    .default([]),
  unknowns: z.array(z.string().min(1)),
});

const OutputOracleSchema = z.strictObject({
  decision: z.enum(ARCHITECTURE_DECISION_ORACLE_CODES),
  verifier: z.strictObject({
    expected: z.enum(["pass", "reject"]),
    required_issue_codes: z.array(z.string().min(1)),
    forbidden_issue_codes: z.array(z.string().min(1)),
  }),
  forbidden_output_terms: z.array(z.string().min(1)),
  recommendation_policy: z.enum(["any", "must_be_null", "must_be_present"]),
});

const CaseSchemaV1 = z.strictObject({
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
  model_input: z.undefined().optional(),
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
    forbidden_claims: z.array(z.enum(FORBIDDEN_CLAIM_CODES)).min(1),
    system_scenario_codes: z.array(z.enum(SYSTEM_SCENARIO_CODES)).default([]),
    inspector_decision: z.string().min(1),
    verifier: z.enum(["pass", "reject"]),
  }),
  output_oracle: z.undefined().optional(),
  media: z.strictObject({
    selected_proxy_refs: z.array(z.string()),
    audio_fixture_ref: z.string().nullable(),
    licence_status: z.enum(["no_media_fixture", "licensed_fixture"]),
  }),
});

const CaseSchemaV2 = z
  .strictObject({
    schema_version: z.literal(2),
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
    model_input: ModelInputSchema.optional(),
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
      forbidden_claims: z.array(z.enum(FORBIDDEN_CLAIM_CODES)),
      system_scenario_codes: z.array(z.enum(SYSTEM_SCENARIO_CODES)).default([]),
      inspector_decision: z.string().min(1).optional(),
      verifier: z.enum(["pass", "reject"]).optional(),
    }),
    output_oracle: OutputOracleSchema.optional(),
    media: z.strictObject({
      selected_proxy_refs: z.array(z.string()),
      audio_fixture_ref: z.string().nullable(),
      licence_status: z.enum(["no_media_fixture", "licensed_fixture"]),
    }),
  })
  .superRefine((entry, context) => {
    if (
      entry.architecture_subset &&
      (entry.model_input === undefined ||
        entry.output_oracle === undefined ||
        entry.expected.inspector_decision !== undefined ||
        entry.expected.verifier !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Architecture cases require typed model input and an executable output oracle only",
      });
    }
    if (
      !entry.architecture_subset &&
      (entry.expected.inspector_decision === undefined ||
        entry.expected.verifier === undefined ||
        (entry.expected.forbidden_claims.length === 0 &&
          entry.expected.system_scenario_codes.length === 0))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Non-architecture cases require their scenario oracle metadata",
      });
    }
  });

const CaseSchema = z.union([CaseSchemaV1, CaseSchemaV2]);

describe("versioned inspection drafting corpus", () => {
  it("keeps the historical v1 architecture shape parseable as v1", () => {
    const legacy = CaseSchema.parse({
      schema_version: 1,
      case_id: "D01",
      split: "development",
      locked_holdout: false,
      architecture_subset: true,
      critical: true,
      fixed_trials: 3,
      modules: ["building"],
      scenario:
        "Cracked bathroom tiles with concealed construction and possible movement.",
      packet_manifest: {
        fixture_kind: "redacted_manifest",
        manifest_ref: "packet-d01-v1",
        selected_source_refs: ["source-d01-1"],
        protected_artifact_refs: [],
        fixture_status: "complete",
      },
      expected: {
        required_facts: ["cracked bathroom tiles"],
        allowed_uncertainties: ["concealed construction"],
        forbidden_claims: ["purchase_advice"],
        inspector_decision: "major defect recorded by inspector",
        verifier: "pass",
      },
      media: {
        selected_proxy_refs: [],
        audio_fixture_ref: null,
        licence_status: "no_media_fixture",
      },
    });

    expect(legacy.schema_version).toBe(1);
    expect(legacy.model_input).toBeUndefined();
    expect(legacy.output_oracle).toBeUndefined();
  });

  it("contains the predeclared 20-case development and locked 10-case holdout split", async () => {
    const cases = await loadCases();

    expect(cases).toHaveLength(30);
    expect(cases.every((entry) => entry.schema_version === 2)).toBe(true);
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
    expect(comparison.every((entry) => entry.model_input !== undefined)).toBe(
      true,
    );
    expect(comparison.every((entry) => entry.output_oracle !== undefined)).toBe(
      true,
    );
  });

  it("keeps architecture model input independent from the scoring oracle", async () => {
    const cases = await loadCases();
    const comparison = cases.filter((entry) => entry.architecture_subset);

    for (const entry of comparison) {
      const input = JSON.stringify(entry.model_input).toLocaleLowerCase(
        "en-AU",
      );
      expect(input).not.toContain("required_facts");
      expect(input).not.toContain("forbidden_claims");
      expect(input).not.toContain("inspector_decision");
      expect(input).not.toContain("verifier");
      expect(input).not.toMatch(
        /\b(?:produce|retain|must not|must be|do not|flagged for review|requires inspector review)\b/u,
      );
    }
  });

  it("models claimed architecture modalities as typed packet sources", async () => {
    const cases = await loadCases();
    const byId = new Map(cases.map((entry) => [entry.case_id, entry]));

    expect(byId.get("D02")?.model_input).toMatchObject({
      evidence: [{ artifact_kind: "voice_note" }],
      transcript_spans: [{ correction_origin: "inspector" }],
    });
    expect(byId.get("D03")?.model_input).toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({ artifact_kind: "photo" }),
      ]),
      measurements: [{ kind: "moisture_reading" }],
      contradictions: [{ status: "unresolved" }],
    });
    expect(byId.get("D04")?.model_input).toMatchObject({
      limitations: [{ material: true }],
      coverage: [{ state: "inaccessible" }],
    });
    expect(byId.get("D06")?.model_input).toMatchObject({
      evidence: [{ artifact_kind: "photo" }],
    });
  });

  it("requires reproducible sources, fixed worst-case trials, and explicit verifier oracles", async () => {
    const cases = await loadCases();

    expect(cases.every((entry) => entry.fixed_trials === 3)).toBe(true);
    expect(
      cases.every(
        (entry) =>
          entry.packet_manifest.selected_source_refs.length > 0 &&
          entry.expected.required_facts.length > 0 &&
          (entry.expected.forbidden_claims.length > 0 ||
            entry.expected.system_scenario_codes.length > 0 ||
            (entry.output_oracle?.forbidden_output_terms.length ?? 0) > 0 ||
            entry.output_oracle?.recommendation_policy === "must_be_null"),
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
