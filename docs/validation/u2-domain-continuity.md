# U2 domain, tenancy and continuity validation

Status: **local PostgreSQL 14 and TypeScript gates passing; PostgreSQL 17 CI branch pending**
Validated: 2026-07-14 (Australia/Brisbane)

## Evidence

| Boundary                                    | Proof                                                       | Result                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts and pure domain rules      | `pnpm test`, `pnpm lint`, `pnpm typecheck`                  | Passing                                                                                                                                         |
| Empty-database migration                    | `pnpm test:integration`                                     | Four migrations applied to a disposable cluster                                                                                                 |
| Tenant and capability isolation             | SQL assertions executed as `authenticated` identities       | Cross-tenant reads/writes denied; recipient access limited to granted report version and selected media; revocation fails closed                |
| Immutable evidence and professional history | SQL mutation attempts and TypeScript transition tests       | Update/delete denied; amendments, withdrawals and lifecycle holds append records                                                                |
| Module separation                           | Schema and SQL negative tests                               | Building classifications cannot enter Timber Pest findings; one immutable artifact may support each module without duplicating capture identity |
| Capture identity                            | Schema, SQL and TypeScript tests                            | Equal bytes may have distinct capture IDs; one capture ID remains unique per tenant                                                             |
| Approval and package integrity              | Domain and deferred database constraints                    | Stale revisions and ineligible findings rejected; a combined package binds the exact commissioned snapshot set                                  |
| Idempotency and worker fencing              | Domain fingerprint tests plus SQL uniqueness/function tests | Same request is a replay; changed request under the same key is rejected; stale lease generation cannot complete work                           |
| Event continuity                            | Hash-chain and append-only tests                            | Gaps, reordering, prior-hash mismatch, update and delete rejected                                                                               |
| Replay and upcasting                        | `packages/domain/src/replay.test.ts`                        | Raw v0/v1 history is verified before upcasting; lifecycle replay is deterministic; checkpoints recheck the complete raw prefix                  |
| Native database role context                | `packages/db/src/db.test.ts`                                | Tenant, actor, membership role and assurance claims are set transaction-locally; invalid roles/identities fail before a transaction opens       |

The SQL suite deliberately rolls back its fixtures. When no external URL is
provided, the repository harness starts and destroys an isolated PostgreSQL
cluster. CI repeats the same gate against PostgreSQL 17.

## Version boundary

PostgreSQL 15 and later create report-current-state views with
`security_invoker = true`. PostgreSQL 14 cannot parse that option, so the
migration uses a version-gated service-role-only fallback. The local
PostgreSQL 14 branch is observed passing. The PostgreSQL 17 branch is declared
but remains pending until CI executes it.

## Completion boundary

Deterministic replay and legacy-event upcasting are validated separately in the
domain replay suite. Compaction checkpoints are projections over raw immutable
history and must never replace it.

Not proved here: Supabase Storage behaviour, a hosted Supabase migration,
production provider callbacks, restore isolation, or external side effects.
Those remain later-unit or Revenue Activation gates.
