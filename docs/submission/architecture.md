# Build Week architecture

## System boundary

InspectionHub is one tenant-aware modular monolith with three runtime surfaces:
an Expo field client, a Next.js web application and a continuously running Node
worker. Postgres stores canonical facts; private object storage holds original
media and rendered artifacts. A transactional outbox and fenced task queue
provide recovery without introducing a message broker for the MVP.

## Field capture

The field client assigns one capture identity, writes a partial file, invokes a
native durable synchronisation boundary, computes a content hash, atomically
renames within the app-owned filesystem and transactionally inserts the SQLite
artifact/queue rows before acknowledging success. Startup adopts or quarantines
orphans without creating a second capture identity. AI and network work happen
after that capture boundary.

The repository implementation and simulator contracts do not substitute for
the required Build Week physical-iPhone observation. That prerequisite remains
blocked until checksum-linked device evidence exists.

## Domain and continuity

Every meaningful transition—capture, task attempt, verifier result, approval,
package, delivery outcome, recipient grant/revocation and failure—is recorded
as a typed event or immutable record. Large files stay in private storage and
the event log retains their identifier, version, size, checksum and provenance.
Side effects use idempotency keys; provider accepted, sent, delivered, failed
and unknown states remain literal.

## Agent harness

The report-drafting model receives a planner-selected, hash-bound evidence
packet. Its narrow tools read only authorised packet content or lazily load a
verified domain skill. The harness owns budgets, timeouts, persistence,
staleness, exact-version compare-and-set, telemetry redaction and allowed tool
sequences. Deterministic guards and an independent verifier reject:

- factual clauses without source references;
- lost qualifications or unsupported certainty;
- autonomous final classification;
- Building/Timber Pest taxonomy leakage;
- purchase, negotiation, valuation, repair-cost, legal or guarantee language;
- unsafe “no termites” or unbounded “not observed” claims;
- any attempted approval, recipient, provider or delivery authority.

The inspector can reject, edit/reverify or replace the draft with human-authored
content. Model outage never blocks capture or manual completion.

## Professional module boundary

Building and Timber Pest share original evidence but not taxonomy, conclusion,
snapshot or approval. Each module has an immutable current version. An edit
invalidates only its own approval. Combined delivery freezes exactly the
commissioned, currently approved versions plus a verified durability manifest;
partial or mixed-version packages fail closed.

## Recipient and security boundary

Reports are not anonymous bearer links. A named recipient redeems an invitation
and receives a short-lived capability scoped to exact report version, module
and action. Private original media is not directly public. Revocation and
historical-version checks occur server-side. Untrusted text is rendered as
text, not executable markup; web responses apply a nonce-based content security
policy and restrictive headers. Validation artifacts and telemetry are
allowlisted and redacted.

Build Week proves these boundaries with synthetic data and fake/test adapters.
Production MFA/session enforcement, secret rotation, live providers, retention,
restore, lifecycle and canonical domains remain Revenue Activation work.
