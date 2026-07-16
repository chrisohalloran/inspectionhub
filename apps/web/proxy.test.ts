import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("web security proxy", () => {
  it("forwards the exact response CSP so Next can nonce every bootstrap script", () => {
    const response = proxy(new NextRequest("https://example.test/booking"));
    const policy = response.headers.get("content-security-policy");

    expect(policy).toMatch(
      /script-src 'self' 'nonce-[a-f0-9]{32}' 'strict-dynamic'/,
    );
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);
    expect(response.headers.get("x-middleware-request-x-nonce")).toMatch(
      /^[a-f0-9]{32}$/,
    );
  });
});
