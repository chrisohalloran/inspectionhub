import { NextResponse } from "next/server";

import {
  consumeBoundaryRateLimit,
  type BoundaryRateLimit,
} from "../../../api/webhooks/rate-limit";

export type RecipientMutationBoundary = "contact" | "share";

export async function enforceRecipientMutationRateLimit(
  boundary: RecipientMutationBoundary,
  grantId: string,
  consumeRateLimit: BoundaryRateLimit = consumeBoundaryRateLimit,
): Promise<NextResponse | null> {
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(grantId)) {
    return NextResponse.json(
      { error: "security_boundary_unavailable" },
      { status: 503 },
    );
  }
  try {
    const grantDecision = await consumeRateLimit(
      "recipient_access",
      `recipient-demo-${boundary}-${grantId}`,
    );
    if (!grantDecision.allowed) return limited(grantDecision);
    const globalDecision = await consumeRateLimit(
      "recipient_demo_global",
      `recipient-demo-${boundary}-global`,
    );
    return globalDecision.allowed ? null : limited(globalDecision);
  } catch {
    return NextResponse.json(
      { error: "security_boundary_unavailable" },
      { status: 503 },
    );
  }
}

function limited(decision: { retryAfterSeconds: number }): NextResponse {
  return NextResponse.json(
    { error: "rate_limited" },
    {
      headers: { "retry-after": String(decision.retryAfterSeconds) },
      status: 429,
    },
  );
}
