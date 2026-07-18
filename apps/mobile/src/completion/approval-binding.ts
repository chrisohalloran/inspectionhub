import type { ModuleApprovalBinding } from "../capture/types";
import type { InvestigationReviewItem } from "../review/investigation-review";
import type { FindingContent } from "@inspection/contracts";
import {
  currentCoverageEntries,
  type CoverageLedger,
} from "@inspection/domain/inspection/mobile";

import { canonicalJson } from "../integrity/canonical-json";

type Module = ModuleApprovalBinding["module"];

export function deliveryPackageManifestPayload(input: {
  readonly approvalBindings: readonly ModuleApprovalBinding[];
  readonly commissionedModules: readonly Module[];
  readonly jobId: string;
  readonly recipientPackageHash: string;
  readonly reviewItems: readonly InvestigationReviewItem[];
}): string {
  if (!/^[a-f0-9]{64}$/u.test(input.recipientPackageHash)) {
    throw new Error("Delivery package requires a hash-bound recipient package");
  }
  const commissioned = [...input.commissionedModules].sort();
  const approvalBindings = input.approvalBindings
    .filter((binding) => commissioned.includes(binding.module))
    .sort((left, right) => left.module.localeCompare(right.module));
  if (
    new Set(commissioned).size !== commissioned.length ||
    approvalBindings.length !== commissioned.length ||
    commissioned.some(
      (module) =>
        !approvalBindings.some((binding) => binding.module === module),
    )
  ) {
    throw new Error(
      "Delivery package requires one exact approval per commissioned module",
    );
  }
  return canonicalJson({
    approvalBindings,
    jobId: input.jobId,
    modules: commissioned,
    recipientPackageHash: input.recipientPackageHash,
    reviewVersions: input.reviewItems
      .filter(
        (item) =>
          item.status === "accepted" && commissioned.includes(item.module),
      )
      .map((item) => ({
        contentHash: item.finding.contentHash,
        module: item.module,
        reviewId: item.reviewId,
        versionId: item.finding.versionId,
      }))
      .sort((left, right) => left.reviewId.localeCompare(right.reviewId)),
  });
}

export function approvalSnapshotPayload(input: {
  readonly approvingInspector: ModuleApprovalBinding["approvingInspector"];
  readonly coverage: CoverageLedger;
  readonly jobId: string;
  readonly module: Module;
  readonly reviewItems: readonly InvestigationReviewItem[];
}): string {
  if (!isModuleApprovalInspectorAuthority(input.approvingInspector)) {
    throw new Error("Approval requires exact inspector authority");
  }
  if (input.coverage.jobId !== input.jobId) {
    throw new Error("Approval coverage belongs to a different job");
  }
  const moduleReference = input.coverage.commissionedModules.find(
    (reference) => reference.module === input.module,
  );
  if (moduleReference === undefined) {
    throw new Error("Approval module is not commissioned for this job");
  }
  const moduleItems = input.reviewItems.filter(
    (item) => item.module === input.module,
  );
  if (
    moduleItems.some(
      (item) =>
        item.finding.jobId !== input.jobId ||
        item.finding.organizationId !== input.coverage.organizationId ||
        item.finding.moduleId !== moduleReference.moduleId,
    )
  ) {
    throw new Error(
      "Approval findings do not belong to the exact job and professional module",
    );
  }
  return canonicalJson({
    activeLimitations: input.coverage.limitations
      .filter(
        (limitation) =>
          limitation.module === input.module && limitation.status === "active",
      )
      .map((limitation) => ({
        areaId: limitation.areaId,
        description: limitation.description,
        limitationId: limitation.limitationId,
        material: limitation.material,
        moduleId: limitation.moduleId,
        recordedAt: limitation.recordedAt,
      }))
      .sort((left, right) => left.areaId.localeCompare(right.areaId)),
    applicableAreas: input.coverage.areas
      .filter((area) => area.applicableModules.includes(input.module))
      .map((area) => ({ areaId: area.areaId, label: area.label }))
      .sort((left, right) => left.areaId.localeCompare(right.areaId)),
    coverageEntries: currentCoverageEntries(input.coverage)
      .filter((entry) => entry.module === input.module)
      .map((entry) => ({
        areaId: entry.areaId,
        coverageEntryId: entry.coverageEntryId,
        detail: entry.detail,
        moduleId: entry.moduleId,
        recordedAt: entry.recordedAt,
        recordedByInspectorId: entry.recordedByInspectorId,
        revision: entry.revision,
        state: entry.state,
      })),
    jobId: input.jobId,
    module: input.module,
    moduleId: moduleReference.moduleId,
    openRevisitItems: input.coverage.revisitItems
      .filter((item) => item.module === input.module && item.status === "open")
      .map((item) => ({
        areaId: item.areaId,
        moduleId: item.moduleId,
        openedAt: item.openedAt,
        reason: item.reason,
        revisitItemId: item.revisitItemId,
      }))
      .sort((left, right) => left.areaId.localeCompare(right.areaId)),
    organizationId: input.coverage.organizationId,
    approvingInspector: input.approvingInspector,
    reviewAuthority: acceptedReviewAuthority(input.reviewItems, input.module),
  });
}

