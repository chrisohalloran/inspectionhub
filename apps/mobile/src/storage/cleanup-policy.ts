export type LocalOriginalCleanupInput = {
  disputeOrProfessionalHold: boolean;
  referencedByRetainedRecord: boolean;
  retentionEligible: boolean;
  serverDurable: boolean;
};

export function canDeleteLocalOriginal(input: LocalOriginalCleanupInput):
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "evidence_hold"
        | "not_retention_eligible"
        | "not_server_durable"
        | "retained_reference";
    } {
  if (!input.serverDurable) {
    return { allowed: false, reason: "not_server_durable" };
  }
  if (!input.retentionEligible) {
    return { allowed: false, reason: "not_retention_eligible" };
  }
  if (input.disputeOrProfessionalHold) {
    return { allowed: false, reason: "evidence_hold" };
  }
  if (input.referencedByRetainedRecord) {
    return { allowed: false, reason: "retained_reference" };
  }
  return { allowed: true };
}
