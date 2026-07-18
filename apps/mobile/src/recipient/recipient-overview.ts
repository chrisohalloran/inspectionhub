import type { CoverageLedger } from "@inspection/domain/inspection/mobile";

import type {
  ModuleApprovalBinding,
  ModuleApprovalInspectorAuthority,
} from "../capture/types";
import {
  approvalReviewVersions,
  isModuleApprovalInspectorAuthority,
  moduleCoverageRevision,
  verifyApprovalBinding,
} from "../completion/approval-binding";
import { canonicalJson } from "../integrity/canonical-json";
import type { InvestigationReviewItem } from "../review/investigation-review";

type Module = "building" | "timber_pest";
type Digest = (payload: string) => Promise<string>;

export type RecipientInspectorAuthority = Readonly<
  Omit<ModuleApprovalInspectorAuthority, "inspectorId">
>;

type RecipientMaterialLimitation = Readonly<{
  areaId: string;
  areaLabel: string;
  description: string;
  limitationId: string;
  recordedAt: string;
}>;

/**
 * Protected package authority. It binds recipient identity and exact accepted
 * review versions without placing private evidence identifiers in the
 * recipient-safe projection.
 */
export type RecipientPackageSnapshot = Readonly<{
  schemaVersion: "field-recipient-package-v4";
  reportVersionId: string;
  organizationId: string;
  jobId: string;
  propertyLabel: string;
  issuedAt: string;
  canonicalHash: string;
  coverageIdentity: Readonly<{
    organizationId: string;
    jobId: string;
    ledgerRevision: number;
  }>;
  modules: readonly Readonly<{
    module: Module;
    moduleId: string;
    coverageRevision: number;
    approvalSnapshotSha256: string;
    approvingInspectorId: string;
    inspector: RecipientInspectorAuthority;
    materialLimitations: readonly RecipientMaterialLimitation[];
    findings: readonly Readonly<{
      reviewId: string;
      findingId: string;
      versionId: string;
      contentHash: string;
      packetId: string;
      packetHash: string;
      evidenceSourceCount: number;
    }>[];
  }>[];
}>;

export type RecipientOverviewProjection = Readonly<{
  reportVersionId: string;
  propertyLabel: string;
  issuedAt: string;
  modules: readonly Readonly<{
    module: Module;
    inspector: RecipientInspectorAuthority;
    materialLimitations: readonly Readonly<{
      areaLabel: string;
      description: string;
      recordedAt: string;
    }>[];
    findings: readonly Readonly<{
      location: string;
      observation: string;
      apparentExtent: string;
      qualifiedOpinion: string;
      uncertainty: readonly string[];
      furtherInvestigation: string | null;
      classification: string;
      evidenceSourceCount: number;
    }>[];
  }>[];
}>;

