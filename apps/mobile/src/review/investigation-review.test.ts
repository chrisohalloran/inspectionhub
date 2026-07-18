import {
  ProvisionalFindingSchema,
  type BuildingFindingContent,
  type VerifierResult,
} from "@inspection/contracts";
import { describe, expect, it } from "vitest";

import {
  acceptReviewItem,
  confirmAcceptedReviewItem,
  createInvestigationReviewItem,
  editReviewItem,
  markReviewItemStale,
  recordExactReverification,
  rejectReviewItem,
  resolveReviewCheck,
  reviewDisclosure,
} from "./investigation-review.js";
import { reviewActions } from "./review-screen-contract.js";

const ids = {
  review: "60000000-0000-4000-8000-000000000001",
  investigation: "60000000-0000-4000-8000-000000000002",
  finding: "60000000-0000-4000-8000-000000000003",
  version: "60000000-0000-4000-8000-000000000004",
  editedVersion: "60000000-0000-4000-8000-000000000005",
  organization: "60000000-0000-4000-8000-000000000006",
  job: "60000000-0000-4000-8000-000000000007",
  module: "60000000-0000-4000-8000-000000000008",
  artifact: "60000000-0000-4000-8000-000000000009",
  transcript: "60000000-0000-4000-8000-000000000010",
  packet: "60000000-0000-4000-8000-000000000011",
  inspector: "60000000-0000-4000-8000-000000000012",
  check: "60000000-0000-4000-8000-000000000013",
};
const at = "2026-07-15T04:00:00.000Z";
const content: BuildingFindingContent = {
  module: "building",
  location: "Second floor / Main bathroom",
  observation: "Cracking is visible in several shower-base tiles.",
  apparentExtent: "Several tiles in the shower base and floor area.",
  qualifiedOpinion:
    "Movement in the supporting floor assembly may have contributed.",
  uncertainty: ["The waterproof membrane is concealed."],
  furtherInvestigation:
    "Engage a suitably licensed and qualified builder or tiler to investigate.",
  classification: "major_defect",
};
const contentHash = "c".repeat(64);

function review(options: { blockingCheck?: boolean } = {}) {
  const finding = ProvisionalFindingSchema.parse({
    status: "provisional",
    findingId: ids.finding,
    versionId: ids.version,
    organizationId: ids.organization,
    jobId: ids.job,
    moduleId: ids.module,
    contentHash,
    content,
    authorship: {
      origin: "ai",
      model: "gpt-5.6",
      promptVersion: "draft-v1",
      skillVersions: ["building-v1", "report-language-v1"],
      packetRevision: 1,
      sourceArtifactReferences: [
        {
          kind: "original",
          artifactId: ids.artifact,
          contentHash: "a".repeat(64),
        },
      ],
      transcriptSpanReferences: [ids.transcript],
    },
    verifier: {
      status: "passed",
      draftVersionId: ids.version,
      contentHash,
      verifierVersion: "verifier-v1",
      verifiedAt: at,
    },
  });
  return createInvestigationReviewItem({
    reviewId: ids.review,
    investigationId: ids.investigation,
    finding,
    provenance: {
      packetId: ids.packet,
      packetRevision: 1,
      packetHash: "b".repeat(64),
      sourceRevision: 1,
      sourceArtifactIds: [ids.artifact],
      transcriptSpanIds: [ids.transcript],
      transcriptUncertainty: ["The word movement had low token confidence."],
      assumptions: ["The floor assembly was not visible."],
    },
    checks: options.blockingCheck
      ? [
          {
            checkId: ids.check,
            code: "extent_not_checked",
            severity: "blocking",
            state: "open",
            explanation: "Inspect adjacent surfaces before confirming extent.",
          },
        ]
      : [],
  });
}

const inspector = {
  inspectorId: ids.inspector,
  displayName: "Licensed Inspector",
  credentialVersion: "credential-v1",
  confirmedAt: at,
};

