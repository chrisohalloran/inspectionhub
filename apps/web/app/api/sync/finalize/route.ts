import {
  authenticateLocalSyncRequest,
  getSyncRuntime,
  syncError,
} from "../_shared/runtime";

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = authenticateLocalSyncRequest(request);
    const body = (await request.json()) as {
      readonly intentId?: string;
      readonly uploadToken?: string;
    };
    if (body.intentId === undefined || body.uploadToken === undefined) {
      throw new Error("Finalisation intent and upload token are required");
    }
    const result = await getSyncRuntime().sync.finalize(
      principal,
      body.intentId,
      body.uploadToken,
    );
    return Response.json({
      result,
      contentState: "durable_pending_quarantine_validation",
    });
  } catch (error) {
    return syncError(error);
  }
}
