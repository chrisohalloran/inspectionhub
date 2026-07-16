import { createHash } from "node:crypto";

export const sha256Pattern = /^[0-9a-f]{64}$/;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function safePathSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${label} is not a safe storage path segment`);
  }
  return value;
}
