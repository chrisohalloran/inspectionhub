import { NextResponse } from "next/server";

import type { BoundaryRateLimit } from "../rate-limit";

const activeFixtureToken = "access-v2-current";
const supersededFixtureToken = "access-v1-superseded";

export function createAccessWebhookHandler(input: {
  consumeRateLimit: BoundaryRateLimit;
}) {
  return async function post(request: Request) {
    if (
      process.env.BUILD_WEEK_FIXTURES_ENABLED !== "true" ||
      request.headers.get("x-inspection-fixture") !== "synthetic-build-week"
    ) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    let rateLimit;
    try {
      rateLimit = await input.consumeRateLimit(
        "recipient_access",
        "access-webhook",
      );
    } catch {
      return NextResponse.json(
        { error: "security_boundary_unavailable" },
        { status: 503 },
      );
    }
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          headers: { "retry-after": String(rateLimit.retryAfterSeconds) },
          status: 429,
        },
      );
    }

    const payload: unknown = await request.json().catch(() => null);
    const token =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>).token
        : undefined;

    if (token === supersededFixtureToken) {
      return NextResponse.json(
        {
          error: "access_link_superseded",
          state: "invalidated",
        },
        { status: 410 },
      );
    }
    if (token !== activeFixtureToken) {
      return NextResponse.json(
        { error: "access_link_invalid", state: "denied" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      bookingId: "SI-1042",
      reportDataVisible: false,
      state: "access_confirmation_only",
    });
  };
}
