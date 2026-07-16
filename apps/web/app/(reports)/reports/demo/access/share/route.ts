import { NextResponse } from "next/server";

import { recipientStateAuthority } from "../../../_lib/recipient-authority";
import { readPortalSession } from "../../../_lib/recipient-session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return denied();
  const session = await readPortalSession();
  if (session === null) return denied();
  let email: string;
  let expiresAt: number;
  try {
    const body = (await request.json()) as unknown;
    email = canonicalEmail(field(body, "email"));
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
  } catch {
    return denied();
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return denied();
  const session = await readPortalSession();
  if (session === null) return denied();
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

function canonicalEmail(value: string): string {
  const email = value.trim().toLocaleLowerCase("en-AU");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) throw new Error();
  return email;
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

function denied() {
  return NextResponse.json({ error: "access_denied" }, { status: 403 });
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
