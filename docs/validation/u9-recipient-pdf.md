# U9 recipient portal and formal-record validation

**Validated:** 2026-07-17 (Australia/Brisbane)
**Scope:** synthetic Build Week slice with locally validated shared authority
**Production recipient-access status:** implemented but not deployed or publicly proven

## Outcome

U9 provides an accessible recipient portal for an immutable delivered report
version. It opens with a short condition overview, names major Building defects
before minor defects, states material limitations, and keeps Building and Timber
Pest conclusions in separate modules. Recipient content contains no property
score, traffic light, transaction advice, AI output, internal confidence or
private coverage gallery.

The portal and formal PDFs are projections of the same canonical report
snapshot. Publication renders every commissioned module before moving the
current pointer. Amendments retain prior versions and name the exact version
they amend. Withdrawal is a separate immutable notice that removes the affected
module from recipient access without rewriting the issued report.

Recipient access uses opaque invitations plus a separate fresh mailbox OTP.
Grants are bound to the exact principal, organisation, job, report version,
module and action. Named access requests disclose expiry before they are
recorded and cannot increase the inviter's scope or expiry. They can be revoked.
The synthetic portal does not claim that these records were sent to an email
provider. An in-flight protected operation checks the grant revision again
before returning, so revocation wins over an operation that started earlier.

The web demo uses a signed, HttpOnly session cookie and synthetic data. The
cookie is only a session reference: every report, media, PDF, share and contact
operation re-reads the current server-side grant, revocation and withdrawal
projection. Public/deployed mode uses service-only Supabase RPC commands over
append-only invitation claim, challenge completion, grant, revocation, module,
share and contact tables. Direct `anon` and `authenticated` table access and RPC
execution are denied. Share/contact authorization and mutation happen in one
database transaction under the same report advisory lock as module withdrawal.

The signed JSONL adapter remains only for `APP_ENV=test` browser E2E. It fails
closed on a contended mutation claim and cannot be selected in a public or
production application environment. The fixed OTP remains a synthetic fixture;
there is no email-provider send in this slice.

The public synthetic demo accepts share targets only in the reserved
`example.com` namespace. The current migration preserves any legacy audit row
append-only, stores only a SHA-256 identity in an immutable quarantine sidecar
and removes that row from recipient projection; every new non-reserved address
is rejected. Share and contact mutations have three independent bounds: the
shared public-boundary rate limiter, a five-action lifetime grant quota and a
25-action rolling one-hour report quota. The report advisory lock serializes
withdrawal, authority and both quota checks so minting a new grant cannot reset
the report-wide public-demo limit.

## Executed automated proof

```text
pnpm exec vitest run packages/recipient-access packages/reporting \
  'apps/web/app/(reports)/reports/_lib'
```

Passed focused tests. These cover OTP attempt and replay controls, invite
mailbox binding, grant narrowing, version isolation, expiry, revocation,
in-flight revocation, parent-to-child revocation, HMAC capability digests,
withdrawal, safe audit metadata, semantic rendering, plain-text encoding,
prohibited claims, bounded no-visible-pest language, curated-media scope,
immutable publication/amendment/withdrawal behavior, separate PDF streams, PDF
metadata and media allowlisting.

```text
pnpm test:integration
```

Passed ten migrations and six SQL suites. The recipient suite proves
service-only privileges, single-use invitation/challenge transitions,
grant/module/action fences, append-only revocation, withdrawal-aware atomic
share/contact commands, reserved-address enforcement, upgrade quarantine,
grant/report quota continuity and current portal projection. A two-connection
adversarial check holds the report lock while a concurrent sixth mutation waits;
the contender observes committed authority/quota state and leaves zero partial
records.

```text
pnpm --filter @inspection/recipient-access typecheck
pnpm --filter @inspection/reporting typecheck
pnpm --filter @inspection/recipient-access build
pnpm --filter @inspection/reporting build
pnpm --filter @inspection/web typecheck
pnpm --filter @inspection/web lint
pnpm --filter @inspection/web build
pnpm --filter @inspection/reporting lint
pnpm --filter @inspection/recipient-access lint
```

All commands passed. The Next.js production build included the invitation,
verification, recipient report, module download and transformed-media routes.

## Formal PDF proof

```text
node tests/pdf/run.mjs
```

Passed four fixtures with Poppler 26.05.0: major cracked-tile Building, the
separate Timber Pest module, no-major-defect Building and an access-limitation
case. The harness verifies A4 page geometry, marked-document metadata, page
count, required semantic-text parity, prohibited terms, PDF hashes and every
144-DPI page hash. It generated seven pages in total. Every rendered page was
also inspected as a raster montage: headings, brand bar, body copy, amendment
notices, module colors and page-number footers were visible; no clipping,
overlap, overflow or missing footer was observed.

The baseline records exact PDF and raster hashes in
`tests/pdf/baselines.json`. They intentionally fail when formal bytes change;
raster comparison is exact when the recorded Poppler version matches.

## Browser acceptance proof

```text
pnpm exec playwright test --config=e2e/web/playwright.config.ts report.spec.ts
```

Passed 16 of 16 tests against the production Next.js build/server: each of eight
journeys ran in desktop Chromium and the 320px reflow project. The suite proved:

- an unauthenticated report redirects to invitation redemption;
- a named invitation requires a separate six-digit mailbox code and cannot be
  replayed through another handler/runtime;
- the overview communicates the major defect, minor summary, Timber Pest
  conclusion and limitations without prohibited or private language;
- unauthenticated media is denied, only curated transformed media is exposed,
  range requests work and separate PDFs download;
- share expiry is visible before recording and server-recorded/revoked states
  survive a reload without claiming provider egress;
- a server-recorded contact reference survives a reload without claiming a
  notification was queued or sent;
- amendment history preserves earlier delivered versions, while a forged query
  parameter cannot manufacture withdrawal authority;
- revoking the current grant after cookie issuance makes the next PDF download
  fail with `403`;
- skip-link and keyboard focus work, reduced motion is respected, axe found no
  serious or critical issue, and 200-percent text at the narrow viewport had no
  horizontal overflow. The report-section navigation wraps rather than
  requiring horizontal scrolling when text is enlarged.

The suite deliberately runs the production build. The strict nonce-based CSP
remains intact; Next.js development mode requires `eval` for debugging and is
therefore not a valid runtime for this CSP acceptance test. Browser responses
use relative redirect locations so an infrastructure-normalized request host
cannot send the recipient to a different host. Authenticated media and PDF
checks use same-origin browser fetches, proving the actual Secure-cookie path.

A separate manual readback on 17 July used the Codex in-app browser against the
loopback-only judge build. It redeemed a unique synthetic invitation for
`recipient@example.com`, completed the separate synthetic OTP step, and
visually inspected the condition overview, module separation, limitations,
inspector attribution and access controls. It then recorded a named
`buyer@example.com` access request with the displayed expiry and a contact
reference; the UI explicitly said no email, notification or report-content
copy occurred. This is local synthetic browser acceptance, not a public URL,
provider send or human comprehension result.

## Honest completion boundary

The U9 slice is locally implemented, compiled and unit/PDF/Postgres validated
using synthetic content. Production activation still requires applying the
migration to the selected Supabase project, protected service credentials, a
real identity/OTP and transactional email provider, private object storage plus
image transformation, public-URL verification, recipient usability/
comprehension sessions, PDF/assistive-technology review and an authorized
penetration/adversarial review. No email send, live delivery, production
confidentiality, legal compliance or recipient comprehension result is claimed.