export function findingContentPayload(content: FindingContent): string {
  return canonicalJson(content);
}

export async function verifyAcceptedReviewContentHashes(input: {
  readonly digest: (payload: string) => Promise<string>;
  readonly module: Module;
  readonly reviewItems: readonly InvestigationReviewItem[];
}): Promise<boolean> {
  const items = input.reviewItems.filter(
    (item) => item.module === input.module,
  );
  if (items.length === 0 || items.some((item) => item.status !== "accepted")) {
    return false;
  }
  const hashes = await Promise.all(
    items.map((item) =>
      input.digest(findingContentPayload(item.finding.content)),
    ),
  );
  return hashes.every(
    (hash, index) => hash === items[index]?.finding.contentHash,
  );
}

export async function verifyApprovalBinding(input: {
  readonly binding: ModuleApprovalBinding | undefined;
  readonly coverage: CoverageLedger;
  readonly digest: (payload: string) => Promise<string>;
  readonly jobId: string;
  readonly module: Module;
  readonly reviewItems: readonly InvestigationReviewItem[];
}): Promise<boolean> {
  if (
    !approvalBindingMatches({
      binding: input.binding,
      coverageRevision: moduleCoverageRevision(input.coverage, input.module),
      module: input.module,
      reviewItems: input.reviewItems,
    }) ||
    input.binding === undefined
  ) {
    return false;
  }
  try {
    if (
      !(await verifyAcceptedReviewContentHashes({
        digest: input.digest,
        module: input.module,
        reviewItems: input.reviewItems,
      }))
    ) {
      return false;
    }
    const expectedSha256 = await input.digest(
      approvalSnapshotPayload({
        approvingInspector: input.binding.approvingInspector,
        coverage: input.coverage,
        jobId: input.jobId,
        module: input.module,
        reviewItems: input.reviewItems,
      }),
    );
    return expectedSha256 === input.binding.snapshotSha256;
  } catch {
    return false;
  }
}

function acceptedReviewAuthority(
  reviewItems: readonly InvestigationReviewItem[],
  module: Module,
): readonly InvestigationReviewItem[] {
  return reviewItems
    .filter((item) => item.module === module && item.status === "accepted")
    .sort((left, right) => left.reviewId.localeCompare(right.reviewId));
}

export function moduleCoverageRevision(
  coverage: CoverageLedger,
  module: Module,
): number {
  return coverage.entries.filter((entry) => entry.module === module).length;
}

export function approvalReviewVersions(
  reviewItems: readonly InvestigationReviewItem[],
  module: Module,
): ModuleApprovalBinding["reviewVersions"] {
  return reviewItems
    .filter((item) => item.module === module && item.status === "accepted")
    .map((item) => ({
      contentHash: item.finding.contentHash,
      reviewId: item.reviewId,
      versionId: item.finding.versionId,
    }))
    .sort((left, right) => left.reviewId.localeCompare(right.reviewId));
}

export function approvalBindingMatches(input: {
  binding: ModuleApprovalBinding | undefined;
  coverageRevision: number | undefined;
  module: Module;
  reviewItems: readonly InvestigationReviewItem[];
}): boolean {
  const { binding } = input;
  if (
    binding === undefined ||
    !isModuleApprovalInspectorAuthority(binding.approvingInspector) ||
    input.coverageRevision === undefined ||
    binding.module !== input.module ||
    binding.coverageRevision !== input.coverageRevision
  ) {
    return false;
  }
  const moduleItems = input.reviewItems.filter(
    (item) => item.module === input.module,
  );
  const current = approvalReviewVersions(input.reviewItems, input.module);
  return (
    moduleItems.length > 0 &&
    moduleItems.every((item) => item.status === "accepted") &&
    JSON.stringify(binding.reviewVersions) === JSON.stringify(current)
  );
}

export function isModuleApprovalInspectorAuthority(
  value: unknown,
): value is ModuleApprovalBinding["approvingInspector"] {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.inspectorId) &&
    isNonEmptyString(candidate.displayName) &&
    isNonEmptyString(candidate.credential) &&
    typeof candidate.confirmedAt === "string" &&
    Number.isFinite(Date.parse(candidate.confirmedAt)) &&
    (candidate.authority === "synthetic_fixture" ||
      candidate.authority === "verified_profile")
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
