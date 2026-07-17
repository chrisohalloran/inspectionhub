export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical field JSON requires finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => {
          const child = record[key];
          if (child === undefined) {
            throw new TypeError("Canonical field JSON rejects undefined");
          }
          return [key, normalize(child)];
        }),
    );
  }
  throw new TypeError(`Canonical field JSON rejects ${typeof value}`);
}
