import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const capturedAt = "2026-07-15T01:30:00.000Z";
const photoBytes =
  "synthetic-photo-placeholder:second-floor-main-bathroom-cracked-tiles";
const audioBytes =
  "synthetic-audio-placeholder:cracked-tile-qualified-field-note";

export function buildDemoSeed() {
  const photoHash = sha256(photoBytes);
  const audioHash = sha256(audioBytes);

  return {
    schemaVersion: 1,
    fixtureId: "build-week-golden-path-v1",
    classification: "synthetic_deidentified",
    generatedFrom: "versioned_source_only",
    fixedClock: capturedAt,
    declarations: {
      containsRealCustomerData: false,
      provesProfessionalCredential: false,
      provesStandardsCompliance: false,
      usesLiveProviders: false,
      safeForPublicDemo: true,
    },
    actors: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        role: "inspector",
        displayName: "Synthetic Inspector",
        professionalStatus: "demo_unverified",
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        role: "client",
        displayName: "Synthetic Client",
      },
      {
        id: "10000000-0000-4000-8000-000000000003",
        role: "recipient",
        displayName: "Synthetic Recipient",
        email: "recipient@example.test",
      },
      {
        id: "10000000-0000-4000-8000-000000000004",
        role: "access_contact",
        displayName: "Synthetic Access Contact",
      },
    ],
    booking: {
      id: "20000000-0000-4000-8000-000000000001",
      propertyLabel: "De-identified two-storey dwelling",
      propertyAddress: "10 Example Street, Testville QLD 4000",
      modules: ["building", "timber_pest"],
      agreementVersion: "demo-pre-inspection-v1",
      agreementAcceptedAt: "2026-07-15T00:45:00.000Z",
      paymentMode: "fake_success",
      calendarMode: "fake_success",
      emailMode: "fake_success",
    },
    job: {
      id: "30000000-0000-4000-8000-000000000001",
      status: "field_capture_ready",
      commissionedModules: [
        { id: "40000000-0000-4000-8000-000000000001", module: "building" },
        { id: "40000000-0000-4000-8000-000000000002", module: "timber_pest" },
      ],
      areas: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          path: "Second floor / Main bathroom",
          status: "inspected_with_finding",
        },
        {
          id: "50000000-0000-4000-8000-000000000002",
          path: "Roof void / Concealed timbers",
          status: "not_inspected",
          limitation: "Access was not available at the inspection time.",
        },
      ],
    },
    evidence: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        kind: "photo_original",
        areaId: "50000000-0000-4000-8000-000000000001",
        capturedAt,
        contentSha256: photoHash,
        localState: "durable",
        serverState: "queued",
        linkedToFinding: true,
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        kind: "voice_original",
        areaId: "50000000-0000-4000-8000-000000000001",
        capturedAt: "2026-07-15T01:31:00.000Z",
        contentSha256: audioHash,
        localState: "durable",
        serverState: "queued",
        linkedToFinding: true,
        transcript:
          "Cracked tiles in the shower base and main bathroom floor area. Bathroom is on the second floor and likely has timber joists with tile underlay. Cracking is visible in several tiles. Movement in the supporting floor may have contributed. The waterproof membrane condition could not be visually confirmed.",
      },
      {
        id: "60000000-0000-4000-8000-000000000003",
        kind: "photo_original",
        areaId: "50000000-0000-4000-8000-000000000001",
        capturedAt: "2026-07-15T01:32:00.000Z",
        contentSha256: sha256(
          "synthetic-photo-placeholder:main-bathroom-context",
        ),
        localState: "durable",
        serverState: "queued",
        linkedToFinding: false,
        purpose: "coverage_and_dispute_record",
      },
    ],
    investigation: {
      id: "70000000-0000-4000-8000-000000000001",
      status: "completed_with_finding_candidates",
      trigger: "possible_defect",
      attachedEvidenceIds: [
        "60000000-0000-4000-8000-000000000001",
        "60000000-0000-4000-8000-000000000002",
      ],
      extentChecks: [
        "Inspected adjacent bathroom floor tiles",
        "Reviewed accessible surfaces below the bathroom",
        "Recorded concealed membrane and subfloor as not visually confirmed",
      ],
    },
    draftCandidates: {
      building: {
        origin: "ai_suggestion_requires_inspector_confirmation",
        module: "building",
        sourceEvidenceIds: [
          "60000000-0000-4000-8000-000000000001",
          "60000000-0000-4000-8000-000000000002",
        ],
        observation:
          "Cracking is visible in several shower-base and bathroom floor tiles.",
        apparentExtent:
          "Several tiles in the shower base and main bathroom floor area.",
        qualifiedOpinion:
          "Movement in the supporting floor assembly may have contributed.",
        uncertainty:
          "Concealed construction and membrane condition were not visually confirmed.",
        inspectorClassification: "major_defect",
        furtherInvestigation:
          "Engage a suitably licensed and qualified builder or tiler to investigate.",
        verifierStatus: "pass_for_inspector_review",
      },
      timberPest: {
        origin: "inspector_authored_demo_fixture",
        module: "timber_pest",
        inspectedAreas: [
          "Accessible internal areas",
          "Accessible external perimeter",
        ],
        observation:
          "No visible evidence of timber pest activity was observed in the accessible inspected areas at the inspection time.",
        limitation:
          "Roof-void concealed timbers were not inspected because access was not available.",
        conclusionBoundary:
          "The visual inspection cannot establish that concealed or inaccessible areas are free of timber pests.",
        verifierStatus: "not_required_human_authored",
      },
    },
    approvals: {
      building: {
        status: "pending_inspector_confirmation",
        snapshotRevision: 1,
      },
      timberPest: {
        status: "pending_inspector_confirmation",
        snapshotRevision: 1,
      },
      combinedPackageAllowed: false,
    },
    delivery: {
      adapter: "fake",
      state: "not_started",
      recipientGrant: {
        status: "not_issued",
        scope: ["building", "timber_pest"],
      },
    },
    recoveryScenario: {
      id: "airplane-mode-termination-v1",
      sequence: [
        "capture_offline",
        "durable_local_acknowledgement",
        "terminate_application",
        "relaunch_and_reconcile",
        "resume_queue_without_new_capture_identity",
      ],
      proofStatus: "requires_physical_device_observation",
    },
  };
}

export function seedDocument() {
  const seed = buildDemoSeed();
  return {
    ...seed,
    integrity: {
      algorithm: "sha256",
      canonicalPayloadSha256: sha256(canonicalJson(seed)),
    },
  };
}

async function main() {
  const outputFlagIndex = process.argv.indexOf("--output");
  const json = `${JSON.stringify(seedDocument(), null, 2)}\n`;
  if (outputFlagIndex === -1) {
    process.stdout.write(json);
    return;
  }
  const output = process.argv[outputFlagIndex + 1];
  if (!output) {
    throw new Error("--output requires a path");
  }
  await writeFile(resolve(output), json, { encoding: "utf8", flag: "w" });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main();
}
