import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("quote-to-ready booking", () => {
  test("completes the combined synthetic booking while keeping readiness states separate", async ({
    page,
  }) => {
    await page.goto("/booking");

    await expect(
      page.getByRole("heading", { name: "Choose the inspection service" }),
    ).toBeVisible();
    await expect(page.getByText("Total including GST")).toBeVisible();
    await expect(page.getByText("$715.00")).toBeVisible();
    await page
      .getByRole("button", { name: "Continue to property details" })
      .click();
    await page.getByRole("button", { name: "Continue to appointment" }).click();
    await page
      .getByRole("radio", {
        name: /Wednesday 15 July, 1:30 pm.*Available after travel buffer/,
      })
      .check();
    await page
      .getByRole("button", { name: "Confirm test appointment" })
      .click();
    await page.getByLabel(/I am Alex Morgan/).check();
    await page.getByRole("button", { name: "Sign test agreement" }).click();

    await expect(
      page.getByRole("heading", { name: "Waiting for required test actions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Complete test payment" }).click();
    await page
      .getByRole("button", { name: "Send test access request" })
      .click();
    await page
      .getByRole("button", { name: "Mark access confirmed (test)" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Ready for test inspection" }),
    ).toBeVisible();
    await expect(page.getByText("Test state: succeeded")).toBeVisible();
    await expect(page.getByText("Test state: confirmed")).toHaveCount(2);
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
    await page.getByRole("button", { name: "Retry test payment" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Test payment succeeded",
    );
  });

  test("recovers from a competing slot confirmation once", async ({ page }) => {
    await page.goto("/booking?scenario=slot-conflict");

    await expect(
      page.getByRole("alert").filter({ hasText: "Action needed" }),
    ).toContainText("Another test client confirmed");
    await page
      .getByRole("radio", {
        name: /Thursday 16 July, 10:30 am.*Available/,
      })
      .check();
    await page
      .getByRole("button", { name: "Confirm replacement appointment" })
      .click();
    await expect(
      page.getByText(/Test replacement appointment confirmed/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue to agreement" }).click();
    await expect(
      page.getByRole("heading", { name: "Review the inspection scope" }),
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
        name: /Thursday 16 July, 10:30 am.*Available/,
      })
      .check();
    await page
      .getByRole("button", { name: "Confirm replacement appointment" })
      .click();
    await expect(
      page.getByText(/Test replacement appointment confirmed/),
    ).toBeVisible();
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
      name: "Continue to property details",
    });
    await continueButton.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", {
        name: "Tell us about the property and people",
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
    await page.getByRole("button", { name: "Request test reschedule" }).click();
    await expect(
      page.getByText("Test state: reschedule-pending"),
    ).toBeVisible();
    await expect(page.getByText("Test state: still current")).toBeVisible();
    await page
      .getByRole("button", { name: "Observe successful test result" })
      .click();
    await expect(page.getByText("Test state: invalidated")).toBeVisible();
  });

  test("shows booking, refund, calendar and access cancellation independently", async ({
    page,
  }) => {
    await page.goto("/booking/cancel");
    await page
      .getByLabel(/I understand the appointment will be cancelled/)
      .check();
    await page
      .getByRole("button", { name: "Request test cancellation" })
      .click();
    await expect(page.getByText("Test state: cancel-pending")).toBeVisible();
    await expect(page.getByText("Test state: pending")).toBeVisible();
    await expect(
      page.getByText("Test state: cancellation-pending"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Observe provider results (test)" })
      .click();
    await expect(page.getByText("Test booking cancelled")).toBeVisible();
  });
});
