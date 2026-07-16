import { NextResponse } from "next/server";

import {
  consumeBoundaryRateLimit,
  type BoundaryRateLimit,
} from "../rate-limit";

type BookingWebhook = Readonly<{
  bookingId: string;
  eventId: string;
  intentId: string;
  kind: "checkout.declined" | "checkout.succeeded" | "refund.succeeded";
  providerReference: string;
}>;

type StoredObservation = Readonly<{
  fingerprint: string;
  result: WebhookResult;
}>;

type WebhookResult = Readonly<{
  bookingId: string;
  eventId: string;
  outcome: "accepted" | "reconciliation_required";
  transitionCount: number;
}>;

const observations = new Map<string, StoredObservation>();
const acceptedTransitions = new Set<string>();

export function createBookingWebhookHandler(input: {
  consumeRateLimit: BoundaryRateLimit;
}) {
  return async function post(request: Request) {
    if (!fixtureWebhooksEnabled(request)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    let rateLimit;
    try {
      rateLimit = await input.consumeRateLimit(
        "provider_callback",
        "booking-webhook",
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
    if (!isBookingWebhook(payload)) {
      return NextResponse.json(
        { error: "invalid_booking_webhook" },
        { status: 400 },
      );
    }

    const fingerprint = canonicalFingerprint(payload);
    const prior = observations.get(payload.eventId);
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) {
        return NextResponse.json(
          { error: "event_id_payload_mismatch" },
          { status: 409 },
        );
      }
      return NextResponse.json({ ...prior.result, replayed: true });
    }

    // The fixture models a declined first attempt followed by intent 2. A late
    // success for intent 1 is recorded, but cannot advance payment authority.
    const currentIntentId = "checkout-intent-2";
    const transitionKey = `${payload.bookingId}:${payload.kind}:${payload.intentId}`;
    const outcome =
      payload.kind === "checkout.succeeded" &&
      payload.intentId !== currentIntentId
        ? "reconciliation_required"
        : "accepted";

    if (outcome === "accepted") acceptedTransitions.add(transitionKey);
    const result: WebhookResult = {
      bookingId: payload.bookingId,
      eventId: payload.eventId,
      outcome,
      transitionCount: outcome === "accepted" ? 1 : 0,
    };
    observations.set(payload.eventId, { fingerprint, result });

    return NextResponse.json({ ...result, replayed: false });
  };
}

export const POST = createBookingWebhookHandler({
  consumeRateLimit: consumeBoundaryRateLimit,
});

function fixtureWebhooksEnabled(request: Request): boolean {
  return (
    process.env.BUILD_WEEK_FIXTURES_ENABLED === "true" &&
    request.headers.get("x-inspection-fixture") === "synthetic-build-week"
  );
}

function isBookingWebhook(value: unknown): value is BookingWebhook {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.bookingId === "string" &&
    typeof input.eventId === "string" &&
    typeof input.intentId === "string" &&
    typeof input.providerReference === "string" &&
    (input.kind === "checkout.declined" ||
      input.kind === "checkout.succeeded" ||
      input.kind === "refund.succeeded")
  );
}

function canonicalFingerprint(payload: BookingWebhook): string {
  return JSON.stringify({
    bookingId: payload.bookingId,
    eventId: payload.eventId,
    intentId: payload.intentId,
    kind: payload.kind,
    providerReference: payload.providerReference,
  });
}
