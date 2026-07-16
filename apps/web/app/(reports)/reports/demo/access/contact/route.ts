import { NextResponse } from "next/server";

import { recipientStateAuthority } from "../../../_lib/recipient-authority";
import { readPortalSession } from "../../../_lib/recipient-session";

const FINDING_REFERENCES = new Set([
  "",
  "finding_cracked_tiles",
  "finding_garden_bed",
]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return denied();
  const session = await readPortalSession();
  if (session === null) return denied();
  let findingReference: string;
  try {
    const body = (await request.json()) as unknown;
    findingReference = field(body, "findingReference", 120);
    const message = field(body, "message", 2_000).trim();
    if (!FINDING_REFERENCES.has(findingReference) || message.length === 0) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const contactRequest = await recipientStateAuthority().recordContactRequest(
      {
        session,
        findingReference: findingReference === "" ? null : findingReference,
        module: moduleForFinding(findingReference),
      },
    );
    return NextResponse.json(
      { contactRequest },
      {
        status: 201,
        headers: { "cache-control": "private, no-store, max-age=0" },
      },
    );
  } catch {
    return denied();
  }
}

function moduleForFinding(value: string) {
  if (value === "finding_cracked_tiles") return "building" as const;
  if (value === "finding_garden_bed") return "timber_pest" as const;
  return null;
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

function field(value: unknown, key: string, maxLength: number): string {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error();
  }
  const fieldValue = (value as Record<string, unknown>)[key];
  if (typeof fieldValue !== "string" || fieldValue.length > maxLength) {
    throw new Error();
  }
  return fieldValue;
}

function denied() {
  return NextResponse.json({ error: "access_denied" }, { status: 403 });
}
