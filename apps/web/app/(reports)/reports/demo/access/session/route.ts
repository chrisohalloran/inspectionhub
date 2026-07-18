import { NextResponse } from "next/server";

import {
  readPortalSession,
  recipientCookieOptions,
  RECIPIENT_SESSION_COOKIE,
  revokeCurrentDemoGrant,
} from "../../../_lib/recipient-session";

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return denied();
  const session = await readPortalSession();
  try {
    if (session === null) return denied();
    await revokeCurrentDemoGrant(session);
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(RECIPIENT_SESSION_COOKIE, "", {
      ...recipientCookieOptions(0),
      expires: new Date(0),
    });
    return response;
  } catch {
    return denied();
  }
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