describe("investigation-scoped review", () => {
  it("exposes origin, packet, sources, uncertainty, assumptions and verifier state", () => {
    const item = review();
    expect(reviewDisclosure(item)).toEqual({
      origin: "AI suggested",
      packet: `${ids.packet} · revision 1`,
      sources: "1 evidence source(s), 1 transcript span(s)",
      uncertainty: [
        "The waterproof membrane is concealed.",
        "The word movement had low token confidence.",
      ],
      assumptions: ["The floor assembly was not visible."],
      verifier: "Verified exact version · verifier-v1",
      stale: false,
    });
  });

  it("accepts and confirms only an exact verified current version", () => {
    const accepted = acceptReviewItem(review());
    const confirmed = confirmAcceptedReviewItem(accepted, inspector);

    expect(accepted.decisionMode).toBe("ai_unchanged");
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.inspectorAttribution).toEqual(inspector);
  });

  it("rejects duplicate authorship and provenance source identities", () => {
    const current = review();
    const source = current.finding.authorship.sourceArtifactReferences[0]!;
    const duplicateAuthorship = ProvisionalFindingSchema.parse({
      ...current.finding,
      authorship: {
        ...current.finding.authorship,
        sourceArtifactReferences: [source, source],
      },
    });
    expect(() =>
      createInvestigationReviewItem({
        reviewId: current.reviewId,
        investigationId: current.investigationId,
        finding: duplicateAuthorship,
        provenance: {
          ...current.provenance,
          sourceArtifactIds: [ids.artifact, ids.artifact],
        },
      }),
    ).toThrow("exact draft packet and selected sources");

    expect(() =>
      createInvestigationReviewItem({
        reviewId: current.reviewId,
        investigationId: current.investigationId,
        finding: current.finding,
        provenance: {
          ...current.provenance,
          sourceArtifactIds: [ids.artifact, ids.artifact],
        },
      }),
    ).toThrow("exact draft packet and selected sources");
  });

  it("requires blocking investigation checks to be resolved", () => {
    const item = review({ blockingCheck: true });
    expect(() => acceptReviewItem(item)).toThrow(
      "Resolve every blocking investigation check",
    );
    const resolved = resolveReviewCheck(item, ids.check);
    expect(acceptReviewItem(resolved).status).toBe("accepted");
  });

  it("requires an edited AI version to be exactly reverified", () => {
    const editedContent = {
      ...content,
      apparentExtent: "Cracking continues across five visible tiles.",
    };
    const edited = editReviewItem(review(), {
      content: editedContent,
      newVersionId: ids.editedVersion,
      newContentHash: "d".repeat(64),
      pathway: "reverify_ai",
    });

    expect(edited.finding.verifier.status).toBe("pending");
    expect(
      reviewActions(edited).find(({ id }) => id === "accept")?.enabled,
    ).toBe(false);
    expect(() => acceptReviewItem(edited)).toThrow(
      "exact current verifier pass",
    );

    const wrong: VerifierResult = {
      status: "passed",
      draftVersionId: ids.version,
      contentHash: edited.finding.contentHash,
      verifierVersion: "verifier-v1",
      verifiedAt: at,
    };
    expect(() => recordExactReverification(edited, wrong)).toThrow(
      "must bind this exact edited version",
    );

    const verified = recordExactReverification(edited, {
      status: "passed",
      draftVersionId: edited.finding.versionId,
      contentHash: edited.finding.contentHash,
      verifierVersion: "verifier-v1",
      verifiedAt: at,
    });
    expect(acceptReviewItem(verified).decisionMode).toBe("ai_reverified");
  });

  it("supports an explicit human-authored conversion during AI outage", () => {
    const converted = editReviewItem(review(), {
      content: { ...content, observation: "Inspector entered this manually." },
      newVersionId: ids.editedVersion,
      newContentHash: "e".repeat(64),
      pathway: "convert_to_human",
    });

    expect(converted.finding.authorship.origin).toBe("human");
    expect(converted.finding.verifier).toEqual({
      status: "not_required",
      reason: "human_authored",
    });
    const accepted = acceptReviewItem(converted);
    expect(accepted.decisionMode).toBe("human_authored");
    expect(
      confirmAcceptedReviewItem(accepted, inspector).authorship.origin,
    ).toBe("human");
  });

  it("prevents rejected and stale AI versions from confirmation", () => {
    const rejected = rejectReviewItem(
      review(),
      "Observation does not match site.",
    );
    expect(() => confirmAcceptedReviewItem(rejected, inspector)).toThrow(
      "Only an accepted current review version",
    );
    expect(
      reviewActions(rejected).find(({ id }) => id === "edit"),
    ).toMatchObject({ enabled: true, label: "Write replacement" });
    const replacement = editReviewItem(rejected, {
      content: {
        ...content,
        observation: "Inspector wrote a replacement observation.",
      },
      newVersionId: ids.editedVersion,
      newContentHash: "d".repeat(64),
      pathway: "convert_to_human",
    });
    expect(replacement).toMatchObject({
      status: "awaiting_decision",
      rejectionReason: null,
      finding: {
        authorship: { origin: "human" },
        verifier: { status: "not_required" },
      },
    });
    expect(() =>
      editReviewItem(rejected, {
        content,
        newVersionId: ids.editedVersion,
        newContentHash: "e".repeat(64),
        pathway: "reverify_ai",
      }),
    ).toThrow("cannot take that edit pathway");

    const stale = markReviewItemStale(review(), ids.editedVersion);
    expect(stale.finding.verifier.status).toBe("stale");
    expect(
      reviewActions(stale).find(({ id }) => id === "return_to_capture"),
    ).toMatchObject({
      enabled: true,
      label: "Capture replacement evidence",
    });
    expect(
      reviewActions(stale)
        .filter(({ id }) => id !== "return_to_capture")
        .every(({ enabled }) => !enabled),
    ).toBe(true);
    expect(() => acceptReviewItem(stale)).toThrow("stale");
  });

  it("derives stale state immediately when a stale verifier record is loaded", () => {
    const current = review();
    const loaded = createInvestigationReviewItem({
      reviewId: current.reviewId,
      investigationId: current.investigationId,
      finding: ProvisionalFindingSchema.parse({
        ...current.finding,
        verifier: {
          status: "stale",
          draftVersionId: current.finding.versionId,
          contentHash: current.finding.contentHash,
          supersededByVersionId: ids.editedVersion,
          recordedAt: at,
        },
      }),
      provenance: current.provenance,
    });

    expect(loaded.status).toBe("stale");
    expect(
      reviewActions(loaded).find(({ id }) => id === "return_to_capture")
        ?.enabled,
    ).toBe(true);
  });

  it("cannot edit a Building review into Timber Pest taxonomy", () => {
    expect(() =>
      editReviewItem(review(), {
        content: {
          module: "timber_pest",
          location: content.location,
          observation: content.observation,
          apparentExtent: content.apparentExtent,
          qualifiedOpinion: content.qualifiedOpinion,
          uncertainty: content.uncertainty,
          furtherInvestigation: content.furtherInvestigation,
          category: "visible_evidence",
        },
        newVersionId: ids.editedVersion,
        newContentHash: "f".repeat(64),
        pathway: "reverify_ai",
      }),
    ).toThrow("cannot move a finding between professional modules");
  });

  it("enforces 48 pixel action targets and non-colour labels", () => {
    const actions = reviewActions(review());
    expect(actions.every(({ minimumTargetPx }) => minimumTargetPx === 48)).toBe(
      true,
    );
    expect(actions.map(({ label }) => label)).toContain("Reject suggestion");
    expect(
      reviewActions(acceptReviewItem(review())).find(
        ({ id }) => id === "accept",
      )?.label,
    ).toBe("Finding accepted");
  });
});
