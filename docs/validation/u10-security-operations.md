# U10 security, observability and failure-operations validation

**Validated:** 2026-07-16
**Scope:** synthetic/local Build Week slice
**Production security status:** not activated or proven

## Outcome

U10 now has one application vocabulary for privileged actions, centralized
authorization and capabilities, plain-text/context-encoding helpers,
environment/purpose-bound dual-key metadata, a database-wide fixed-policy rate
limiter with keyed hashes, exact Origin checks, restrictive headers/CSP,
redacted telemetry, payload-free trace inspection, stuck/unknown/dead-letter
projections and a fail-closed canonical eight-check restore verifier sourced
from Postgres.

Both restore-egress transitions share the same fail-closed privileged-action
contract: `enable_restore_egress` and the emergency
`disable_restore_egress` require an AAL2 administrator, current durable session
and bound active device, with an atomic hash-only audit record.

Every restore begins a monotonically newer organization/environment generation,
which invalidates older enablement. The service cannot insert passing restore
checks: `command_verify_restore_generation` derives all eight verdicts from
canonical tables. Runtime enablement is bound in constant time to the exact
organization, restore session, environment and trusted projection hash. The
delivery provider boundary is wired to that guard; live provider construction
also refuses to start without it. Future live invitation/payment/calendar/model
adapters remain activation-gated until they are wired and proven separately.

The Postgres boundary independently verifies AAL2, recent MFA, bounded absolute
age from an immutable session start (not refreshable JWT `iat`), the live
`auth.sessions` row, current actor/tenant membership, recent activity for the
exact session-bound device and a registered non-revoked device. Approval and
withdrawal are command-only: authenticated users have no direct insert grant,
and each successful domain mutation commits atomically with its hash-only audit
record. Enrollment, session/device binding and activity, revocation, privileged
audit, restore evidence/enablement and secret-key metadata are service-mediated,
RLS-forced and append-only.

Public synthetic access and booking callback routes now use a fail-closed
Supabase RPC for rate limiting. Postgres owns the clock, one-minute windows,
fixed policy limits and advisory-lock serialization across processes. Routes
send only a keyed SHA-256 digest; authenticated and service roles cannot write
or inspect rate-limit buckets directly. Buckets retain only aggregate counts
and have a narrow fixed 24-hour pruning command, avoiding an unbounded request
event log.

The operations UI is a synthetic, content-free projection. It returns not found
in production and unless `OPERATIONS_DEMO_MODE=true`; it is not a raw database
administration surface.

## Executed proof

```text
pnpm test:integration
```

Passed eight migrations and five portable SQL suites. U10 cases cover an
assigned inspector success path, caller-independent bound-device derivation,
cross-tenant denial, unknown-action denial, AAL1 command denial, JWT-refresh
resistant absolute-session expiry, missing auth-session denial, immediate bound
device revocation, atomic/idempotent approval and withdrawal commands,
exact approval-to-withdrawal tuple binding, durable structured guard denials,
service-mediated writes, append-only history, fixed database-wide rate-limit
breach, default-off restore egress, active-generation invalidation, canonical
all-eight restore verification, audited administrator enablement and emergency
disablement, plus a maximum 30-day decrypt-only overlap.

```text
node scripts/security-check/static-security-check.mjs
```

Passed recursive `.env*` (including `.env.example`) and JWT/credential checks,
unsafe rendering/DOM execution sink, publicly exposed privileged environment
variable, wildcard-CORS and nonce-CSP checks.

```text
node scripts/security-check/dependency-audit.mjs
```

OSV inspected 788 locked npm packages. High, critical and unknown/unparseable
severity advisories are blocking; low/moderate findings remain visible. At this
run no blocking advisory was found.
Two moderate transitive findings remain visible: `postcss@8.4.31`
(`GHSA-qx2v-qp2m-jg93`) through Next and `uuid@7.0.3`
(`GHSA-w5hq-g745-h8pq`) through Expo/Xcode tooling. They are not hidden or
described as zero vulnerabilities. Major-version forcing of Expo's build-time
UUID dependency was rejected as a riskier unverified override; both remain in
the activation review queue.

```text
pnpm exec vitest run --config vitest.config.ts \
  packages/security/src/security.test.ts \
  packages/observability/src/observability.test.ts \
  packages/delivery/src/delivery-service.test.ts \
  packages/providers/src/provider-adapters.test.ts \
  apps/web/app/api/webhooks/access/route.test.ts \
  apps/web/app/api/webhooks/booking/route.test.ts \
  apps/web/app/api/webhooks/rate-limit.test.ts
```

Passed 62 focused tests. The active `pnpm test:security` gate runs its security
slice, the live OSV scan and the complete Postgres integration suite together.

## Must-pass rubric

- **Isolation:** tenant, actor, device, module assignment, capability and report
  version are exact; missing context fails closed.
- **Privileged trust:** no AAL1, stale MFA, expired/idle/revoked/missing session,
  wrong-role or revoked-device authorization; absolute age comes from the
  durable binding and device identity cannot be caller-selected.
- **Professional boundary:** AI/admin/support cannot approve, amend or withdraw
  the inspector's opinion; approve/withdraw writes use audited commands only.
- **Content safety:** no raw HTML execution sink; plain text is encoded by
  context; scripts require a nonce; uploaded originals stay quarantined.
- **Secret safety:** no privileged key in client/source/telemetry; key use is
  environment and purpose bound; decryption time is harness-owned; rotation
  supports one decrypt-only predecessor for no more than 30 days.
- **Abuse resistance:** public access/callback boundaries fail closed over an
  atomic shared database limiter; policy, limit, window and clock cannot be
  caller-selected; persisted keys are one-way digests only.
- **Operational truth:** stuck, unknown, failed and blocked stay literal; trace
  and event identifiers/metadata accept bounded allowlisted codes only and trace
  inspection contains no payload.
- **Recovery:** restore egress cannot open without the current generation's
  canonical eight-check pass, exact trusted projection and an audited AAL2
  administrator event; emergency disable is immediate and independent of the
  verifier. Existing delivery/provider boundaries fail closed on mismatch.

## Honest completion boundary

The Build Week U10 slice is locally implemented and gated. Production still
requires deployed Supabase TOTP enrollment, observed server-session/device
revocation, deployment-managed secret rotation, real private storage/decoder,
production telemetry and alerts, an authorized measured no-egress restore,
live provider reconciliation, wiring/proof for future external adapters,
production rate-limit threshold/load validation, penetration/adversarial review
and canonical public-URL/header verification. No RPO, RTO, production
containment or compliance result is claimed here.
