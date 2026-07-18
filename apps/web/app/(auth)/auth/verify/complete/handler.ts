import { NextResponse } from "next/server";

import {
  completeDemoOtp,
  DemoRecipientAuthError,
  readPendingSessionToken,
  recipientCookieOptions,
  RECIPIENT_PENDING_COOKIE,
  RECIPIENT_SESSION_COOKIE,
} from "../../../../(reports)/reports/_lib/recipient-session";
import type { BoundaryRateLimit } from "../../../../api/webhooks/rate-limit";

type ReadPendingSession = typeof readPendingSessionToken;
type CompleteOtp = typeof completeDemoOtp;

export function createOtpVerificationHandler(input: {
  consumeRateLimit: BoundaryRateLimit;
  readPendingSession?: ReadPendingSession;
  completeOtp?: CompleteOtp;
}) {
  return async function post(request: Request) {
    const rateLimit = await consumeRecipientRateLimit(input.consumeRateLimit);
    if (rateLimit !== null) return rateLimit;

    try {
      const pending = await (
        input.readPendingSession ?? readPendingSessionToken
      )();
      const data = await request.formData();
      if (pending === null) {
        throw new DemoRecipientAuthError();
      }
      const session = await (input.completeOtp ?? completeDemoOtp)(
        pending,
        stringField(data, "otp"),
      );
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
  };
}

async function consumeRecipientRateLimit(
  consumeRateLimit: BoundaryRateLimit,
): Promise<NextResponse | null> {
  try {
    const decision = await consumeRateLimit(
      "recipient_access",
      "recipient-otp-verify",
    );
    if (decision.allowed) return null;
    const response = relativeRedirect("/auth/verify?error=rate-limited");
    response.headers.set("retry-after", String(decision.retryAfterSeconds));
    return response;
  } catch {
    return relativeRedirect("/auth/verify?error=temporarily-unavailable");
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
