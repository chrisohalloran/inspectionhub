# Inspector device revocation

1. Identify the organization, actor and registered device ID. Do not use a
   display label alone.
2. Append a device-revocation record with a bounded reason code and operator.
3. Locate durable `privileged_session_bindings` for that actor/device, revoke
   every corresponding auth session, and invalidate local sync/approval
   capabilities. Privileged activity must match the exact bound session,
   organization, actor and device; a caller cannot substitute another active
   device. The server must reject the old device even while its JWT has not
   expired.
4. Inspect queued and unknown work by immutable capture ID. Accept already
   durable server evidence; quarantine divergent or unverifiable attempts.
5. Enrol a replacement as a new device and require AAL2 plus recent MFA. Never
   transfer the old device identity or public-key hash.
6. Remote wipe is best effort. Evidence that existed only on a lost offline
   device is not recoverable from the server and must not be claimed as such.
7. Prove old-device reconnect denial and replacement-device authorization with
   a new server-created session/device binding. Also prove a fresh access-token
   `iat` does not reset the binding's absolute session start. Append only IDs,
   codes, counts, timestamps and hashes to the audit log.
