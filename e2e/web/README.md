# Web E2E ownership

These Playwright specs cover the U3 Build Week booking and launch-administration slice:

- combined quote-to-ready success;
- payment decline, slot conflict, reschedule, and cancellation recovery;
- distinct readiness/provider states and preserved input;
- keyboard activation, 320 CSS-pixel reflow, 48-pixel minimum link/button targets, and axe;
- pricing version publication, prior-version readback, conflict preview, credential expiry, safe integration status, and permission denial.

Run with the repository's pinned Playwright container once root integration declares `@playwright/test` and `@axe-core/playwright`:

```sh
pnpm exec playwright test --config e2e/web/playwright.config.ts
```

The specs and local web-server configuration are contained here, but dependency declaration and activation of the root `test:e2e:web` gate are intentionally left to the owning root integration unit. Until those dependencies are present and this command runs, axe and real-browser E2E are implemented but not verified.
