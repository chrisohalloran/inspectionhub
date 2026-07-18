import type { ModuleType } from "@inspection/contracts";

import { DomainConflictError } from "../errors.js";
import { deepFreeze } from "../freeze.js";
import type {
  AreaCoverageState,
  CoverageCompletionIssue,
  CoverageEntry,
  CoverageLedger,
  InspectionArea,
} from "./types.js";

export function createCoverageLedger(input: {
  readonly organizationId: string;
  readonly jobId: string;
  readonly commissionedModules: CoverageLedger["commissionedModules"];
  readonly areas: readonly InspectionArea[];
}): CoverageLedger {
  if (input.areas.length === 0) {
    throw new DomainConflictError(
      "coverage_has_no_area",
      "Coverage requires at least one inspection area",
    );
  }
  if (input.commissionedModules.length === 0) {
    throw new DomainConflictError(
      "coverage_has_no_module",
      "Coverage requires at least one commissioned professional module",
    );
  }
  if (
    new Set(input.commissionedModules.map((reference) => reference.module))
      .size !== input.commissionedModules.length ||
    new Set(input.commissionedModules.map((reference) => reference.moduleId))
      .size !== input.commissionedModules.length
  ) {
    throw new DomainConflictError(
      "duplicate_commissioned_module",
      "Commissioned module types and identities must both be unique",
    );
  }
  const areaIds = new Set<string>();
  for (const area of input.areas) {
    if (areaIds.has(area.areaId)) {
      throw new DomainConflictError(
        "duplicate_area",
        "Coverage area identities must be unique",
      );
    }
    areaIds.add(area.areaId);
    if (area.applicableModules.length === 0) {
      throw new DomainConflictError(
        "coverage_area_has_no_module",
        "Each inspection area requires at least one applicable commissioned module",
      );
    }
    for (const module of area.applicableModules) {
      if (
        !input.commissionedModules.some(
          (reference) => reference.module === module,
        )
      ) {
        throw new DomainConflictError(
          "area_module_not_commissioned",
          "An area cannot require coverage for an uncommissioned module",
          { areaId: area.areaId, module },
        );
      }
    }
  }
  return deepFreeze({
    organizationId: input.organizationId,
    jobId: input.jobId,
    commissionedModules: [...input.commissionedModules],
    areas: [...input.areas],
    revision: 0,
    entries: [],
    limitations: [],
    revisitItems: [],
  });
}

type CoverageCommand = {
  readonly expectedRevision: number;
  readonly coverageEntryId: string;
  readonly areaId: string;
  readonly module: ModuleType;
  readonly state: AreaCoverageState;
  readonly detail?: string;
  readonly material?: boolean;
  readonly recordedAt: string;
  readonly inspectorId: string;
  readonly limitationId?: string;
  readonly revisitItemId?: string;
};