export async function createRecipientPackageSnapshot(input: {
  readonly approvalBindings: readonly ModuleApprovalBinding[];
  readonly commissionedModules: readonly Module[];
  readonly coverage: CoverageLedger;
  readonly digest: Digest;
  readonly issuedAt: string;
  readonly jobId: string;
  readonly organizationId: string;
  readonly propertyLabel: string;
  readonly reportVersionId: string;
  readonly reviewItems: readonly InvestigationReviewItem[];
}): Promise<RecipientPackageSnapshot> {
  const commissionedModules = new Set(input.commissionedModules);
  if (
    commissionedModules.size !== input.commissionedModules.length ||
    input.commissionedModules.length === 0
  ) {
    throw new Error("Recipient package requires unique commissioned modules");
  }
  if (
    !input.reportVersionId.trim() ||
    !input.organizationId.trim() ||
    !input.jobId.trim() ||
    !input.propertyLabel.trim() ||
    !Number.isFinite(Date.parse(input.issuedAt))
  ) {
    throw new Error("Recipient package requires exact report and job identity");
  }
  if (
    input.coverage.organizationId !== input.organizationId ||
    input.coverage.jobId !== input.jobId ||
    !Number.isSafeInteger(input.coverage.revision) ||
    input.coverage.revision < 0
  ) {
    throw new Error("Recipient package coverage belongs to a different job");
  }
  const coverageModules = input.coverage.commissionedModules.map(
    ({ module }) => module,
  );
  if (
    new Set(coverageModules).size !== coverageModules.length ||
    coverageModules.length !== input.commissionedModules.length ||
    input.commissionedModules.some(
      (module) => !coverageModules.includes(module),
    )
  ) {
    throw new Error(
      "Recipient package coverage must match the exact commissioned modules",
    );
  }
  if (
    input.approvalBindings.length !== input.commissionedModules.length ||
    new Set(input.approvalBindings.map((binding) => binding.module)).size !==
      input.approvalBindings.length ||
    input.approvalBindings.some(
      (binding) => !commissionedModules.has(binding.module),
    )
  ) {
    throw new Error(
      "Recipient package requires one approval per commissioned module",
    );
  }
  const reviewIds = new Set<string>();
  const findingIds = new Set<string>();
  for (const item of input.reviewItems) {
    if (
      !commissionedModules.has(item.module) ||
      item.finding.organizationId !== input.organizationId ||
      item.finding.jobId !== input.jobId ||
      reviewIds.has(item.reviewId) ||
      findingIds.has(item.finding.findingId)
    ) {
      throw new Error(
        "Recipient package reviews must be unique and belong to the exact commissioned job",
      );
    }
    reviewIds.add(item.reviewId);
    findingIds.add(item.finding.findingId);
  }
  const verifiedContentHashes = await Promise.all(
    input.reviewItems.map((item) =>
      input.digest(canonicalJson(item.finding.content)),
    ),
  );
  if (
    verifiedContentHashes.some(
      (hash, index) => hash !== input.reviewItems[index]?.finding.contentHash,
    )
  ) {
    throw new Error("Recipient package review content hash is invalid");
  }
  const modules = await Promise.all(
    input.commissionedModules.map(async (module) => {
      const binding = input.approvalBindings.find(
        (candidate) => candidate.module === module,
      );
      const findings = input.reviewItems.filter(
        (item) => item.module === module,
      );
      const moduleReference = input.coverage.commissionedModules.find(
        (candidate) => candidate.module === module,
      );
      const coverageRevision = moduleCoverageRevision(input.coverage, module);
      if (
        binding === undefined ||
        moduleReference === undefined ||
        binding.coverageRevision !== coverageRevision ||
        findings.length === 0 ||
        findings.some(
          (item) =>
            item.status !== "accepted" ||
            item.finding.moduleId !== moduleReference.moduleId,
        )
      ) {
        throw new Error(
          "Recipient package requires every current module finding, coverage revision and approval",
        );
      }
      const expectedVersions = approvalReviewVersions(findings, module);
      if (
        JSON.stringify(binding.reviewVersions) !==
        JSON.stringify(expectedVersions)
      ) {
        throw new Error(
          "Recipient package approval does not bind the exact accepted versions",
        );
      }
      if (
        !(await verifyApprovalBinding({
          binding,
          coverage: input.coverage,
          digest: input.digest,
          jobId: input.jobId,
          module,
          reviewItems: input.reviewItems,
        }))
      ) {
        throw new Error(
          "Recipient package approval hash does not bind the exact approving inspector",
        );
      }
      if (!isModuleApprovalInspectorAuthority(binding.approvingInspector)) {
        throw new Error(
          "Recipient package requires exact approving inspector authority",
        );
      }
      const inspector = recipientInspectorAuthority(binding.approvingInspector);
      const limitationIds = new Set<string>();
      const materialLimitations = input.coverage.limitations
        .filter(
          (limitation) =>
            limitation.module === module &&
            limitation.status === "active" &&
            limitation.material,
        )
        .map((limitation) => {
          const area = input.coverage.areas.find(
            (candidate) => candidate.areaId === limitation.areaId,
          );
          if (
            area === undefined ||
            limitation.moduleId !== moduleReference.moduleId ||
            limitationIds.has(limitation.limitationId) ||
            !limitation.limitationId.trim() ||
            !limitation.description.trim() ||
            !Number.isFinite(Date.parse(limitation.recordedAt))
          ) {
            throw new Error(
              "Recipient package contains invalid material limitation authority",
            );
          }
          limitationIds.add(limitation.limitationId);
          return {
            areaId: limitation.areaId,
            areaLabel: area.label,
            description: limitation.description,
            limitationId: limitation.limitationId,
            recordedAt: limitation.recordedAt,
          } as const;
        })
        .sort(
          (left, right) =>
            left.areaLabel.localeCompare(right.areaLabel) ||
            left.limitationId.localeCompare(right.limitationId),
        );
      return {
        module,
        moduleId: moduleReference.moduleId,
        coverageRevision,
        approvalSnapshotSha256: binding.snapshotSha256,
        approvingInspectorId: binding.approvingInspector.inspectorId,
        inspector,
        materialLimitations,
        findings: findings.map((item) => ({
          reviewId: item.reviewId,
          findingId: item.finding.findingId,
          versionId: item.finding.versionId,
          contentHash: item.finding.contentHash,
          packetId: item.provenance.packetId,
          packetHash: item.provenance.packetHash,
          evidenceSourceCount:
            item.finding.authorship.sourceArtifactReferences.length,
        })),
      } as const;
    }),
  );
  const withoutHash = {
    schemaVersion: "field-recipient-package-v4" as const,
    reportVersionId: input.reportVersionId,
    organizationId: input.organizationId,
    jobId: input.jobId,
    propertyLabel: input.propertyLabel,
    issuedAt: input.issuedAt,
    coverageIdentity: {
      organizationId: input.coverage.organizationId,
      jobId: input.coverage.jobId,
      ledgerRevision: input.coverage.revision,
    },
    modules,
  };
  return deepFreeze({
    ...withoutHash,
    canonicalHash: await input.digest(canonicalJson(withoutHash)),
  });
}

