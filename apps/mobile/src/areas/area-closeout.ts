import {
  coverageCompletionIssues,
  recordAreaCoverage,
  type AreaCoverageState,
  type CoverageLedger,
} from "@inspection/domain/inspection/mobile";

type ModuleType = CoverageLedger["commissionedModules"][number]["module"];

export type AreaCloseoutInput = {
  readonly coverageEntryId: string;
  readonly areaId: string;
  readonly module: ModuleType;
  readonly state: AreaCoverageState;
  readonly detail?: string;
  readonly limitationId?: string;
  readonly revisitItemId?: string;
  readonly material?: boolean;
  readonly recordedAt: string;
  readonly inspectorId: string;
};

export function closeOutArea(
  ledger: CoverageLedger,
  input: AreaCloseoutInput,
): {
  readonly ledger: CoverageLedger;
  readonly remainingIssueCount: number;
  readonly announcement: string;
} {
  const next = recordAreaCoverage(ledger, {
    expectedRevision: ledger.revision,
    ...input,
  });
  const remainingIssueCount = coverageCompletionIssues(next).length;
  const stateLabel = input.state.replaceAll("_", " ");
  return {
    ledger: next,
    remainingIssueCount,
    announcement: `${input.module === "building" ? "Building" : "Timber Pest"} coverage recorded as ${stateLabel}. ${remainingIssueCount} coverage items remain.`,
  };
}
