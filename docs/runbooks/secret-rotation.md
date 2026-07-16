# Secret rotation and emergency revocation

1. Select the exact environment and purpose. Keys are never shared across
   development, test, preview and production or across signing, encryption and
   webhook duties.
2. Create the new key in the deployment secret manager. Record only a SHA-256
   key identifier and safe event; never store the key in Postgres, logs, source,
   tickets or client bundles.
3. Deploy dual-read/single-write: new work uses the new key while bounded
   in-flight work may verify/decrypt with the previous key.
4. Verify new issuance and old in-flight reconciliation with idempotent test
   identities. A wrong-environment or wrong-purpose key must fail closed.
5. Move the prior key to decrypt-only with a required
   `decrypt_only_until` timestamp, then retire it after that bounded window and
   observed queue reconciliation. Decryption fails closed at the expiry instant;
   a decrypt-only event without a future expiry or with an overlap greater than
   30 days is rejected. The runtime uses its injected trusted clock; callers do
   not supply decryption time. Revoked/retired keys cannot issue or authorize
   new work.
6. For suspected compromise, revoke immediately, disable the affected external
   boundary, invalidate related sessions/capabilities, reconcile unknown work
   and follow the incident runbook. Availability does not outrank containment.
