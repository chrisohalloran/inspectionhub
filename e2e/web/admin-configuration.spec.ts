import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("launch administration configuration", () => {
  test("publishes a versioned price without mutating a prior quote", async ({
    page,
  }) => {
    await page.goto("/admin/configuration");

    await page
      .getByLabel("Building inspection (AUD including GST)")
      .fill("510");
    await expect(page.getByRole("status")).toContainText(
      "Unsaved pricing draft",
    );
    await page
      .getByRole("button", { name: "Review new price version" })
      .click();
    await expect(
      page.getByText("Existing quotes will not change"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm version publish" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Existing quote Q-1042-test remains unchanged",
    );
    await page.getByText("Read prior price versions").click();
    await expect(
      page.getByRole("table", { name: "Published price history" }),
    ).toBeVisible();
  });

  test("previews conflicts, expiry authority and redacted integration truth", async ({
    page,
  }) => {
    await page.goto("/admin/configuration");

    await expect(page.getByText("Calendar stale · 18 minutes")).toBeVisible();
    await expect(page.getByText(/blocked by existing booking/)).toBeVisible();
    await page.getByLabel("Credential expiry").fill("2026-07-13");
    await expect(page.getByText("Not eligible")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Run safe integration test" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "No secret value was returned",
    );
    await expect(page.locator("body")).not.toContainText(/sk_[a-z0-9]/i);
  });

  test("denies mutations for a read-only test actor", async ({ page }) => {
    await page.goto("/admin/configuration?scenario=permission-denied");

    await expect(
      page.getByRole("alert").filter({ hasText: "Permission denied" }),
    ).toContainText("Permission denied");
    await expect(
      page.getByRole("button", { name: "Review new price version" }),
    ).toBeDisabled();
    await expect(page.getByText("PRICE-2026.06")).toBeAttached();
  });

  test("passes axe and 320-pixel page reflow checks", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/configuration");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    if (testInfo.project.name === "320px-reflow") {
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth,
      );
    }
  });
});
