import type { InvestigationReviewItem } from "./investigation-review";

export type ReviewAction = Readonly<{
  id:
    | "accept"
    | "edit"
    | "reject"
    | "reverify"
    | "continue_human"
    | "return_to_capture";
  label: string;
  enabled: boolean;
  accessibilityHint: string;
  minimumTargetPx: 48;
}>;

export function reviewActions(
  item: InvestigationReviewItem,
): readonly ReviewAction[] {
  const actionable = item.status === "awaiting_decision";
  const ai = item.finding.authorship.origin === "ai";
  const exactVerifier =
    item.finding.verifier.status === "passed" &&
    item.finding.verifier.draftVersionId === item.finding.versionId &&
    item.finding.verifier.contentHash === item.finding.contentHash;
  const blocked = item.checks.some(
    (check) => check.severity === "blocking" && check.state === "open",
  );
  return [
    {
      id: "accept",
      label:
        item.status === "accepted"
          ? "Finding accepted"
          : item.status === "rejected"
            ? "Suggestion rejected"
            : item.status === "stale"
              ? "Finding version stale"
              : "Accept finding",
      enabled: actionable && !blocked && (!ai || exactVerifier),
      accessibilityHint:
        "Confirms this exact current version after all blocking checks are resolved",
      minimumTargetPx: 48,
    },
    {
      id: "edit",
      label: item.status === "rejected" ? "Write replacement" : "Edit",
      enabled: actionable || item.status === "rejected",
      accessibilityHint:
        item.status === "rejected"
          ? "Creates a new inspector-authored finding from the selected evidence"
          : "Edit the inspector finding text or professional fields",
      minimumTargetPx: 48,
    },
    {
      id: "reject",
      label: "Reject suggestion",
      enabled: actionable,
      accessibilityHint: "Rejects this suggestion and prevents confirmation",
      minimumTargetPx: 48,
    },
    {
      id: "reverify",
      label: "Reverify AI edit",
      enabled: actionable && ai && !exactVerifier,
      accessibilityHint: "Requests verification for the exact edited version",
      minimumTargetPx: 48,
    },
    {
      id: "continue_human",
      label: "Continue as inspector-authored",
      enabled: actionable && ai,
      accessibilityHint:
        "Records explicit inspector authorship and removes the AI verification dependency",
      minimumTargetPx: 48,
    },
    {
      id: "return_to_capture",
      label: "Capture replacement evidence",
      enabled: item.status === "stale",
      accessibilityHint:
        "Returns to field capture so current evidence can replace this stale finding version",
      minimumTargetPx: 48,
    },
  ];
}
