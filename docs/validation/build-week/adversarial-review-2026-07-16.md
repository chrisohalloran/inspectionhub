# Parallel adversarial review record

Reviewed on: 16 July 2026
Reviewed commit: `6d08e2933ccfd1607e8212aeb7cda60ec5336429`
Review boundary: model-assisted implementation, security and document review by
separate Codex subagents plus root-agent verification. This is not represented
as an external human audit or penetration test.

## Outcome

No unresolved P0 or P1 finding remained at the reviewed commit.

The adversarial passes identified and resolved these P1 classes before the
review closed:

1. packet-bound AI `runId` replay across tenant or packet authority;
2. photo acknowledgement before durable local storage;
3. a mobile durable workflow disconnected from the visible journey;
4. report delivery racing module withdrawal;
5. recipient process memory acting as authority;
6. same-revision mobile startup reconciliation dropping active state;
7. filesystem-backed recipient state and non-atomic share/contact mutations;
8. PostgreSQL microsecond expiry crossing a JavaScript millisecond boundary and
   becoming a caller-controlled equality check.

The final implementation makes the database authoritative for recipient grant
expiry and protected mutations, normalises persisted timestamps to milliseconds
at the serialization boundary, omits expiry from client identity envelopes,
uses service-only transactional RPCs, and keeps the filesystem adapter confined
to fail-closed browser fixtures. Mobile reconciliation now emits an explicit
new revision only when restored state differs.

## Verification readback

- Focused recipient and reporting tests passed.
- Nine migrations and six SQL suites passed, including the two-connection
  withdrawal/share race.
- The complete unit suite passed: 74 files, 364 tests.
- Web browser acceptance passed: 43 tests, with one intentional skip.
- Deterministic mobile acceptance passed: 29 files, 105 tests.
- Signed iOS simulator Maestro acceptance passed four flows, including explicit
  process stop/relaunch with an active investigation.
- Lint, typecheck, build, PDF, security, deterministic eval and soak gates
  passed.

This record does not convert simulator evidence into physical-iPhone evidence,
does not prove live provider or public deployment behavior, and does not replace
the later Revenue Activation legal, privacy, licensed-standards or penetration
review gates.
