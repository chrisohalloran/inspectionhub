import { describe, expect, it } from "vitest";

import {
  canonicalReservedDemoEmail,
  DEMO_CONTACT_REQUEST_LIMIT,
  DEMO_REPORT_CONTACT_WINDOW_LIMIT,
  DEMO_REPORT_MUTATION_WINDOW_MS,
  DEMO_REPORT_SHARE_WINDOW_LIMIT,
  DEMO_SHARE_REQUEST_LIMIT,
} from "./recipient-demo-policy";

describe("public recipient demo policy", () => {
  it("canonicalises only reserved example.com recipient addresses", () => {
    expect(canonicalReservedDemoEmail(" Buyer+One@Example.Com ")).toBe(
      "buyer+one@example.com",
    );

    for (const address of [
      "buyer@example.org",
      "buyer@example.com.au",
      "buyer@sub.example.com",
      "@example.com",
      "buyer@example.com.evil.test",
    ]) {
      expect(() => canonicalReservedDemoEmail(address)).toThrow(
        "reserved synthetic recipient address",
      );
    }
  });

  it("keeps public mutation allowances intentionally small", () => {
    expect(DEMO_SHARE_REQUEST_LIMIT).toBe(5);
    expect(DEMO_CONTACT_REQUEST_LIMIT).toBe(5);
    expect(DEMO_REPORT_SHARE_WINDOW_LIMIT).toBe(25);
    expect(DEMO_REPORT_CONTACT_WINDOW_LIMIT).toBe(25);
    expect(DEMO_REPORT_MUTATION_WINDOW_MS).toBe(60 * 60_000);
  });
});
