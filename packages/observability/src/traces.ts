export type ProviderTraceSpan = {
  readonly name: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly status: "ok" | "error";
  readonly input?: unknown;
  readonly output?: unknown;
  readonly headers?: unknown;
  readonly toolName?: string;
};

export type SafeTraceSpan = {
  readonly name: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly status: "ok" | "error";
  readonly toolName: string | null;
  readonly protectedPayloadPresent: boolean;
};

const SAFE_TRACE_NAMES = new Set([
  "agent.plan",
  "agent.run",
  "agent.tool",
  "agent.verify",
  "draft",
  "provider.call",
  "task.run",
  "transcription",
]);
const SAFE_TOOL_NAMES = new Set([
  "create_finding_draft",
  "dispatch_delivery",
  "read_packet_source",
  "reconcile_provider",
  "render_report",
  "transcribe_audio",
  "verify_finding",
]);

export function inspectTraceSafely(
  spans: readonly ProviderTraceSpan[],
): readonly SafeTraceSpan[] {
  return Object.freeze(
    spans.map((span) => {
      const name = requireSafeTraceCode(
        span.name,
        "trace name",
        SAFE_TRACE_NAMES,
      );
      const toolName =
        span.toolName === undefined
          ? null
          : requireSafeTraceCode(span.toolName, "tool name", SAFE_TOOL_NAMES);
      requireTraceTimestamp(span.startedAt, "trace start");
      requireTraceTimestamp(span.endedAt, "trace end");
      if (Date.parse(span.endedAt) < Date.parse(span.startedAt)) {
        throw new Error("Trace end must not precede trace start");
      }
      if (span.status !== "ok" && span.status !== "error") {
        throw new Error("Trace status must be allowlisted");
      }
      return Object.freeze({
        name,
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        status: span.status,
        toolName,
        protectedPayloadPresent:
          span.input !== undefined ||
          span.output !== undefined ||
          span.headers !== undefined,
      });
    }),
  );
}

function requireSafeTraceCode(
  value: string,
  label: string,
  allowlist: ReadonlySet<string>,
): string {
  if (!allowlist.has(value)) {
    throw new Error(`${label} must use a fixed allowlisted code`);
  }
  return value;
}

function requireTraceTimestamp(value: string, label: string): void {
  if (value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid bounded date-time`);
  }
}
