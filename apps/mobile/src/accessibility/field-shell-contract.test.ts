import { describe, expect, it } from "vitest";

import {
  fieldControls,
  fieldShellAccessibilityContract,
} from "./field-shell-contract.js";
import { demoFieldStatuses } from "./field-status.js";

describe("field shell accessibility contract", () => {
  it("keeps every primary field target at least 48 pixels", () => {
    expect(
      fieldShellAccessibilityContract.minimumTargetSize,
    ).toBeGreaterThanOrEqual(48);
  });

  it("gives each capture and fallback action an explicit label and hint", () => {
    for (const control of Object.values(fieldControls)) {
      expect(control.label.length).toBeGreaterThan(0);
      expect(control.hint.length).toBeGreaterThan(0);
    }
  });

  it("expresses offline, session, and storage state in text", () => {
    const statusText = demoFieldStatuses
      .map((status) => status.label)
      .join(" ");
    expect(statusText).toContain("Offline");
    expect(statusText).toContain("Session");
    expect(statusText).toContain("Storage");
  });
});
