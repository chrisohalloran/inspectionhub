import type { ModuleType } from "@inspection/contracts";

import type { FieldSessionSnapshot } from "../capture/types";

export type FieldJobContext = Readonly<{
  commissionedModules: FieldSessionSnapshot["commissionedModules"];
  commissionedModuleTypes: readonly ModuleType[];
  jobId: string;
  organizationId: string;
  propertyLabel: string;
}>;

/** Projects the exact assigned-job identity carried by the durable session. */
export function fieldJobContext(
  session: FieldSessionSnapshot,
): FieldJobContext {
  return {
    commissionedModules: session.commissionedModules.map((reference) => ({
      ...reference,
    })),
    commissionedModuleTypes: session.commissionedModules.map(
      ({ module }) => module,
    ),
    jobId: session.jobId,
    organizationId: session.organizationId,
    propertyLabel: session.propertyLabel,
  };
}
