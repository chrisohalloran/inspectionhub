# U6 server evidence sync and durable queue validation

Date: 2026-07-15
Scope: synthetic/local U6 slice; no live provider, customer, or production-media calls

## Outcome

U6 now has a production-evolvable evidence-sync boundary and a deterministic
local adapter. An upload is staged under a tenant/job/capture/artifact key, uses
a short-lived capability, and is not acknowledged as server-durable until a
separate `head` plus full object read agrees on byte length and SHA-256. The
durability commit preserves capture identity independently from content hash and
atomically records the artifact, receipt, safe event, content-validation task,
and outbox observation in Postgres.

Durability deliberately does not imply content trust. Originals stay under the
`quarantine/` namespace. MIME/magic-byte, active/polyglot, byte,
dimension/duration, and decoder checks run before the sandbox adapter emits a
metadata-stripped, re-encoded object under `safe/`. That derivative is also
independently headed, read, length/hash/version checked, and committed under the
active worker fence before it becomes trusted. The only downstream AI boundary
resolves inspector selection through a tenant/job-authorized provenance port
and forces `store: false`; it rejects forged safe DTOs, cross-job selection,
original/quarantine paths and direct personal/property fields.

The asynchronous harness uses bounded retries, dependencies, generation plus
token fencing, lease expiry recovery, heartbeat/checkpoint guards, safe tool
events, literal unknown outcomes, terminal dead-letter state, dependency
cancellation, and packet-revision supersession. Checkpoints contain artifact
references and hashes, not media or report content.

The local route finalisation now creates runnable queue work without a manual
test enqueue. A persistent worker-loop primitive polls until graceful shutdown,
heartbeats long handlers and persists fingerprint-bound unknown-provider
observations even when the original lease expires. The SQL queue has equivalent
unknown-observation and observed-reconciliation transitions.

The U5 SQLite capture snapshot is useful device proof, but it is explicitly not
server persistence proof. The additive server migration now provides
tenant-safe `investigations`, `investigation_revisions`,
`investigation_areas`, `investigation_artifacts`, append-only area corrections,
`investigation_notes`, `measurements`, `inspection_areas`, and links to the
commissioned module instances. Protected note bodies remain artifactized;
revision transitions append tamper-evident session events.

## Proof matrix

| Boundary               | Automated proof                                                                                                                                                             | Result |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Tenant/job staging     | Wrong organization, unassigned job, unsafe path and bad capability are rejected                                                                                             | Pass   |
| Independent durability | Original and safe proxy validation are repeated by object `head`, read, version, byte count and SHA-256 before their respective commits                                     | Pass   |
| Immutable identity     | Same capture/same hash replays; same capture/changed hash quarantines; two genuine captures with identical bytes keep two identities                                        | Pass   |
| Crash recovery         | Deterministic soak restarts after intent, after object write, and after committed finalisation with a lost response                                                         | Pass   |
| Quarantine             | MIME/magic mismatch, active/polyglot bytes, malformed decoder input, dimension and duration limits are terminal and visible                                                 | Pass   |
| Safe derivation        | JPEG, HEIC, WAV and M4A fixtures are probed; safe proxy has its own ID/hash/provenance and contains no source EXIF/GPS marker                                               | Pass   |
| Downstream trust       | OpenAI adapter requires tenant/job-resolved accepted proxy provenance, opaque IDs, protected refs and `store: false`                                                        | Pass   |
| Reconciliation         | Consistent, object-only, row-only, missing-object, divergent-checksum, duplicate-attempt, unknown-provider, content-quarantine and deletion-suppression states are explicit | Pass   |
| Worker fencing         | Lost leases are recovered under a higher generation, stale trust/completion is rejected, and long work heartbeats                                                           | Pass   |
| Queue terminal states  | Retry, fingerprint-bound unknown reconciliation, dependency cancellation, supersession and dead-letter outcomes remain literal                                              | Pass   |
| Route-to-worker path   | API finalisation atomically creates fake durable work and a worker consumes that exact queued task                                                                          | Pass   |
| Investigation server   | Tenant RLS, module/area/artifact integrity, contiguous revisions, append-only history, terminal closure and protected notes are SQL-tested                                  | Pass   |
| Packet change          | Older in-flight or completed packet work is superseded by a newer revision                                                                                                  | Pass   |
| Scale profile          | 300 photographs plus 30 audio notes survive airplane capture, app restart and worker restart with 330 unique originals and 330 unique proxies                               | Pass   |

## Commands and observed evidence

