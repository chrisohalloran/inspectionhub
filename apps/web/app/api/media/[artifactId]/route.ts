import { NextResponse } from "next/server";

import { curatedDemoMedia } from "../../../(reports)/reports/_lib/safe-demo-media";
import {
  authorisePortalRequest,
  readPortalSession,
} from "../../../(reports)/reports/_lib/recipient-session";

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await context.params;
  const media = curatedDemoMedia(artifactId);
  if (media === null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const session = await readPortalSession();
  try {
    await authorisePortalRequest(session, {
      reportVersionId: media.reportVersionId,
      module: media.module,
      action: "view_curated_media",
    });
  } catch {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }

  const full = Buffer.from(media.bytes);
  const range = parseRange(request.headers.get("range"), full.byteLength);
  const body =
    range === null ? full : full.subarray(range.start, range.end + 1);

  // Re-authorise immediately before the bytes leave the trusted route. The
  // durable access implementation performs the equivalent revision fence after
  // object reads so an in-flight revocation cannot complete successfully.
  try {
    await authorisePortalRequest(session, {
      reportVersionId: media.reportVersionId,
      module: media.module,
      action: "view_curated_media",
    });
  } catch {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }

  return new NextResponse(Uint8Array.from(body).buffer, {
    status: range === null ? 200 : 206,
    headers: {
      "accept-ranges": "bytes",
      "cache-control": "private, no-store, max-age=0",
      "content-length": String(body.byteLength),
      "content-type": "image/png",
      etag: `"${media.contentHash}"`,
      ...(range === null
        ? {}
        : {
            "content-range": `bytes ${String(range.start)}-${String(range.end)}/${String(full.byteLength)}`,
          }),
    },
  });
}

function parseRange(
  value: string | null,
  byteLength: number,
): { start: number; end: number } | null {
  if (value === null) {
    return null;
  }
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (match === null) {
    return null;
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? byteLength - 1 : Number(match[2]);
  const end = Math.min(requestedEnd, byteLength - 1);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > end
  ) {
    return null;
  }
  return { start, end };
}
