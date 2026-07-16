# Isolated restore and forward recovery

Production restore is deliberately not a Build Week completion claim. The same
fail-closed sequence applies to local drills and later production exercises.

1. Restore database and object backups into an isolated environment with all
   network egress, workers, callbacks, invitations, recipient access, email,
   payment, calendar and model calls disabled.
2. Replay deletion suppressions, recipient/device/session/key revocations,
   withdrawals and lifecycle holds before exposing any restored read model.
3. Forward-reconcile events and expected revisions. Older backups must not move
   report/module/package pointers backwards or overwrite an amendment.
4. Start a new authoritative generation with
   `command_begin_restore_generation`. This immediately invalidates any egress
   enablement from an older generation for the same organization/environment.
   Run `command_verify_restore_generation`; its SQL verifier derives verdicts
   and checksum-addressed evidence from canonical tables for all eight gates:
   `artifact_checksums`, `event_replay`, `recipient_grants`,
   `deletion_suppressions`, `session_revocations`, `package_pointers`,
   `provider_truth`, and `secret_environment`. A coordinator cannot directly
   insert a passing check or supply its own pass boolean.
5. Abort if any object is missing/divergent, any event chain breaks, external
   provider truth is unknown, a revoked grant/session is present, or an older
   pointer would become current.
6. Invalidate restored sessions and rotate environment-bound secrets. Never
   promote production secret material into a preview/test restore.
7. Passing checks alone does not enable anything. A separate authorized AAL2
   administrator invokes `command_enable_restore_egress` with a unique
   idempotency key. The command appends `restore_egress_events` and its
   `privileged_action_audit` row atomically. There is no direct authenticated
   insert path and no in-process/self-attested enable switch.
   If recovery must stop, an AAL2 administrator invokes
   `command_disable_restore_egress`; this emergency disable does not depend on
   reconciliation passing, but it remains exact-generation, device-bound,
   idempotent and atomically audited.
8. The delivery worker is currently wired to require the exact trusted
   organization/session/environment projection immediately before its provider
   call. Live provider runtime construction also refuses to start without an
   injected egress guard. No event, a different environment/session, a stale
   generation, a projection-hash mismatch, incomplete checks or a disabled
   latest event is a hard denial. There are no live invitation, payment,
   calendar or model adapters in this slice; each must use the same guard before
   it can be activated, and that wiring remains an activation gate rather than
   an assumed property of future code.
9. Re-enable one external boundary at a time and log the observed result using
   the original idempotency identity. Record start, recovery point, verification
   completion, measured RPO/RTO and remaining gaps. Until a production drill is
   observed, RPO and RTO are explicitly unmeasured.
