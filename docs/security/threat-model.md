# Build Week threat model

**Reviewed:** 2026-07-15
**Scope:** U1-U10 synthetic/local Build Week slice
**Activation boundary:** this is an engineering threat model, not a privacy,
legal, Standards, penetration-test, or production-readiness certification.

## Trust boundaries and protected assets

The protected system is the complete evidence and professional-opinion chain,
not just the generated PDF. Its assets are immutable originals and safe
derivatives, voice-note artifacts, source packets, inspector-authored
classifications, module snapshots, approvals, report versions, recipient
capabilities, revocations, delivery/provider truth, lifecycle holds and the
append-only event history.

Five boundaries are treated independently:

1. The public booking and named-recipient web surfaces receive untrusted text,
   identifiers, links and browser requests.
2. The enrolled inspector device holds offline evidence and queues, but is not
   trusted for server authorization merely because it was previously signed in.
3. The web/API boundary authenticates the current actor, tenant, version,
   capability, device and action before calling narrow domain commands.
4. Postgres, private object storage and the worker are canonical. Original
   media remains quarantined; only independently verified safe derivatives can
   enter AI or report rendering.
5. Email, payment, calendar and model providers are untrusted side-effect
   boundaries. Requests are idempotent, outcomes remain literal and an unknown
   response is reconciled before retry.

The append-only event log stores safe state transitions and artifact references
with hashes. It does not store report prose, transcript text, addresses,
mailboxes, media bytes, credentials or provider payloads. Large or protected
content remains in the artifact store.

## Adversaries and failure assumptions

The model covers an unauthenticated internet user, a recipient with a copied or
revoked link, an authenticated user attempting another tenant or report
version, a stolen/revoked device, malicious uploaded media or filenames,
stored-XSS and prompt-injection content, replayed/forged callbacks, a stale
worker, a compromised low-assurance session, an accidentally exposed secret,
and an operator restoring an older but internally valid backup.

It also assumes ordinary failures: application termination between durable
steps, provider timeout after an external side effect, partial object writes,
out-of-order callbacks, expired leases, network loss, and divergence between a
database backup and object-store state.

## Threat and control register

| Threat                                                | Required control                                                                                                          | Automated evidence                                                  | Residual/activation boundary                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Cross-tenant IDOR or media read                       | Organization-scoped keys, RLS, assigned-inspector checks, report-version capability grants                                | SQL tenant/grant suites, sync API tests                             | Production auth principal and private-store adapter remain U12       |
| Low-assurance or stale privileged session             | AAL2, recent MFA, live `auth.sessions`, immutable session start and exact server-bound device activity                    | U10 TS and SQL security suites                                      | Production Supabase TOTP enrollment and revocation drill remain U12  |
| Admin silently authors professional opinion           | Assigned inspector; command-only approval/withdrawal with derived device and atomic hash-only audit                       | U2 invariants, U7 guards, U10 command SQL tests                     | Licensed matrix/content sign-off remains U12                         |
| Copied/revoked recipient link                         | Exact named principal, report version, module and action capability; append-only revocation                               | Recipient-access and SQL capability tests                           | Live invitation/account proof remains U12                            |
| Evidence substitution or corrupt upload               | Capture identity separate from hash; independent object read/length/hash/version; quarantine and safe proxy               | U4 recovery tests, U6 integration and 300/30 soak                   | Real private storage/decoder and provider volume remain U12          |
| Stored XSS or active media                            | Plain-text fields, context encoding, opaque filenames, restrictive nonce CSP, decode/re-encode before trust               | U10 content/header tests and static sink/CSP scan                   | Browser CSP smoke is rerun against every public deployment           |
| Prompt injection or unsupported AI prose              | Packet allowlist, exact source hashes, lazy verified skills, structured draft, deterministic guard and separate verifier  | U7 adversarial fixtures                                             | Live fixed-trial comparison and inspector holdout are not yet proven |
| Callback forgery, replay or duplicate external action | Signature verification, webhook inbox identity, transactional outbox, idempotency and literal unknown reconciliation      | U2/U6 SQL and worker tests                                          | Live provider callback/reconciliation proof remains U12              |
| Distributed abuse bypasses per-process limits         | Fixed database-owned policies/window, advisory-lock serialization, keyed identity digests and fail-closed route adapter   | U10 SQL limit/privilege suite and webhook boundary tests            | Production threshold tuning and traffic-source review remain U12     |
| Stale worker overwrites current truth                 | Lease generation/token fencing, expected revision, checkpoints and supersession                                           | U2/U6 queue tests and soak                                          | Production queue adapter remains U12                                 |
| Restore resurrects access, deletions or side effects  | Active generations; canonical eight-check SQL verifier; exact hash-bound projection; audited enable/disable; egress guard | U10 restore, delivery and SQL command checks                        | Measured production RPO/RTO and remaining adapter proof remain U12   |
| Secret disclosure or cross-environment use            | Recursive env/JWT scan; per-environment/purpose key ring; harness-owned clock; decrypt-only overlap capped at 30 days     | Static secret scan and key-ring/SQL expiry tests                    | Deployment-managed rotation and emergency revoke remain U12          |
| Sensitive telemetry leakage                           | Runtime-validated codes/counts/hashes only; non-stateful redaction; payload-free trace shape                              | Observability/redaction adversarial tests and operations projection | Production telemetry sink and alert routing remain U12               |

## Non-negotiable failure posture

- Missing or malformed tenant, session, capability, hash, version, revocation,
  object or provider evidence fails closed.
- An unknown provider outcome is not failure and is not permission to retry.
- A quarantined original is never promoted by filename, MIME declaration or AI
  confidence.
- A restored database does not re-enable workers, callbacks, email, payment,
  calendar, model calls or recipient access by default.
- No runbook authorizes direct report-row edits, event deletion, raw-database
  administration from the product UI, or recovery by inventing external truth.

## Review cadence

Review this model whenever a public route, provider, permission, data class,
mobile storage boundary, rendering path, privileged action or deployment
topology changes. Revenue Activation requires a fresh adversarial security
review, live MFA/session/device proof, a measured restore drill and canonical
public-URL verification.
