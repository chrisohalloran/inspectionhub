# Security incident response

## Trigger

Use this runbook for suspected tenant escape, unauthorized report/media access,
credential disclosure, malicious content execution, device compromise,
event/artifact tampering, provider forgery, or sensitive telemetry exposure.

## Contain without destroying evidence

1. Record an incident ID, detection time, reporter, affected environment and
   observed facts. Do not paste media, report prose, addresses, mailboxes,
   credentials or provider payloads into chat, tickets or telemetry.
2. Disable the narrow affected route, capability, device, provider or tenant.
   If scope is unknown, disable external egress and recipient issuance before
   broadening access.
3. Revoke affected sessions and recipient grants. Append device or key
   revocation events; do not rewrite enrollment or activation history.
4. Preserve database/event snapshots, object metadata, safe traces, deployment
   identifiers and checksums. Never delete or mutate the canonical log during
   containment.
5. Rotate an exposed secret using the secret-rotation runbook. Do not place the
   old or new value in the event log.

## Determine scope

- Reconstruct by organization hash, actor/device ID, capability/report version,
  artifact reference/hash, event ID and provider idempotency key.
- Treat a missing log entry as missing proof, not proof that no access occurred.
- Check recipient revocations, withdrawals, deletion suppressions, lifecycle
  holds, stale sessions, worker leases and unknown provider outcomes.
- Compare the first observed unsafe event with the last known-good deployment
  and configuration manifest.

## Recover

Patch and verify the narrow failure, rotate affected trust material, invalidate
sessions, re-run tenant/RLS/security gates and reconcile every unknown external
outcome. If recovery uses backup data, follow the isolated restore runbook.
Re-enable one egress/provider boundary at a time and append the observed result.

## Close

Record impact, timeline, root cause, affected data classes/tenants, containment,
recovery proof, notifications decided by the authorized business/legal owner,
and preventative actions. A clean local test does not prove that production is
contained; production closure requires observed production readback.
