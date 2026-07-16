import { getSyncRuntime, syncError } from "../../_shared/runtime";

export async function PUT(
  request: Request,
  context: { params: Promise<{ intentId: string }> },
): Promise<Response> {
  try {
    const { intentId } = await context.params;
    const token = request.headers.get("x-upload-token");
    const mediaType = request.headers.get("content-type");
    if (token === null || mediaType === null) {
      throw new Error("Upload token and content type are required");
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    const result = await getSyncRuntime().sync.upload(
      intentId,
      token,
      bytes,
      mediaType,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    return syncError(error);
  }
}
