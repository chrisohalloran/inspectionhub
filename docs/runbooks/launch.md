# Revenue Activation launch runbook

This runbook activates a frozen release candidate only after the U12 evidence
manifest is complete. It does not grant standing authority to deploy, change
DNS, message customers, enable egress or charge a card. Each external action
must be authorised, observed and logged with an idempotency key where
applicable.

## Roles and stop conditions

- **Release owner:** controls the release UUID and final activation decision.
- **Licensed inspector:** approves the Building/Timber Pest matrices,
  credentials and professional content.
- **Operations reviewer:** observes provider, worker, restore and rollback
  evidence.
- **Security reviewer:** observes MFA/session/device/secret controls.
- **Validation reviewer:** recomputes evidence/manifest checksums and confirms
  there are no unresolved P0/P1 findings.

Stop immediately for artifact loss or divergence, mixed module versions,
unapproved AI text, cross-tenant/private-media access, forged webhook
acceptance, provider truth being collapsed, a resurrected restore state,
privileged access without step-up, a secret in a client/log/artifact, a
canonical URL mismatch, or any unresolved P0/P1.

## 1. Freeze the release candidate

1. Confirm the completed Build Week manifest exists and preserve it unchanged.
2. Freeze one commit SHA, generate one release UUID and record exact web,
   worker, iOS and Android build IDs.
3. Confirm the plan, matrices, prompt/model/skill versions, agreement/report
   versions, privacy/terms and business identity are the versions under review.
4. Create a fresh Revenue Activation evidence directory. Never reuse or
   overwrite a prior manifest.
5. Keep provider egress and recipient delivery blocked while validation runs.

## 2. Configure production without copying secrets locally

1. Store Vercel, Fly, Supabase, Expo, Stripe, Google Calendar, Resend and
   OpenAI credentials only in their environment-specific managed secret stores.
2. Do not put service-role keys or provider secrets in EAS `env`,
   `NEXT_PUBLIC_*`, mobile bundles, source control, screenshots, command output
   or evidence files.
3. Bind separate least-scoped web/worker/provider credentials. Record only
   secret-version hashes or managed-store references.
4. Execute the dual-key/decrypt-only/retire/emergency-revoke drill from
   `docs/runbooks/secret-rotation.md`; observe cross-environment denial.
5. Enrol privileged accounts in TOTP and test AAL1 denial, AAL2 plus recent
   step-up, stale step-up, idle and absolute expiry, fresh-JWT-after-absolute
   expiry, session/device/grant revocation and alternate-device substitution.

Do not create an OpenAI API key merely to make the gate green. If a key is
created under explicit authority, place it directly into the managed production
secret store, restrict it to the intended project/environment and rotate it if
it ever enters a local file, shell history, log or evidence artifact.

## 3. Deploy the frozen artifacts

1. Apply every Supabase migration from the exact frozen commit before deploying
   any web or worker artifact. Read back the applied migration state; do not
   treat a submitted migration command as success.
2. Using the protected service credential in the deployment environment, run
   `pnpm deployment:preflight:recipient`. It must observe
   `recipient-demo-public-bounds-v2`. A missing, stale or unreachable contract
   is a hard stop: the application must never be deployed first because that
   would disable recipient mutations against the older database contract. The
   configured Vercel build wrapper enforces the same check for `production` and
   rejects a missing or unknown `VERCEL_ENV`; `preview` and `development` builds
   remain credential-independent and skip the production database preflight.
3. Exercise one authorised synthetic grant through portal state, independent
   Building/Timber Pest withdrawal, share and contact RPCs, then remove or
   revoke it. Preserve only redacted observations and contract/version hashes.
4. Deploy the web commit to the Vercel production project in `syd1` only after
   the database-first preflight passes.
5. Deploy the durable production worker to Fly `syd` with graceful SIGTERM and
   rolling replacement. Confirm the current worker no longer rejects live mode
   and that Postgres/private-object-store adapters, fenced leases and egress
   control are active before recording success.
6. Produce App Store/TestFlight and Play Store/internal-test builds from the
   exact EAS production profile using remote credentials.
7. Read back the actual deployment/build identifiers and bind them to the
   release input. A platform build log is not user-facing proof.

## 4. Prove restore before enabling egress

