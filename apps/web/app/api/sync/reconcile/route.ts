import { reconcileEvidence } from "@inspection/storage";

import {
  authenticateLocalSyncRequest,
  getSyncRuntime,
  syncError,
} from "../_shared/runtime";

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = authenticateLocalSyncRequest(request);
    const runtime = getSyncRuntime();
    const findings = await reconcileEvidence({
      organizationId: principal.organizationId,
      store: runtime.store,
      repository: runtime.repository,
    });
    return Response.json({ findings });
  } catch (error) {
    return syncError(error);
  }
}
