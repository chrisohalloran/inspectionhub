import { NextResponse } from "next/server";

import { RecipientMutationLimitError } from "./recipient-mutation-error";

export function sameOriginRecipientRequest(request: Request): boolean {
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

export function recipientMutationFailure(cause: unknown): NextResponse {
  if (cause instanceof RecipientMutationLimitError) {
    return NextResponse.json(
      { error: cause.reason },
      {
        headers:
          cause.reason === "report_mutation_window_reached"
            ? {
                "cache-control": "private, no-store, max-age=0",
                "retry-after": "3600",
              }
            : { "cache-control": "private, no-store, max-age=0" },
        status: cause.reason === "report_mutation_window_reached" ? 429 : 409,
      },
    );
  }
  return recipientDenied();
}

export function recipientDenied(): NextResponse {
  return NextResponse.json({ error: "access_denied" }, { status: 403 });
}
