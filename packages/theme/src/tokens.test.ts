import { describe, expect, it } from "vitest";

import { theme } from "./tokens.js";

describe("theme contract", () => {
  it("keeps primary field controls at least 48 pixels", () => {
    expect(theme.target.minimum).toBeGreaterThanOrEqual(48);
    expect(theme.target.primary).toBeGreaterThanOrEqual(theme.target.minimum);
  });

  it("keeps Building and Timber Pest visually distinct", () => {
    expect(theme.color.building).not.toBe(theme.color.timberPest);
  });
});
