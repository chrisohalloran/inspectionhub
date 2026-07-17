import { NextResponse } from "next/server";

import { recipientStateAuthority } from "../../../_lib/recipient-authority";
import { canonicalReservedDemoEmail } from "../../../_lib/recipient-demo-policy";
import { enforceRecipientMutationRateLimit } from "../../../_lib/recipient-mutation-rate-limit";
import {
  recipientDenied,
  recipientMutationFailure,
  sameOriginRecipientRequest,
} from "../../../_lib/recipient-route-boundary";
import { readPortalSession } from "../../../_lib/recipient-session";

export async function POST(request: Request) {
  if (!sameOriginRecipientRequest(request)) return recipientDenied();
  const session = await readPortalSession();
  if (session === null) return recipientDenied();
  const rateLimit = await enforceRecipientMutationRateLimit(
    "share",
    session.grantId,
  );
  if (rateLimit !== null) return rateLimit;
  let email: string;
  let expiresAt: number;
  try {
    const body = (await request.json()) as unknown;
    email = canonicalReservedDemoEmail(field(body, "email"));
    expiresAt = numberField(body, "expiresAt");
    const now = Date.now();
    if (expiresAt <= now || expiresAt > now + 7 * 24 * 60 * 60_000) {
      return NextResponse.json({ error: "invalid_expiry" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const invitation = await recipientStateAuthority().recordShareInvitation({
      session,
      email,
      expiresAt,
    });
    return noStore({ invitation }, 201);
  } catch (cause) {
    return recipientMutationFailure(cause);
  }
}

export async function DELETE(request: Request) {
  if (!sameOriginRecipientRequest(request)) return recipientDenied();
  const session = await readPortalSession();
  if (session === null) return recipientDenied();
  const rateLimit = await enforceRecipientMutationRateLimit(
    "share",
    session.grantId,
  );
  if (rateLimit !== null) return rateLimit;
  let invitationId: string;
  try {
    const body = (await request.json()) as unknown;
    invitationId = field(body, "invitationId");
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const invitation = await recipientStateAuthority().revokeShareInvitation({
      session,
      invitationId,
    });
    return noStore({ invitation });
  } catch (cause) {
    return recipientMutationFailure(cause);
  }
}

function field(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error();
  }
  const fieldValue = (value as Record<string, unknown>)[key];
  if (typeof fieldValue !== "string" || fieldValue.length > 320) {
    throw new Error();
  }
  return fieldValue;
}

function numberField(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error();
  }
  const fieldValue = (value as Record<string, unknown>)[key];
  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw new Error();
  }
  return fieldValue;
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