1. Restore into an isolated environment with provider, callback, worker and
   recipient-access egress default-off.
2. Measure RPO/RTO against predeclared targets.
3. Reconcile artifact checksums, event replay, recipient grants, deletion
   suppressions, session invalidation, package/current pointers, provider truth
   and worker/outbox state.
4. Confirm zero resurrected revoked access, suppressed data, stale session,
   current-pointer regression, provider call or repeated side effect.
5. Enable restore egress only through the audited transition after all eight
   checks pass. Preserve the default-off, failed and enabled observations.

## 5. Run controlled live-provider proof

Use controlled non-customer subjects and unique idempotency keys. Observe
provider references and application reconciliation; store hashes, never raw
tokens or personal details.

- **Stripe:** checkout, replay deduplication, payment-preserving reschedule,
  observed refund and unknown-outcome reconciliation.
- **Google Calendar:** FreeBusy, create, reschedule, cancel and unknown-outcome
  reconciliation.
- **Resend:** accepted send, delivered/terminal state, duplicate suppression and
  bounce/failure reconciliation to a named authorised test mailbox.
- **OpenAI:** development and locked-holdout release evals, manual fallback on
  timeout and verified `store: false`/redacted trace boundary.

Never infer provider success from the request leaving the app. Record the
observed provider result and subsequent system-of-record readback.

## 6. Complete device, human and accessibility validation

1. Run the full 300-photo/30-note/10-investigation durability and field journey
   on a physical iPhone 12-or-slower floor.
2. Repeat the identical durability oracle on a Pixel 6-or-slower physical or
   approved managed-cloud floor.
3. Include offline/termination, revocation/lost-device, sunlight, wet hand,
   light glove, one hand, interruption, 200% text, reduced motion, audio off and
   haptics off.
4. Lock the sample census before sessions: three inspector jobs, five
   recipients and five clients. Record every recruited session, including
   failures and assistance.
5. Complete the web/iOS/Android assistive-technology journeys with no blocking
   or serious/critical automated finding.

## 7. Verify canonical public URLs

1. Assign every host in
   `scripts/release-validate/production-domains.json` to the production Vercel
   project and make the authorised DNS changes.
2. From a logged-out browser, request the exact query-bearing probe URL for
   every canonical, `www` and legacy host.
3. Record initial status, each redirect hop, final URL, deployment ID, HSTS,
   expected branded content, auth boundary, private-media denial and absence of
   report identifiers.
4. Capture a screenshot and HTTP observation, checksum both, and confirm
   campaign path/query preservation.

## 8. Validate, approve and activate

1. Run all 11 stable release commands against the frozen commit.
2. Obtain licensed/professional reviews and adversarial implementation,
   security, data-integrity, accessibility, product-boundary and document
   review with no unresolved P0/P1.
3. Populate the fixed rubric and must-pass gates, then run:

   ```sh
   node scripts/release-validate/run.mjs --evidence <evidence-input.json>
   ```

4. Independently recompute every artifact checksum and the manifest canonical
   payload checksum.
5. The release owner records approval, then enables normal worker/provider and
   recipient egress through the audited control. Validation alone must not
   perform activation.
6. Recheck the exact canonical public URLs after activation.

## 9. First legitimate paid booking

The first customer is an outcome, not a fabricated software gate. When it
occurs:

1. observe the canonical funnel, live paid state and confirmed booking state;
2. reconcile the payment, calendar, agreement, access and notification records;
3. create one redacted evidence record containing only opaque hashes, amount in
   minor AUD units and the authority/funnel/provider reference hashes; and
4. rerun the validator with `commercialOutcome.status: observed` to emit the
   separate `revenue_activation.first_paid_booking.observed` event.

Do not use an owner card, synthetic booking, provider test mode or a screenshot
to claim first revenue.

## Rollback

1. Block provider/worker/recipient egress through the audited control.
2. Suspend new booking/approval/delivery actions without rewriting professional
   state or deleting evidence.
3. Revoke affected sessions, devices, recipient grants and secrets.
4. Reconcile provider unknown outcomes before retry or compensation.
5. Preserve current/prior report versions, delivery states, audit events and
   the failed release manifest.
6. Restore the last known-good immutable release only after its exact public
   URLs and system-of-record state are observed; do not reuse the failed
   release UUID.
