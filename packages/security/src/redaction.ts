const SENSITIVE_KEYS =
  /(?:authorization|cookie|password|secret|token|api[_-]?key|session|mailbox|email|phone|address|transcript|observation|report|finding|content|body)/iu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const EMAIL_REPLACE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const EMAIL_TEST_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;

export type RedactedValue =
  | string
  | number
  | boolean
  | null
  | readonly RedactedValue[]
  | { readonly [key: string]: RedactedValue };

export function redactTelemetry(value: unknown, key = "root"): RedactedValue {
  if (SENSITIVE_KEYS.test(key)) {
    return "[REDACTED]";
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return value
      .replace(BEARER_PATTERN, "[REDACTED_BEARER]")
      .replace(EMAIL_REPLACE_PATTERN, "[REDACTED_EMAIL]")
      .slice(0, 500);
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.slice(0, 100).map((item) => redactTelemetry(item, key)),
    );
  }
  if (typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .slice(0, 100)
          .map(([entryKey, entryValue]) => [
            entryKey,
            redactTelemetry(entryValue, entryKey),
          ]),
      ),
    );
  }
  return "[UNSUPPORTED]";
}

export function assertTelemetryContainsNoSensitivePayload(
  value: unknown,
): void {
  const serialized = JSON.stringify(value);
  if (
    /\bBearer\s+/iu.test(serialized) ||
    EMAIL_TEST_PATTERN.test(serialized) ||
    /"(?:authorization|cookie|password|secret|token|api[_-]?key|session|mailbox|email|phone|address|transcript|observation|report|finding|content|body)"\s*:/iu.test(
      serialized,
    )
  ) {
    throw new Error("Telemetry contains a sensitive key or value");
  }
}
