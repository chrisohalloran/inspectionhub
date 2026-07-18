import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("quote-to-ready booking", () => {
  test("completes the combined synthetic booking while keeping readiness states separate", async ({
    page,
  }) => {
    await page.goto("/booking");

    await expect(
      page.getByRole("heading", { name: "Book your inspection" }),
    ).toBeVisible();
    await expect(page.getByText("Total including GST")).toBeVisible();
    await expect(page.getByText("$715.00")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page
      .getByRole("radio", {
        name: /Wednesday 22 July, 1:30 pm.*Available after travel buffer/,
      })
      .check();
    await page.getByRole("button", { name: "Continue to review" }).click();
    await page.getByLabel(/I am Alex Morgan/).check();
    await page
      .getByRole("button", { name: "Accept agreement and continue" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Actions remaining" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Complete payment" }).click();
    await page.getByRole("button", { name: "Send access request" }).click();
    await page.getByText("Demo control", { exact: true }).click();
    await page
      .getByRole("button", { name: "Simulate contact confirmation" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Inspection confirmed" }),
    ).toBeVisible();
    await expect(page.getByText("Signed", { exact: true })).toBeVisible();
    await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(3);
  });

  test("recovers a declined test payment without dropping captured details", async ({
    page,
  }) => {
    await page.goto("/booking?scenario=payment-declined");

    await expect(
      page.getByRole("alert").filter({ hasText: "Action needed" }),
    ).toContainText("Property and participant details remain saved");
    await expect(
      page.getByRole("heading", {
        name: "18 Example Street, Southport QLD 4215",
      }),
    ).toBeVisible();
    await expect(page.getByText(/alex@example\.test/)).toBeVisible();
    await page.getByRole("button", { name: "Retry payment" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Demo payment confirmed",
    );
  });

  test("recovers from a competing slot confirmation once", async ({ page }) => {
    await page.goto("/booking?scenario=slot-conflict");

    await expect(
      page.getByRole("alert").filter({ hasText: "Action needed" }),
    ).toContainText("Another test client confirmed");
    await page
      .getByRole("radio", {
        name: /Thursday 23 July, 10:30 am.*Available/,
      })
      .check();
    await page
      .getByRole("button", { name: "Confirm replacement time" })
      .click();
    await expect(page.getByText(/Replacement time confirmed/)).toBeVisible();
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(
      page.getByRole("heading", { name: "Review and accept" }),
    ).toBeVisible();
  });

  test("recovers an expired slot without asking for property details again", async ({
    page,
  }) => {
    await page.goto("/booking?scenario=slot-expired");

    await expect(
      page.getByRole("alert").filter({ hasText: "Action needed" }),
    ).toContainText("temporary slot hold expired");
    await expect(
      page.getByRole("alert").filter({ hasText: "Action needed" }),
    ).toContainText("18 Example Street, Southport QLD 4215");
    await page
      .getByRole("radio", {
        name: /Thursday 23 July, 10:30 am.*Available/,
      })
      .check();
    await page
      .getByRole("button", { name: "Confirm replacement time" })
      .click();
    await expect(page.getByText(/Replacement time confirmed/)).toBeVisible();
  });

  test("deduplicates booking webhooks and rejects stale or changed authority", async ({
    request,
  }, testInfo) => {
    const headers = { "x-inspection-fixture": "synthetic-build-week" };
    const fixtureSuffix = testInfo.project.name;
    const staleEvent = {
      bookingId: "SI-1042",
      eventId: `evt-old-success-e2e-${fixtureSuffix}`,
      intentId: "checkout-intent-1",
      kind: "checkout.succeeded",
      providerReference: "pi-old",
    };

    const stale = await request.post("/api/webhooks/booking", {
      data: staleEvent,
      headers,
    });
    expect(stale.status()).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({
      outcome: "reconciliation_required",
      replayed: false,
      transitionCount: 0,
    });

    const replay = await request.post("/api/webhooks/booking", {
      data: staleEvent,
      headers,
    });
    await expect(replay.json()).resolves.toMatchObject({
      outcome: "reconciliation_required",
      replayed: true,
      transitionCount: 0,
    });

    const changedPayload = await request.post("/api/webhooks/booking", {
      data: { ...staleEvent, providerReference: "pi-tampered" },
      headers,
    });
    expect(changedPayload.status()).toBe(409);

    const current = await request.post("/api/webhooks/booking", {
      data: {
        ...staleEvent,
        eventId: `evt-current-success-e2e-${fixtureSuffix}`,
        intentId: "checkout-intent-2",
        providerReference: "pi-current",
      },
      headers,
    });
    await expect(current.json()).resolves.toMatchObject({
      outcome: "accepted",
      replayed: false,
      transitionCount: 1,
    });
  });

  test("denies a superseded access link and keeps report data private", async ({
    request,
  }) => {
    const headers = { "x-inspection-fixture": "synthetic-build-week" };
    const superseded = await request.post("/api/webhooks/access", {
      data: { token: "access-v1-superseded" },
      headers,
    });
    expect(superseded.status()).toBe(410);
    await expect(superseded.json()).resolves.toMatchObject({
      error: "access_link_superseded",
      state: "invalidated",
    });

    const active = await request.post("/api/webhooks/access", {
      data: { token: "access-v2-current" },
      headers,
    });
    await expect(active.json()).resolves.toMatchObject({
      reportDataVisible: false,
      state: "access_confirmation_only",
    });
  });

  test("supports keyboard activation and has no serious axe violations", async ({
    page,
  }) => {
    await page.goto("/booking");

    const continueButton = page.getByRole("button", {
      name: "Continue",
    });
    await continueButton.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", {
        name: "Choose a time and access",
      }),
    ).toBeFocused();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("reflows at 320 CSS pixels without page-level horizontal scrolling", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "320px-reflow", "320px project only");
    await page.goto("/booking?scenario=payment-declined");

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    const shortTargets = await page
      .locator("button, a")
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          // Next.js injects an icon-only development-tools control. It is not
          // part of the product surface and is absent from production builds.
          .filter((element) => element.textContent?.trim() !== "")
          .filter((element) => element.getBoundingClientRect().height < 48)
          .map((element) => element.textContent?.trim()),
      );
    expect(shortTargets).toEqual([]);
  });
});

test.describe("booking changes", () => {
  test("keeps old appointment authority until a test reschedule result is observed", async ({
    page,
  }) => {
    await page.goto("/booking/reschedule");
    await page.getByRole("button", { name: "Confirm new time" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Reschedule pending" }),
    ).toBeVisible();
    await page.getByText("Technical status", { exact: true }).click();
    await expect(
      page.getByText("still current", { exact: true }),
    ).toBeVisible();
    await page.getByText("Demo control", { exact: true }).click();
    await page.getByRole("button", { name: "Complete demo update" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Inspection rescheduled" }),
    ).toBeVisible();
  });

  test("shows booking, refund, calendar and access cancellation independently", async ({
    page,
  }) => {
    await page.goto("/booking/cancel");
    await page
      .getByLabel(/I understand the appointment will be cancelled/)
      .check();
    await page.getByRole("button", { name: "Cancel inspection" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Cancellation and refund pending" }),
    ).toBeVisible();
    await page.getByText("Demo control", { exact: true }).click();
    await page
      .getByRole("button", { name: "Complete demo cancellation" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Booking cancelled" }),
    ).toBeVisible();
  });
});
