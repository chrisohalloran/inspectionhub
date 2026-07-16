import {
  ConfirmedFindingSchema,
  ProvisionalFindingSchema,
  type ConfirmedFinding,
  type FindingContent,
  type InspectorAttribution,
  type ProvisionalFinding,
  type VerifierResult,
} from "@inspection/contracts";

export type ReviewCheck = Readonly<{
  checkId: string;
  code: string;
  severity: "blocking" | "advisory";
  state: "open" | "resolved";
  explanation: string;
}>;

export type ReviewProvenance = Readonly<{
  packetId: string;
  packetRevision: number;
  packetHash: string;
  sourceRevision: number;
  sourceArtifactIds: readonly string[];
  transcriptSpanIds: readonly string[];
  transcriptUncertainty: readonly string[];
  assumptions: readonly string[];
}>;

export type InvestigationReviewItem = Readonly<{
  reviewId: string;
  investigationId: string;
  module: "building" | "timber_pest";
  status: "awaiting_decision" | "accepted" | "rejected" | "stale";
  decisionMode: "ai_unchanged" | "ai_reverified" | "human_authored" | null;
  finding: ProvisionalFinding;
  provenance: ReviewProvenance;
  checks: readonly ReviewCheck[];
  supersededByVersionId: string | null;
  rejectionReason: string | null;
}>;

export class ReviewDecisionError extends Error {
  constructor(
    readonly code:
      | "review_not_actionable"
      | "review_blocking_check_open"
      | "review_verifier_not_exact"
      | "review_module_mismatch"
      | "review_provenance_mismatch"
      | "review_ai_edit_path_required",
    message: string,
  ) {
    super(message);
    this.name = "ReviewDecisionError";
  }
}

export function createInvestigationReviewItem(
  input: Readonly<{
    reviewId: string;
    investigationId: string;
    finding: ProvisionalFinding;
    provenance: ReviewProvenance;
    checks?: readonly ReviewCheck[];
  }>,
): InvestigationReviewItem {
  const finding = ProvisionalFindingSchema.parse(input.finding);
  assertProvenanceMatches(finding, input.provenance);
  const initialStatus =
    finding.verifier.status === "stale"
      ? "stale"
      : finding.verifier.status === "rejected"
        ? "rejected"
        : "awaiting_decision";
  return deepFreeze({
    reviewId: input.reviewId,
    investigationId: input.investigationId,
    module: finding.content.module,
    status: initialStatus,
    decisionMode: null,
    finding,
    provenance: { ...input.provenance },
    checks: [...(input.checks ?? [])],
    supersededByVersionId:
      finding.verifier.status === "stale"
        ? finding.verifier.supersededByVersionId
        : null,
    rejectionReason:
      finding.verifier.status === "rejected"
        ? finding.verifier.reasons.join("; ")
        : null,
  });
}

export function resolveReviewCheck(
  item: InvestigationReviewItem,
  checkId: string,
): InvestigationReviewItem {
  assertActionable(item);
  if (!item.checks.some((check) => check.checkId === checkId)) {
    throw new ReviewDecisionError(
      "review_not_actionable",
      "Review check does not exist",
    );
  }
  return deepFreeze({
    ...item,
    checks: item.checks.map((check) =>
      check.checkId === checkId
        ? { ...check, state: "resolved" as const }
        : check,
    ),
  });
}

export function acceptReviewItem(
  item: InvestigationReviewItem,
): InvestigationReviewItem {
  assertActionable(item);
  if (
    item.checks.some(
      (check) => check.severity === "blocking" && check.state === "open",
    )
  ) {
    throw new ReviewDecisionError(
      "review_blocking_check_open",
      "Resolve every blocking investigation check before accepting",
    );
  }
  assertConfirmableVerifier(item.finding);
  const decisionMode =
    item.finding.authorship.origin === "human"
      ? "human_authored"
      : item.provenance.sourceRevision > 1
        ? "ai_reverified"
        : "ai_unchanged";
  return deepFreeze({ ...item, status: "accepted", decisionMode });
}

