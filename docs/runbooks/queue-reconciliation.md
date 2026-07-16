# Queue and provider reconciliation

## Stuck or expired work

Confirm the task ID, tenant hash, task fingerprint, dependency state, lease
generation/token and last safe checkpoint. Recover an expired lease only under
a higher fencing generation. A stale worker must not checkpoint, confer trust
or complete work.

## Unknown external outcome

Do not retry. Query the provider using the original idempotency/reference key,
record the observed literal outcome and bind it to the original request
fingerprint. Then choose exactly one transition: completed from provider truth,
bounded retry because no side effect occurred, or manual reconciliation because
truth remains unknown.

## Dead letter or quarantine

Preserve the terminal state and reason. Fix configuration/code or replace an
invalid input through a new append-only command; never rewrite the failed
attempt. For media, only an independently verified safe derivative may leave
quarantine. For delivery, a withdrawn or stale report version cannot be revived
by replaying its old package.

## Completion proof

The operations projection must show no unexplained stuck/unknown item, every
dependency terminal, current-version pointers unchanged by stale work, and no
duplicate provider effect. Log codes/counts/hashes only.
