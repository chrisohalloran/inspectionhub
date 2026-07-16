import { NextResponse } from "next/server";

import {
  beginDemoInvitation,
  DemoRecipientAuthError,
  recipientCookieOptions,
  RECIPIENT_PENDING_COOKIE,
} from "../../../../(reports)/reports/_lib/recipient-session";
import {
  consumeBoundaryRateLimit,
  type BoundaryRateLimit,
} from "../../../../api/webhooks/rate-limit";

type BeginInvitation = typeof beginDemoInvitation;

export function createInvitationRedemptionHandler(input: {
  consumeRateLimit: BoundaryRateLimit;
  beginInvitation?: BeginInvitation;
}) {
  return async function post(request: Request) {
    const rateLimit = await consumeRecipientRateLimit(
      input.consumeRateLimit,
      "recipient-invitation-redeem",
    );
    if (rateLimit !== null) return rateLimit;

    try {
      const data = await request.formData();
      const pending = await (input.beginInvitation ?? beginDemoInvitation)({
        invitationToken: stringField(data, "invitationToken"),
        email: stringField(data, "email"),
      });
      const response = relativeRedirect("/auth/verify");
      response.cookies.set(
        RECIPIENT_PENDING_COOKIE,
        pending,
        recipientCookieOptions(10 * 60),
      );
      return response;
    } catch (error) {
      if (!(error instanceof DemoRecipientAuthError)) {
        console.error("Recipient invitation adapter failed safely", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
      }
      return relativeRedirect("/auth/invitation?error=unavailable");
    }
  };
}

export const POST = createInvitationRedemptionHandler({
  consumeRateLimit: consumeBoundaryRateLimit,
});

async function consumeRecipientRateLimit(
  consumeRateLimit: BoundaryRateLimit,
  boundaryKey: string,
): Promise<NextResponse | null> {
  try {
    const decision = await consumeRateLimit("recipient_access", boundaryKey);
    if (decision.allowed) return null;
    return NextResponse.json(
      { error: "rate_limited" },
      {
        headers: { "retry-after": String(decision.retryAfterSeconds) },
        status: 429,
      },
    );
  } catch {
    return NextResponse.json(
      { error: "security_boundary_unavailable" },
      { status: 503 },
    );
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
