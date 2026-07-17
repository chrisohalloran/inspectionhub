import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PortalState } from "../_lib/recipient-authority";
import type { PortalSession } from "../_lib/recipient-session";
import DemoReportPage, { DemoReportContent } from "./page";

const mocks = vi.hoisted(() => ({
  portalState: vi.fn(),
  readSession: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../_lib/recipient-session", () => ({
  demoPortalState: mocks.portalState,
  readPortalSession: mocks.readSession,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("recipient report module visibility", () => {
  it("renders only Building when Timber Pest is withdrawn", () => {
    const html = render({
      buildingWithdrawn: false,
      timberPestWithdrawn: true,
    });

    expect(html).toContain("Building condition");
    expect(html).toContain("Building report PDF");
    expect(html).not.toContain("Timber Pest condition");
    expect(html).not.toContain("Timber Pest report PDF");
    expect(html).not.toContain("Garden bed against external wall");
  });

  it("renders only Timber Pest when Building is withdrawn", () => {
    const html = render({
      buildingWithdrawn: true,
      timberPestWithdrawn: false,
    });

    expect(html).toContain("Timber Pest condition");
    expect(html).toContain("Timber Pest report PDF");
    expect(html).not.toContain("Building condition");
    expect(html).not.toContain("Building report PDF");
    expect(html).not.toContain("Cracked shower and bathroom floor tiles");
  });

  it("does not render a module that the current grant omits", () => {
    const html = render(
      { buildingWithdrawn: false, timberPestWithdrawn: false },
      ["building"],
    );

    expect(html).toContain("Building condition");
    expect(html).not.toContain("Timber Pest condition");
    expect(html).not.toContain("Timber Pest report PDF");
  });

  it("applies the same grant boundary when Building is omitted", () => {
    const html = render(
      { buildingWithdrawn: false, timberPestWithdrawn: false },
      ["timber_pest"],
    );

    expect(html).toContain("Timber Pest condition");
    expect(html).not.toContain("Building condition");
    expect(html).not.toContain("Building report PDF");
  });

  it("redirects when no granted module remains active", async () => {
    mocks.readSession.mockResolvedValue(session());
    mocks.portalState.mockResolvedValue({
      buildingWithdrawn: true,
      timberPestWithdrawn: true,
      shareInvitations: [],
      contactRequests: [],
    });

    await expect(DemoReportPage()).rejects.toThrow("redirect:/auth/invitation");
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/invitation");
  });
});

function render(
  withdrawal: Pick<PortalState, "buildingWithdrawn" | "timberPestWithdrawn">,
  modules: PortalSession["modules"] = ["building", "timber_pest"],
): string {
  return renderToStaticMarkup(
    <DemoReportContent
      portalState={{
        ...withdrawal,
        shareInvitations: [],
        contactRequests: [],
      }}
      session={session(modules)}
    />,
  );
}

function session(
  modules: PortalSession["modules"] = ["building", "timber_pest"],
): PortalSession {
  return {
    kind: "recipient_session",
    sessionId: "session-test",
    grantId: "grant-test",
    principalId: "principal_demo_recipient",
    verifiedEmail: "recipient@example.com",
    organizationId: "org_demo",
    jobId: "job_demo_cracked_tile",
    reportVersionId: "report_demo_v2",
    modules,
    actions: ["read_report"],
    issuedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 60_000,
    grantRevision: 1,
  };
}