```text
pnpm --filter @inspection/storage lint
pnpm --filter @inspection/storage typecheck
pnpm --filter @inspection/task-queue lint
pnpm --filter @inspection/task-queue typecheck
pnpm --filter @inspection/provider-openai lint
pnpm --filter @inspection/provider-openai typecheck
pnpm --filter @inspection/worker lint
pnpm --filter @inspection/worker typecheck
pnpm --filter @inspection/web lint
pnpm --filter @inspection/web typecheck
```

All passed.

```text
pnpm exec vitest run \
  packages/storage/src/storage.test.ts \
  packages/task-queue/src/task-queue.test.ts \
  packages/providers/openai/src/openai-boundary.test.ts \
  apps/worker/src/tasks/evidence-handlers.test.ts \
  apps/web/app/api/sync/api.test.ts \
  --config vitest.config.ts
```

Result: 5 files, 31 tests passed.

```text
pnpm test:soak
```

Result: the U6 300-photo/30-audio test passed. It asserted 330 unique durable
artifact identities, 330 durability receipts, 330 safe proxies, all tasks
succeeded after one lost lease, no stale completion, and no reconciliation
state outside `consistent` plus the deliberately exercised idempotent replay
observations.

```text
pnpm test:integration
```

Result: 6 migrations and 3 portable SQL suites passed. U6 SQL proof covers
cross-tenant path rejection, the atomic artifact/receipt/event/task/outbox
commit, replay versus hash divergence, distinct identical-byte captures,
append-only fenced assessments, dependencies, checkpoints, stale fencing,
unknown-outcome reconciliation, safe-storage policy parsing, dead-lettering,
and completed-AI supersession. The third suite is the server-side proof for U5
investigation history; the mobile SQLite snapshot is not treated as that proof.

```text
pnpm --filter @inspection/storage build
pnpm --filter @inspection/task-queue build
pnpm --filter @inspection/provider-openai build
pnpm --filter @inspection/worker build
pnpm --filter @inspection/web build
```

All package builds passed. The Next production build includes the four dynamic
sync routes.

## Shared integration handoff

At the U6 handoff, the root integration owner accepted two shared-file actions:

- refresh `pnpm-lock.yaml` for the new `apps/web` workspace dependency on
  `@inspection/task-queue`; U6 deliberately did not modify the lock while U4
  owned it;
- add `pnpm test:soak` to `.github/workflows/ci.yml`; the soak gate is active in
  `scripts/verification/gates.json`, but the CI workflow did not yet invoke it
  during this subtask's final audit.

These are repository-integration actions, not substitutes for the green local
soak and Postgres evidence recorded above.

## Quality rubric

U6 is acceptable only while all of these remain true:

- **Integrity (must pass):** no durability acknowledgement without an
  independently readable length/hash match; zero missing or duplicate capture
  identities in the benchmark.
- **Isolation (must pass):** the organization and assigned job control the
  staging key and finalisation; new persistence tables are deny-by-default and
  service-only.
- **Trust separation (must pass):** originals never become AI/report inputs;
  only safe proxies with recorded derivation cross that boundary.
- **Recovery (must pass):** every upload boundary is idempotently restartable;
  stale workers cannot confer trust, checkpoint or complete; heartbeat and
  unknown-observation paths do not silently duplicate provider work.
- **Terminal visibility (must pass):** quarantine, unknown, superseded,
  cancelled and dead-letter states are not collapsed into success or hidden
  retry loops.
- **Privacy/observability (must pass):** events and checkpoints carry IDs,
  counts, codes and hashes only; no sensitive bytes, transcript text, address,
  contact detail or report prose is logged.
- **Scale (must pass):** the declared 300/30 fixture reconciles exactly after
  simulated app and worker loss.

## Activation boundary

The checked-in web runtime is intentionally an in-memory test/development
adapter and refuses production use unless explicitly enabled. Its queue is
process-local. The worker executable now runs a persistent, graceful local
loop, but live mode fails closed until the U12 Supabase private-Storage/Postgres
adapter connects the separately deployed web and worker processes. Production
also requires authenticated server principal extraction and deployment
configuration. Authenticated Storage clients can read only `safe/{org}/...`;
quarantine uploads are server-mediated and client insertion is not granted.
The deterministic decoder is a bounded test adapter; production must run a real
isolated image/audio decoder and codec re-encoder with resource limits and the
same interface. The OpenAI implementation is a deterministic fake only; it
makes no live call. These are explicit revenue-activation gates, not implied
production proof.
