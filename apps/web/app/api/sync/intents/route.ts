import type { UploadDescriptor } from "@inspection/storage";

import {
  authenticateLocalSyncRequest,
  getSyncRuntime,
  syncError,
} from "../_shared/runtime";

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = authenticateLocalSyncRequest(request);
    const descriptor = (await request.json()) as UploadDescriptor;
    const intent = getSyncRuntime().sync.issueUploadIntent(
      principal,
      descriptor,
    );
    return Response.json({ intent }, { status: 201 });
  } catch (error) {
    return syncError(error);
  }
}
