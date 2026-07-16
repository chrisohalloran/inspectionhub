import { describe, expect, it } from "vitest";

import { SafeTelemetryRecorder } from "./events.js";
import { OperationsProjection } from "./projection.js";
import { inspectTraceSafely } from "./traces.js";

describe("safe operational telemetry", () => {
  it("keeps only allowlisted, redacted metadata and hashed identities", () => {
    const recorder = new SafeTelemetryRecorder();
    const event = recorder.record({
      eventId: "10000000-0000-4000-8000-000000000001",
      category: "provider",
      state: "unknown",
      aggregateIdHash: "a".repeat(64),
      organizationHash: "b".repeat(64),
      correlationId: "20000000-0000-4000-8000-000000000001",
      occurredAt: "2026-07-15T08:00:00.000+10:00",
      metadata: {
        provider: "resend",
        attempt: 2,
        body: "buyer@example.com had cracked tiles",
        authorization: "Bearer secret-token",
      },
    });

    expect(event.safeMetadata).toEqual({ provider: "resend", attempt: 2 });
    expect(JSON.stringify(event)).not.toContain("buyer@example.com");
    expect(() =>
      recorder.record({
        eventId: "10000000-0000-4000-8000-000000000002",
        category: "provider",
        state: "failed",
        aggregateIdHash: "raw-id",
        organizationHash: "b".repeat(64),
        correlationId: "20000000-0000-4000-8000-000000000001",
        occurredAt: "2026-07-15T08:00:00.000+10:00",
      }),
    ).toThrow("one-way");
  });

  it("rejects identifiers, timestamps and metadata that can smuggle payloads", () => {
    const recorder = new SafeTelemetryRecorder();
    const common = {
      category: "provider" as const,
      state: "failed" as const,
      aggregateIdHash: "a".repeat(64),
      organizationHash: "b".repeat(64),
      correlationId: "20000000-0000-4000-8000-000000000001",
      occurredAt: "2026-07-15T08:00:00.000+10:00",
    };

    expect(() =>
      recorder.record({ ...common, eventId: "buyer@example.com" }),
    ).toThrow("UUID");
    expect(() =>
      recorder.record({ ...common, eventId: "buyer_ChrisOHalloran" }),
    ).toThrow("UUID");
    expect(() =>
      recorder.record({
        ...common,
        eventId: "10000000-0000-4000-8000-000000000001",
        correlationId: "inspection for buyer",
      }),
    ).toThrow("UUID");
    expect(() =>
      recorder.record({
        ...common,
        eventId: "10000000-0000-4000-8000-000000000001",
        occurredAt: "not-a-date",
      }),
    ).toThrow("date-time");
    expect(() =>
      recorder.record({
        ...common,
        eventId: "10000000-0000-4000-8000-000000000001",
        metadata: { provider: "buyer@example.com" },
      }),
    ).toThrow("fixed allowlisted code");
  });

  it("projects unknown, dead-letter, restore-blocked and stuck work without content", () => {
    const recorder = new SafeTelemetryRecorder();
    const projection = new OperationsProjection();
    for (const [category, state, aggregate, occurredAt] of [
      ["provider", "unknown", "a", "2026-07-15T07:00:00.000+10:00"],
      ["task", "failed", "b", "2026-07-15T08:00:00.000+10:00"],
      ["restore", "blocked", "c", "2026-07-15T08:00:00.000+10:00"],
    ] as const) {
      projection.ingest(
        recorder.record({
          eventId: aggregate.repeat(64),
          category,
          state,
          aggregateIdHash: aggregate.repeat(64),
          organizationHash: "d".repeat(64),
          correlationId: "e".repeat(64),
          occurredAt,
        }),
      );
    }

    expect(
      projection.summary({
        now: "2026-07-15T09:00:00.000+10:00",
        stuckAfterMilliseconds: 30 * 60 * 1_000,
      }),
    ).toMatchObject({
      unknownOutcomeCount: 1,
      deadLetterCount: 1,
      egressBlocked: true,
      stuck: [
        expect.objectContaining({ category: "provider", state: "unknown" }),
      ],
    });
  });

  it("rejects out-of-order state regression", () => {
    const recorder = new SafeTelemetryRecorder();
    const projection = new OperationsProjection();
    const common = {
      category: "task" as const,
      aggregateIdHash: "a".repeat(64),
      organizationHash: "b".repeat(64),
      correlationId: "20000000-0000-4000-8000-000000000001",
    };
    projection.ingest(
      recorder.record({
        ...common,
        eventId: "10000000-0000-4000-8000-000000000001",
        state: "succeeded",
        occurredAt: "2026-07-15T09:00:00.000+10:00",
      }),
    );
    expect(() =>
      projection.ingest(
        recorder.record({
          ...common,
          eventId: "10000000-0000-4000-8000-000000000002",
          state: "running",
          occurredAt: "2026-07-15T08:00:00.000+10:00",
        }),
      ),
    ).toThrow("out-of-order");
  });

  it("exposes only trace structure and a protected-payload warning", () => {
    expect(
      inspectTraceSafely([
        {
          name: "draft",
          startedAt: "2026-07-15T08:00:00.000+10:00",
          endedAt: "2026-07-15T08:00:01.000+10:00",
          status: "ok",
          toolName: "read_packet_source",
          input: { transcript: "private content" },
          output: { finding: "private content" },
        },
      ]),
    ).toEqual([
      {
        name: "draft",
        startedAt: "2026-07-15T08:00:00.000+10:00",
        endedAt: "2026-07-15T08:00:01.000+10:00",
        status: "ok",
        toolName: "read_packet_source",
        protectedPayloadPresent: true,
      },
    ]);
  });

  it("rejects trace names, tool names and time ranges that can leak payloads", () => {
    const common = {
      startedAt: "2026-07-15T08:00:00.000+10:00",
      endedAt: "2026-07-15T08:00:01.000+10:00",
      status: "ok" as const,
    };
    expect(() =>
      inspectTraceSafely([{ ...common, name: "buyer@example.com" }]),
    ).toThrow("fixed allowlisted code");
    expect(() =>
      inspectTraceSafely([{ ...common, name: "buyer_ChrisOHalloran" }]),
    ).toThrow("fixed allowlisted code");
    expect(() =>
      inspectTraceSafely([
        { ...common, name: "draft", toolName: "private transcript" },
      ]),
    ).toThrow("fixed allowlisted code");
    expect(() =>
      inspectTraceSafely([
        {
          ...common,
          name: "draft",
          startedAt: "2026-07-15T08:00:02.000+10:00",
        },
      ]),
    ).toThrow("must not precede");
  });
});
