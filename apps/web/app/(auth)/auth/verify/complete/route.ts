import { NextResponse } from "next/server";

import {
  completeDemoOtp,
  DemoRecipientAuthError,
  readPendingSessionToken,
  recipientCookieOptions,
  RECIPIENT_PENDING_COOKIE,
  RECIPIENT_SESSION_COOKIE,
} from "../../../../(reports)/reports/_lib/recipient-session";

export async function POST(request: Request) {
  try {
    const pending = await readPendingSessionToken();
    const data = await request.formData();
    if (pending === null) {
      throw new DemoRecipientAuthError();
    }
    const session = await completeDemoOtp(pending, stringField(data, "otp"));
    const response = relativeRedirect("/reports/demo");
    response.cookies.set(
      RECIPIENT_SESSION_COOKIE,
      session,
      recipientCookieOptions(60 * 60),
    );
    response.cookies.set(RECIPIENT_PENDING_COOKIE, "", {
      ...recipientCookieOptions(0),
      expires: new Date(0),
    });
    return response;
  } catch (error) {
    if (!(error instanceof DemoRecipientAuthError)) {
      console.error("Recipient mailbox verification failed safely", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
    return relativeRedirect("/auth/verify?error=invalid");
  }
}

function relativeRedirect(location: string): NextResponse {
  return new NextResponse(null, {
    headers: { location },
    status: 303,
  });
}

function stringField(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
