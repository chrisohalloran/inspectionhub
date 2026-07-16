import { createHash } from "node:crypto";

export function deepFreezeReport<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreezeReport(child);
  }
  return Object.freeze(value);
}

export function hashCanonicalReport(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalise(value)))
    .digest("hex");
}

function normalise(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical report JSON rejects non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalise);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => {
          const child = record[key];
          if (child === undefined) {
            throw new TypeError(
              `Canonical report JSON rejects undefined at ${key}`,
            );
          }
          return [key, normalise(child)];
        }),
    );
  }
  throw new TypeError(`Canonical report JSON rejects ${typeof value}`);
}
