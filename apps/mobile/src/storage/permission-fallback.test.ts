import { describe, expect, it } from "vitest";

import { permissionFallback } from "./permission-fallback.js";

describe("media and storage permission fallback", () => {
  it.each([
    ["photo", "denied", "camera"],
    ["voice", "unavailable", "microphone"],
    ["storage", "denied", "storage"],
  ] as const)(
    "offers a manual note when %s is %s",
    (kind, permission, capability) => {
      expect(permissionFallback(kind, permission)).toMatchObject({
        blockedCapability: capability,
        manualNoteAvailable: true,
      });
    },
  );
});