export async function verifyRecipientPackageSnapshot(
  snapshot: RecipientPackageSnapshot,
  digest: Digest,
): Promise<boolean> {
  if (!isRecipientPackageSnapshot(snapshot)) return false;
  const { canonicalHash, ...withoutHash } = snapshot;
  return (
    /^[a-f0-9]{64}$/u.test(canonicalHash) &&
    (await digest(canonicalJson(withoutHash))) === canonicalHash
  );
}

/** Derives recipient-visible wording only from accepted review authority. */
export function projectRecipientOverview(input: {
  readonly packageSnapshot: RecipientPackageSnapshot;
  readonly reviewItems: readonly InvestigationReviewItem[];
}): RecipientOverviewProjection {
  if (!isRecipientPackageSnapshot(input.packageSnapshot)) {
    throw new Error("Recipient package structure is invalid");
  }
  const seenModules = new Set<Module>();
  const modules = input.packageSnapshot.modules.map((module) => {
    if (seenModules.has(module.module)) {
      throw new Error("Recipient package contains a duplicate module");
    }
    seenModules.add(module.module);
    const reviewItems = input.reviewItems.filter(
      (item) => item.module === module.module && item.status === "accepted",
    );
    const seenReviews = new Set<string>();
    if (reviewItems.length !== module.findings.length) {
      throw new Error(
        "Recipient package findings do not match review authority",
      );
    }
    const findings = module.findings.map((reference) => {
      if (seenReviews.has(reference.reviewId)) {
        throw new Error("Recipient package contains a duplicate finding");
      }
      seenReviews.add(reference.reviewId);
      const review = reviewItems.find(
        (item) =>
          item.reviewId === reference.reviewId &&
          item.finding.moduleId === module.moduleId &&
          item.finding.findingId === reference.findingId &&
          item.finding.versionId === reference.versionId &&
          item.finding.contentHash === reference.contentHash &&
          item.provenance.packetId === reference.packetId &&
          item.provenance.packetHash === reference.packetHash &&
          item.finding.authorship.sourceArtifactReferences.length ===
            reference.evidenceSourceCount,
      );
      if (review === undefined) {
        throw new Error(
          "Recipient package finding does not match exact review authority",
        );
      }
      return {
        location: review.finding.content.location,
        observation: review.finding.content.observation,
        apparentExtent: review.finding.content.apparentExtent,
        qualifiedOpinion: review.finding.content.qualifiedOpinion,
        uncertainty: review.finding.content.uncertainty,
        furtherInvestigation: review.finding.content.furtherInvestigation,
        classification:
          review.finding.content.module === "building"
            ? review.finding.content.classification
            : review.finding.content.category,
        evidenceSourceCount: reference.evidenceSourceCount,
      } as const;
    });
    return {
      module: module.module,
      inspector: module.inspector,
      materialLimitations: module.materialLimitations.map((limitation) => ({
        areaLabel: limitation.areaLabel,
        description: limitation.description,
        recordedAt: limitation.recordedAt,
      })),
      findings,
    } as const;
  });
  return deepFreeze({
    reportVersionId: input.packageSnapshot.reportVersionId,
    propertyLabel: input.packageSnapshot.propertyLabel,
    issuedAt: input.packageSnapshot.issuedAt,
    modules,
  });
}