export function recordAreaCoverage(
  ledger: CoverageLedger,
  command: CoverageCommand,
): CoverageLedger {
  assertRevision(ledger.revision, command.expectedRevision);
  const area = ledger.areas.find(
    (candidate) => candidate.areaId === command.areaId,
  );
  if (area === undefined) {
    throw new DomainConflictError(
      "coverage_area_unknown",
      "Coverage can be recorded only for a known inspection area",
    );
  }
  const moduleReference = ledger.commissionedModules.find(
    (reference) => reference.module === command.module,
  );
  if (moduleReference === undefined) {
    throw new DomainConflictError(
      "coverage_module_not_commissioned",
      "Coverage cannot be recorded for an uncommissioned professional module",
    );
  }
  if (
    !area.applicableModules.includes(command.module) &&
    command.state !== "not_applicable"
  ) {
    throw new DomainConflictError(
      "coverage_module_not_applicable",
      "This professional module is not applicable to the selected area",
    );
  }
  const detail = command.detail?.trim() ?? "";
  const limited =
    command.state === "access_limited" || command.state === "inaccessible";
  if (
    (limited ||
      command.state === "revisit" ||
      command.state === "not_applicable") &&
    detail.length === 0
  ) {
    throw new DomainConflictError(
      "coverage_detail_required",
      `${command.state} coverage requires an inspector-written reason`,
    );
  }
  if (limited && command.limitationId === undefined) {
    throw new DomainConflictError(
      "limitation_required",
      "Access-limited and inaccessible areas require an explicit module limitation",
    );
  }
  if (command.state === "revisit" && command.revisitItemId === undefined) {
    throw new DomainConflictError(
      "revisit_item_required",
      "A revisit coverage state must create a visible revisit item",
    );
  }

  const priorEntries = ledger.entries.filter(
    (entry) =>
      entry.areaId === command.areaId &&
      entry.moduleId === moduleReference.moduleId,
  );
  const nextEntry: CoverageEntry = {
    areaId: command.areaId,
    coverageEntryId: command.coverageEntryId,
    module: command.module,
    moduleId: moduleReference.moduleId,
    state: command.state,
    detail: detail.length > 0 ? detail : null,
    recordedAt: command.recordedAt,
    recordedByInspectorId: command.inspectorId,
    revision: priorEntries.length + 1,
  };
  const limitations = ledger.limitations.map((limitation) =>
    limitation.areaId === command.areaId &&
    limitation.moduleId === moduleReference.moduleId &&
    limitation.status === "active"
      ? {
          ...limitation,
          status: "superseded" as const,
          supersededAt: command.recordedAt,
        }
      : limitation,
  );
  if (limited) {
    limitations.push({
      areaId: command.areaId,
      limitationId: command.limitationId!,
      module: command.module,
      moduleId: moduleReference.moduleId,
      description: detail,
      material: command.material ?? true,
      recordedAt: command.recordedAt,
      status: "active",
      supersededAt: null,
    });
  }
  const revisitItems = ledger.revisitItems.map((item) =>
    item.areaId === command.areaId &&
    item.moduleId === moduleReference.moduleId &&
    item.status === "open"
      ? { ...item, status: "resolved" as const, resolvedAt: command.recordedAt }
      : item,
  );
  if (command.state === "revisit") {
    revisitItems.push({
      areaId: command.areaId,
      module: command.module,
      moduleId: moduleReference.moduleId,
      reason: detail,
      revisitItemId: command.revisitItemId!,
      openedAt: command.recordedAt,
      status: "open",
      resolvedAt: null,
    });
  }
  return deepFreeze({
    ...ledger,
    revision: ledger.revision + 1,
    entries: [...ledger.entries, nextEntry],
    limitations,
    revisitItems,
  });
}

export function currentCoverageEntries(
  ledger: CoverageLedger,
): readonly CoverageEntry[] {
  const latest = new Map<string, CoverageEntry>();
  for (const entry of ledger.entries) {
    latest.set(coverageKey(entry.moduleId, entry.areaId), entry);
  }
  return [...latest.values()].sort(
    (a, b) =>
      a.areaId.localeCompare(b.areaId) || a.module.localeCompare(b.module),
  );
}

export function coverageCompletionIssues(
  ledger: CoverageLedger,
): readonly CoverageCompletionIssue[] {
  const current = new Map(
    currentCoverageEntries(ledger).map((entry) => [
      coverageKey(entry.moduleId, entry.areaId),
      entry,
    ]),
  );
  const issues: CoverageCompletionIssue[] = [];
  for (const area of ledger.areas) {
    for (const module of area.applicableModules) {
      const moduleReference = ledger.commissionedModules.find(
        (reference) => reference.module === module,
      );
      if (moduleReference === undefined) {
        continue;
      }
      if (!current.has(coverageKey(moduleReference.moduleId, area.areaId))) {
        issues.push({
          areaId: area.areaId,
          module,
          moduleId: moduleReference.moduleId,
          reason: "coverage_not_recorded",
        });
      }
    }
  }
  for (const item of ledger.revisitItems) {
    if (item.status === "open") {
      issues.push({
        areaId: item.areaId,
        module: item.module,
        moduleId: item.moduleId,
        reason: "revisit_open",
      });
    }
  }
  return issues;
}

function coverageKey(moduleId: string, areaId: string): string {
  return JSON.stringify([moduleId, areaId]);
}

function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new DomainConflictError(
      "revision_conflict",
      "Coverage changed on another screen or device; refresh and compare before retrying",
      { actual, expected },
    );
  }
}
