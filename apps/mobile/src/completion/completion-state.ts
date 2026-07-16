export type ModuleCompletion = Readonly<{
  module: "building" | "timber_pest";
  label: "Building" | "Timber Pest";
  reviewComplete: boolean;
  approvalState: "not_ready" | "ready" | "approved" | "withdrawn";
  snapshotRevision: number | null;
  approvalSnapshotRevision: number | null;
  unresolvedChecks: number;
}>;

export type CompletionProjection = Readonly<{
  modules: readonly ModuleCompletion[];
  manualMode: boolean;
  canConfirmPackage: boolean;
  primaryStatus: string;
  blockers: readonly string[];
}>;

export function projectCompletion(
  input: Readonly<{
    commissionedModules: readonly ("building" | "timber_pest")[];
    modules: readonly ModuleCompletion[];
    aiAvailable: boolean;
  }>,
): CompletionProjection {
  const commissioned = input.commissionedModules.map((module) => {
    const state = input.modules.find(
      (candidate) => candidate.module === module,
    );
    if (state === undefined) {
      throw new Error(
        `Missing completion state for commissioned ${module} module`,
      );
    }
    return state;
  });
  const blockers = commissioned.flatMap((module) => {
    const reasons: string[] = [];
    if (!module.reviewComplete)
      reasons.push(`${module.label}: review incomplete`);
    if (module.unresolvedChecks > 0)
      reasons.push(
        `${module.label}: ${module.unresolvedChecks} unresolved check(s)`,
      );
    if (module.approvalState !== "approved")
      reasons.push(
        `${module.label}: ${module.approvalState.replaceAll("_", " ")}`,
      );
    if (
      module.approvalState === "approved" &&
      module.snapshotRevision !== module.approvalSnapshotRevision
    ) {
      reasons.push(`${module.label}: approval is stale`);
    }
    return reasons;
  });
  const canConfirmPackage = blockers.length === 0;
  return {
    modules: commissioned,
    manualMode: !input.aiAvailable,
    canConfirmPackage,
    primaryStatus: canConfirmPackage
      ? "Both commissioned modules are independently approved"
      : !input.aiAvailable
        ? "AI unavailable — complete findings manually"
        : "Resolve module review and approval",
    blockers,
  };
}
