export type ReportCapabilityAction =
  | "view_html"
  | "view_pdf"
  | "view_media"
  | "download"
  | "view_history"
  | "share";

export type ReportCapability = {
  readonly grantId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly reportVersionId: string;
  readonly moduleIds: readonly string[];
  readonly actions: readonly ReportCapabilityAction[];
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly roleActive: boolean;
  readonly canDelegate: boolean;
};

export function authorizeReportCapability(input: {
  readonly capability: ReportCapability;
  readonly organizationId: string;
  readonly actorId: string;
  readonly reportVersionId: string;
  readonly moduleId: string;
  readonly action: ReportCapabilityAction;
  readonly now: string;
}): boolean {
  const capability = input.capability;
  const expiresAt = Date.parse(capability.expiresAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) {
    return false;
  }
  if (
    capability.organizationId !== input.organizationId ||
    capability.actorId !== input.actorId ||
    capability.reportVersionId !== input.reportVersionId ||
    !capability.moduleIds.includes(input.moduleId) ||
    !capability.actions.includes(input.action) ||
    !capability.roleActive ||
    capability.revokedAt !== null ||
    expiresAt <= now
  ) {
    return false;
  }
  if (input.action === "share" && !capability.canDelegate) {
    return false;
  }
  return true;
}
