import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function browserGet(
  page: import("@playwright/test").Page,
  path: string,
  headers: Readonly<Record<string, string>> = {},
) {
  return page.evaluate(
    async ({ requestHeaders, requestPath }) => {
      const response = await fetch(requestPath, { headers: requestHeaders });
      return {
        body: Array.from(new Uint8Array(await response.arrayBuffer())),
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
      };
    },
    { requestHeaders: headers, requestPath: path },
  );
}

async function authenticate(page: import("@playwright/test").Page) {
  const invitationCode = `demo-invite-${Date.now().toString()}-${Math.random().toString(16).slice(2)}`;
  await page.goto("/auth/invitation");
  await page.getByLabel("Invitation code").fill(invitationCode);
  await page.getByLabel("Email address").fill("recipient@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Enter the demo verification code" }),
  ).toBeVisible();
  await expect(
    page.getByText("No email is sent from this public demo", { exact: false }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Verification code" }).fill("482913");
  await page.getByRole("button", { name: "Open report" }).click();
  await expect(
    page.getByRole("heading", { name: /12 Example Street/u }),
  ).toBeVisible();
  return invitationCode;
}

test.describe("recipient report", () => {
  test("requires a named invitation and a separate fresh mailbox code", async ({
    page,
  }) => {
    await page.goto("/reports/demo");
    await expect(page).toHaveURL(/\/auth\/invitation$/u);
    await page.getByLabel("Invitation code").fill("demo-invite-wrong-mailbox");
    await page.getByLabel("Email address").fill("forwarded@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "unavailable, expired, revoked, or already used",
      }),
    ).toBeVisible();
    const invitationCode = await authenticate(page);
    await page.goto("/auth/invitation");
    await page.getByLabel("Invitation code").fill(invitationCode);
    await page.getByLabel("Email address").fill("recipient@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "unavailable, expired, revoked, or already used",
      }),
    ).toBeVisible();
  });

  test("gives a 30-second overview with separate module semantics and no buy signal", async ({
    page,
  }) => {
    await authenticate(page);
    const overview = page.getByRole("region", {
      name: "Your 30-second summary",
    });
    await expect(overview).toContainText("1 major Building defect identified");
    await expect(overview).toContainText(
      "Cracked shower and bathroom floor tiles",
    );
    await expect(overview).toContainText("Several minor defects");
    await expect(overview).toContainText(
      "No visible evidence of timber pest activity was observed in the accessible areas at the time of inspection",
    );
    await expect(overview).toContainText("Material limitations");
    await expect(
      page.getByRole("heading", { name: "Building findings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Timber Pest findings" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Inspector-confirmed classification: Major defect", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Inspector-confirmed category: Conducive condition", {
        exact: true,
      }),
    ).toBeVisible();

    const text = (await page.locator("body").innerText()).toLocaleLowerCase();
    expect(text).not.toMatch(
      /\b(?:termite-free|passed|buy this|do not buy|don't buy|property score|traffic light|ai confidence)\b/u,
    );
    expect(text).not.toContain("coverage_private");
    await expect(page.locator('img[src*="/api/media/"]')).toHaveCount(2);
  });

  test("authorises curated media, ranges and formal records but denies private coverage", async ({
    page,
  }) => {
    const denied = await page.request.get("/api/media/media_bathroom_context");
    expect(denied.status()).toBe(403);
    await authenticate(page);

    const media = await browserGet(page, "/api/media/media_bathroom_context");
    expect(media.status).toBe(200);
    expect(media.headers["content-type"]).toBe("image/png");
    expect(media.headers["cache-control"]).toContain("no-store");
    const range = await browserGet(page, "/api/media/media_bathroom_context", {
      range: "bytes=0-31",
    });
    expect(range.status).toBe(206);
    expect(range.headers["content-range"]).toMatch(/^bytes 0-31\//u);
    expect(range.body).toHaveLength(32);

    expect(
      (await page.request.get("/api/media/coverage_private_001")).status(),
    ).toBe(404);
    for (const record of ["building", "timber-pest"]) {
      const response = await browserGet(
        page,
        `/reports/demo/download/${record}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/pdf");
      expect(Buffer.from(response.body).subarray(0, 8).toString("ascii")).toBe(
        "%PDF-1.7",
      );
    }
  });

  test("discloses scope before recording and exposes recorded and revoked states", async ({
    page,
  }) => {
    await authenticate(page);
    await expect(
      page.getByRole("region", { name: "Questions and report access" }),
    ).toContainText("Access expiry:");
    await page.getByText("Build Week demo actions", { exact: true }).click();
    await page.getByLabel("Recipient email address").fill("buyer@example.com");
    await page
      .getByRole("button", { name: "Create access invitation" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "buyer@example.com" }),
    ).toContainText("recorded");
    await page.getByRole("button", { name: "Revoke invitation" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "buyer@example.com" }),
    ).toContainText("revoked");
    await page.reload();
    await page.getByText("Build Week demo actions", { exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "buyer@example.com" }),
    ).toContainText("revoked");
  });

  test("persists a server-recorded contact transition across reload", async ({
    page,
  }) => {
    await authenticate(page);
    await page.getByText("Build Week demo actions", { exact: true }).click();
    await page
      .getByLabel("Finding reference (optional)")
      .selectOption("finding_cracked_tiles");
    await page
      .getByLabel("Your question")
      .fill("Please clarify the observed extent.");
    await page.getByRole("button", { name: "Save question" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Question saved in this demo" }),
    ).toBeVisible();
    await page.reload();
    await page.getByText("Build Week demo actions", { exact: true }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Question saved in this demo" }),
    ).toBeVisible();
  });

  test("lets a recipient explicitly end report access", async ({ page }) => {
    await authenticate(page);
    await page.getByRole("button", { name: "Sign out of this report" }).click();
    await expect(page).toHaveURL(/\/auth\/invitation$/u);
    await page.goto("/reports/demo");
    await expect(page).toHaveURL(/\/auth\/invitation$/u);
  });

  test("shows immutable amendment history and ignores forged withdrawal query authority", async ({
    page,
  }) => {
    await authenticate(page);
    await expect(
      page.getByRole("heading", { name: "Amendment notice" }),
    ).toBeVisible();
    await page.getByText("Version history", { exact: true }).click();
    const history = page.getByRole("table", { name: "Report version history" });
    await expect(history).toContainText("Current delivered version");
    await expect(history).toContainText("Superseded, retained");
    await expect(page.getByText(/later amendment is not added/u)).toBeVisible();

    await page.goto("/reports/demo?view=withdrawn");
    await expect(
      page.getByRole("heading", { name: "Building report withdrawn" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Building findings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Timber Pest findings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Building report PDF/u }),
    ).toHaveCount(1);
  });

  test("checks the current grant before allowing a download", async ({
    page,
  }) => {
    await authenticate(page);
    const staleSessionCookie = (await page.context().cookies()).find(
      ({ name }) => name === "inspection_recipient_session",
    );
    expect(staleSessionCookie).toBeDefined();
    const revoked = await page.evaluate(async () => {
      const response = await fetch("/reports/demo/access/session", {
        method: "DELETE",
      });
      return response.status;
    });
    expect(revoked).toBe(204);
    expect(
      (
        await page.request.get("/reports/demo/download/building", {
          headers: {
            cookie: `inspection_recipient_session=${staleSessionCookie?.value ?? ""}`,
          },
        })
      ).status(),
    ).toBe(403);
    const staleHeaders = {
      cookie: `inspection_recipient_session=${staleSessionCookie?.value ?? ""}`,
      host: "127.0.0.1:3010",
      origin: "http://127.0.0.1:3010",
      "sec-fetch-site": "same-origin",
    };
    expect(
      (
        await page.request.post("/reports/demo/access/share", {
          data: {
            email: "stale@example.com",
            expiresAt: Date.now() + 60_000,
          },
          headers: staleHeaders,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/reports/demo/access/contact", {
          data: {
            findingReference: "finding_cracked_tiles",
            message: "This stale session must not record a request.",
          },
          headers: staleHeaders,
        })
      ).status(),
    ).toBe(403);
  });

  test("supports keyboard focus, reduced motion, axe and narrow 200-percent text reflow", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await authenticate(page);
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to report content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#report-content")).toBeFocused();

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const reflow = await page.evaluate(() => ({
      body: {
        clientWidth: document.body.clientWidth,
        offsetWidth: document.body.offsetWidth,
        scrollWidth: document.body.scrollWidth,
      },
      documentElement: {
        clientWidth: document.documentElement.clientWidth,
        offsetWidth: document.documentElement.offsetWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      offenders: Array.from(document.querySelectorAll("*"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.getAttribute("class"),
            clientWidth: element.clientWidth,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            scrollWidth: element.scrollWidth,
            tagName: element.tagName,
            text: element.textContent?.trim().slice(0, 60),
          };
        })
        .filter(({ left, right }) => left < -1 || right > window.innerWidth + 1)
        .toSorted((left, right) => right.right - left.right)
        .slice(0, 12),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    expect(
      reflow.overflow,
      `Page-level reflow diagnostics: ${JSON.stringify(reflow)}`,
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("recipient-report.png"),
    });
  });
});