export function rejectReviewItem(
  item: InvestigationReviewItem,
  reason: string,
): InvestigationReviewItem {
  assertActionable(item);
  if (!reason.trim()) {
    throw new ReviewDecisionError(
      "review_not_actionable",
      "A rejection reason is required",
    );
  }
  return deepFreeze({
    ...item,
    status: "rejected",
    rejectionReason: reason.trim(),
  });
}

export function markReviewItemStale(
  item: InvestigationReviewItem,
  supersededByVersionId: string,
  recordedAt: string = new Date().toISOString(),
): InvestigationReviewItem {
  if (item.status === "rejected") return item;
  return deepFreeze({
    ...item,
    status: "stale",
    decisionMode: null,
    supersededByVersionId,
    finding: ProvisionalFindingSchema.parse({
      ...item.finding,
      verifier: {
        status: "stale",
        draftVersionId: item.finding.versionId,
        contentHash: item.finding.contentHash,
        supersededByVersionId,
        recordedAt,
      },
    }),
  });
}

export function editReviewItem(
  item: InvestigationReviewItem,
  input: Readonly<{
    content: FindingContent;
    newVersionId: string;
    newContentHash: string;
    pathway: "reverify_ai" | "convert_to_human";
  }>,
): InvestigationReviewItem {
  assertActionable(item);
  if (input.content.module !== item.module) {
    throw new ReviewDecisionError(
      "review_module_mismatch",
      "An edit cannot move a finding between professional modules",
    );
  }
  if (
    item.finding.authorship.origin === "human" &&
    input.pathway === "reverify_ai"
  ) {
    throw new ReviewDecisionError(
      "review_ai_edit_path_required",
      "A human-authored finding cannot silently become AI-authored",
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(input.newContentHash)) {
    throw new ReviewDecisionError(
      "review_provenance_mismatch",
      "Edited content requires a lowercase SHA-256 hash from the durable content pipeline",
    );
  }
  const contentHash = input.newContentHash;
  const sourceArtifactReferences =
    item.finding.authorship.sourceArtifactReferences;
  const transcriptSpanReferences =
    item.finding.authorship.transcriptSpanReferences;
  const authorship =
    input.pathway === "convert_to_human"
      ? {
          origin: "human" as const,
          sourceArtifactReferences,
          transcriptSpanReferences,
        }
      : {
          ...item.finding.authorship,
          origin: "ai" as const,
        };
  const verifier: VerifierResult =
    input.pathway === "convert_to_human"
      ? { status: "not_required", reason: "human_authored" }
      : { status: "pending" };
  const finding = ProvisionalFindingSchema.parse({
    ...item.finding,
    versionId: input.newVersionId,
    contentHash,
    content: input.content,
    authorship,
    verifier,
  });
  return deepFreeze({
    ...item,
    status: "awaiting_decision",
    decisionMode: null,
    finding,
    provenance: {
      ...item.provenance,
      sourceRevision: item.provenance.sourceRevision + 1,
    },
    supersededByVersionId: null,
    rejectionReason: null,
  });
}

export function recordExactReverification(
  item: InvestigationReviewItem,
  verifier: VerifierResult,
): InvestigationReviewItem {
  assertActionable(item);
  if (item.finding.authorship.origin !== "ai") {
    throw new ReviewDecisionError(
      "review_verifier_not_exact",
      "Human-authored findings do not require AI verifier results",
    );
  }
  if (
    verifier.status !== "passed" ||
    verifier.draftVersionId !== item.finding.versionId ||
    verifier.contentHash !== item.finding.contentHash
  ) {
    throw new ReviewDecisionError(
      "review_verifier_not_exact",
      "Verifier pass must bind this exact edited version and content hash",
    );
  }
  return deepFreeze({
    ...item,
    finding: ProvisionalFindingSchema.parse({ ...item.finding, verifier }),
  });
}

export function confirmAcceptedReviewItem(
  item: InvestigationReviewItem,
  inspectorAttribution: InspectorAttribution,
): ConfirmedFinding {
  if (item.status !== "accepted") {
    throw new ReviewDecisionError(
      "review_not_actionable",
      "Only an accepted current review version can be confirmed",
    );
  }
  assertConfirmableVerifier(item.finding);
  return ConfirmedFindingSchema.parse({
    ...item.finding,
    status: "confirmed",
    inspectorAttribution,
  });
}

export function reviewDisclosure(item: InvestigationReviewItem): Readonly<{
  origin: "AI suggested" | "Inspector authored";
  packet: string;
  sources: string;
  uncertainty: readonly string[];
  assumptions: readonly string[];
  verifier: string;
  stale: boolean;
}> {
  const ai = item.finding.authorship.origin === "ai";
  return deepFreeze({
    origin: ai ? "AI suggested" : "Inspector authored",
    packet: `${item.provenance.packetId} · revision ${item.provenance.packetRevision}`,
    sources: `${item.provenance.sourceArtifactIds.length} evidence source(s), ${item.provenance.transcriptSpanIds.length} transcript span(s)`,
    uncertainty: [
      ...item.finding.content.uncertainty,
      ...item.provenance.transcriptUncertainty,
    ],
    assumptions: item.provenance.assumptions,
    verifier:
      item.finding.verifier.status === "passed"
        ? `Verified exact version · ${item.finding.verifier.verifierVersion}`
        : `Verifier ${item.finding.verifier.status}`,
    stale: item.status === "stale",
  });
}

function assertActionable(item: InvestigationReviewItem): void {
  if (item.status !== "awaiting_decision") {
    throw new ReviewDecisionError(
      "review_not_actionable",
      `Review item is ${item.status} and cannot take that action`,
    );
  }
}

function assertConfirmableVerifier(finding: ProvisionalFinding): void {
  if (finding.authorship.origin === "human") {
    if (finding.verifier.status !== "not_required") {
      throw new ReviewDecisionError(
        "review_verifier_not_exact",
        "Human-authored finding must record that AI verification is not required",
      );
    }
    return;
  }
  if (
    finding.verifier.status !== "passed" ||
    finding.verifier.draftVersionId !== finding.versionId ||
    finding.verifier.contentHash !== finding.contentHash
  ) {
    throw new ReviewDecisionError(
      "review_verifier_not_exact",
      "AI finding requires an exact current verifier pass",
    );
  }
}

function assertProvenanceMatches(
  finding: ProvisionalFinding,
  provenance: ReviewProvenance,
): void {
  const authoredArtifactIds = new Set(
    finding.authorship.sourceArtifactReferences.map(
      ({ artifactId }) => artifactId,
    ),
  );
  const provenanceArtifactIds = new Set(provenance.sourceArtifactIds);
  const authoredTranscriptIds = new Set(
    finding.authorship.transcriptSpanReferences,
  );
  const provenanceTranscriptIds = new Set(provenance.transcriptSpanIds);
  if (
    !/^[a-f0-9]{64}$/u.test(provenance.packetHash) ||
    !Number.isSafeInteger(provenance.packetRevision) ||
    provenance.packetRevision < 1 ||
    !Number.isSafeInteger(provenance.sourceRevision) ||
    provenance.sourceRevision < 1 ||
    !sameStringSet(authoredArtifactIds, provenanceArtifactIds) ||
    !sameStringSet(authoredTranscriptIds, provenanceTranscriptIds) ||
    (finding.authorship.origin === "ai" &&
      finding.authorship.packetRevision !== provenance.packetRevision)
  ) {
    throw new ReviewDecisionError(
      "review_provenance_mismatch",
      "Review provenance must match the exact draft packet and selected sources",
    );
  }
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