export function isRecipientPackageSnapshot(
  value: unknown,
): value is RecipientPackageSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const coverageIdentity = candidate.coverageIdentity;
  if (
    candidate.schemaVersion !== "field-recipient-package-v4" ||
    !isNonEmptyString(candidate.reportVersionId) ||
    !isNonEmptyString(candidate.organizationId) ||
    !isNonEmptyString(candidate.jobId) ||
    !isNonEmptyString(candidate.propertyLabel) ||
    !isTimestamp(candidate.issuedAt) ||
    !isDigest(candidate.canonicalHash) ||
    typeof coverageIdentity !== "object" ||
    coverageIdentity === null
  ) {
    return false;
  }
  const coverage = coverageIdentity as Record<string, unknown>;
  if (
    coverage.organizationId !== candidate.organizationId ||
    coverage.jobId !== candidate.jobId ||
    !isNonNegativeInteger(coverage.ledgerRevision) ||
    !Array.isArray(candidate.modules) ||
    candidate.modules.length === 0
  ) {
    return false;
  }
  const modules = candidate.modules as unknown[];
  const moduleNames = new Set<string>();
  const moduleIds = new Set<string>();
  const reviewIds = new Set<string>();
  const findingIds = new Set<string>();
  const limitationIds = new Set<string>();
  return modules.every((value) => {
    if (typeof value !== "object" || value === null) return false;
    const module = value as Record<string, unknown>;
    if (
      (module.module !== "building" && module.module !== "timber_pest") ||
      moduleNames.has(module.module) ||
      !isNonEmptyString(module.moduleId) ||
      moduleIds.has(module.moduleId) ||
      !isNonNegativeInteger(module.coverageRevision) ||
      module.coverageRevision > (coverage.ledgerRevision as number) ||
      !isDigest(module.approvalSnapshotSha256) ||
      !isNonEmptyString(module.approvingInspectorId) ||
      !isInspectorAuthority(module.inspector) ||
      !Array.isArray(module.materialLimitations) ||
      !Array.isArray(module.findings) ||
      module.findings.length === 0
    ) {
      return false;
    }
    moduleNames.add(module.module);
    moduleIds.add(module.moduleId);
    if (
      !module.materialLimitations.every((limitation) => {
        if (typeof limitation !== "object" || limitation === null) return false;
        const item = limitation as Record<string, unknown>;
        if (
          !isNonEmptyString(item.areaId) ||
          !isNonEmptyString(item.areaLabel) ||
          !isNonEmptyString(item.description) ||
          !isNonEmptyString(item.limitationId) ||
          limitationIds.has(item.limitationId) ||
          !isTimestamp(item.recordedAt)
        ) {
          return false;
        }
        limitationIds.add(item.limitationId);
        return true;
      })
    ) {
      return false;
    }
    return module.findings.every((finding) => {
      if (typeof finding !== "object" || finding === null) return false;
      const item = finding as Record<string, unknown>;
      if (
        !isNonEmptyString(item.reviewId) ||
        reviewIds.has(item.reviewId) ||
        !isNonEmptyString(item.findingId) ||
        findingIds.has(item.findingId) ||
        !isNonEmptyString(item.versionId) ||
        !isDigest(item.contentHash) ||
        !isNonEmptyString(item.packetId) ||
        !isDigest(item.packetHash) ||
        !isNonNegativeInteger(item.evidenceSourceCount)
      ) {
        return false;
      }
      reviewIds.add(item.reviewId);
      findingIds.add(item.findingId);
      return true;
    });
  });
}

function isInspectorAuthority(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.displayName) &&
    isNonEmptyString(candidate.credential) &&
    isTimestamp(candidate.confirmedAt) &&
    (candidate.authority === "synthetic_fixture" ||
      candidate.authority === "verified_profile")
  );
}

function recipientInspectorAuthority(
  value: ModuleApprovalInspectorAuthority,
): RecipientInspectorAuthority {
  return {
    authority: value.authority,
    confirmedAt: value.confirmedAt,
    credential: value.credential,
    displayName: value.displayName,
  };
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
