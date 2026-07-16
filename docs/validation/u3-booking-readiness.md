# U3 booking and readiness validation

Date: 2026-07-15 (Australia/Brisbane)

## Scope proved

- A five-step synthetic combined booking keeps Building and Timber Pest as
  separately priced and described commissioned modules.
- Property, client, report recipient, invoice contact, access contact and
  assigned inspector are distinct domain roles.
- Quote and signed-agreement snapshots are immutable and versioned.
- Slot holds reject expiry, contention and same-inspector overlap.
- Payment, calendar, agreement, access, notification and booking lifecycle
  states remain literal instead of being collapsed into one success flag.
- Declined payment, expired/contended slot, reschedule and cancellation retain
  prior input and invalidate superseded authority.
- Booking webhooks are event-idempotent, reject changed replay payloads and do
  not let a late success for an old payment intent advance current authority.
- Superseded access links fail closed; a current access-contact link exposes no
  report data.
- Launch administration covers versioned pricing, availability/conflicts,
  inspector eligibility, integration truth, permission denial and history.
- Provider ports have deterministic Stripe, Google Calendar and Resend test
  adapters. Request fingerprints make repeated effects observable and live mode
  fails closed until Revenue Activation.

## Automated evidence

Commands observed green from the repository root:

```text
pnpm exec vitest run packages/agreements/src packages/booking/src packages/providers/src 'apps/web/app/(booking)' 'apps/web/app/(admin)'
11 files passed, 34 tests passed

pnpm --filter @inspection/agreements lint
pnpm --filter @inspection/agreements typecheck
pnpm --filter @inspection/agreements build
pnpm --filter @inspection/booking lint
pnpm --filter @inspection/booking typecheck
pnpm --filter @inspection/booking build
pnpm --filter @inspection/providers lint
pnpm --filter @inspection/providers typecheck
pnpm --filter @inspection/providers build

PLAYWRIGHT_USE_SYSTEM_CHROME=1 pnpm exec playwright test --config e2e/web/playwright.config.ts --workers=2
27 passed, 1 intentionally skipped desktop-only duplicate, 0 failed
```

The E2E suite covers the quote-to-ready happy path, payment failure and retry,
slot contention, slot expiry, webhook replay/tamper/stale intent, superseded
access link, reschedule, cancellation/refund/calendar projections, admin
configuration, permission denial, keyboard activation, axe analysis and 320 CSS
pixel reflow/target sizing.

`PLAYWRIGHT_USE_SYSTEM_CHROME=1` is a local-only escape hatch because the
Playwright Chromium download stalled on this Mac. CI retains pinned Playwright
Chromium installation and does not set the escape hatch.

## In-app browser evidence

The built-in Codex In-app browser was used first, as required by the repository
workflow. The following states were exercised against the local application:

- complete standard booking through signed agreement, test payment, access
  confirmation and `Ready for test inspection`;
- declined-payment retry with property and participant data retained;
- slot-contention replacement with the original hold superseded;
- launch administration and the read-only permission-denied fixture;
- desktop and 320 CSS pixel layouts with no page overflow and no product target
  below 48 CSS pixels.

The external Playwright layer was then used because repeatable axe, keyboard,
viewport and CI assertions are not sufficiently proved by a one-off visual run.

## Deliberate boundary

This proves the U3 Build Week slice using synthetic/de-identified fixtures and
test adapters. It does **not** prove live Stripe, Google Calendar or Resend
credentials, real provider delivery/reconciliation, production policy/content
sign-off, or real-customer activation. Those remain Revenue Activation gates and
must not be inferred from this evidence.
