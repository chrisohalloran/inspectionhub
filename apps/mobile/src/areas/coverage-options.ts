import { theme } from "@inspection/theme/tokens";
import type {
  AreaCoverageState,
  CoverageEntry,
  CoverageLedger,
} from "@inspection/domain/inspection/mobile";

export type CoverageOption = {
  readonly state: AreaCoverageState;
  readonly label: string;
  readonly hint: string;
  readonly requiresDetail: boolean;
  readonly createsLimitation: boolean;
  readonly createsRevisitItem: boolean;
  readonly minimumTargetSize: number;
};

export const coverageOptions: readonly CoverageOption[] = [
  {
    state: "inspected",
    label: "Inspected",
    hint: "Records the inspector's visual coverage judgement for this area and module",
    requiresDetail: false,
    createsLimitation: false,
    createsRevisitItem: false,
    minimumTargetSize: theme.target.minimum,
  },
  {
    state: "access_limited",
    label: "Access limited",
    hint: "Requires a clear limitation describing what could not be visually inspected",
    requiresDetail: true,
    createsLimitation: true,
    createsRevisitItem: false,
    minimumTargetSize: theme.target.minimum,
  },
  {
    state: "inaccessible",
    label: "Inaccessible",
    hint: "Requires a clear limitation for the inaccessible area",
    requiresDetail: true,
    createsLimitation: true,
    createsRevisitItem: false,
    minimumTargetSize: theme.target.minimum,
  },
  {
    state: "not_applicable",
    label: "Not applicable",
    hint: "Requires the inspector's reason that this area does not apply",
    requiresDetail: true,
    createsLimitation: false,
    createsRevisitItem: false,
    minimumTargetSize: theme.target.minimum,
  },
  {
    state: "revisit",
    label: "Revisit",
    hint: "Creates an open revisit item until the inspector records a later judgement",
    requiresDetail: true,
    createsLimitation: false,
    createsRevisitItem: true,
    minimumTargetSize: theme.target.minimum,
  },
] as const;

export function describeCoverageEntry(entry: CoverageEntry): string {
  const option = coverageOptions.find(
    (candidate) => candidate.state === entry.state,
  );
  const base = `${entry.module === "building" ? "Building" : "Timber Pest"}: ${option?.label ?? entry.state}`;
  return entry.detail === null ? base : `${base}. ${entry.detail}`;
}

export function areaCoverageSummary(
  ledger: CoverageLedger,
  areaId: string,
): readonly string[] {
  const latest = new Map<string, CoverageEntry>();
  for (const entry of ledger.entries) {
    if (entry.areaId === areaId) {
      latest.set(entry.module, entry);
    }
  }
  return [...latest.values()]
    .sort((a, b) => a.module.localeCompare(b.module))
    .map(describeCoverageEntry);
}
