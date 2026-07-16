import { NextResponse } from "next/server";

import {
  authorisePortalRequest,
  readPortalSession,
  recipientCookieOptions,
  RECIPIENT_SESSION_COOKIE,
  revokeCurrentDemoGrant,
} from "../../../_lib/recipient-session";

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return denied();
  const session = await readPortalSession();
  for (const module of ["building", "timber_pest"] as const) {
    try {
      const authorised = await authorisePortalRequest(session, {
        reportVersionId: "report_demo_v2",
        module,
        action: "read_report",
      });
      await revokeCurrentDemoGrant(authorised);
      const response = new NextResponse(null, { status: 204 });
      response.cookies.set(RECIPIENT_SESSION_COOKIE, "", {
        ...recipientCookieOptions(0),
        expires: new Date(0),
      });
      return response;
    } catch {
      // Try the remaining delivered module before denying the request.
    }
  }
  return denied();
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin === null || host === null) return false;
  try {
    return (
      new URL(origin).host === host &&
      request.headers.get("sec-fetch-site") === "same-origin"
    );
  } catch {
    return false;
  }
}

function denied() {
  return NextResponse.json({ error: "access_denied" }, { status: 403 });
}
