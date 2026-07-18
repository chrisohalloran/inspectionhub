# Physical iPhone evidence protocol

Do not fill this protocol from simulator output, an Expo export, source review
or a unit test.

Record before the run:

- run ID and UTC start time;
- physical iPhone model, iOS version, app build/runtime, native module version
  and the exact installed `appCommitSha`, which must equal the milestone
  `run.commitSha`;
- free storage, battery percentage, charging state and thermal state;
- benchmark profile version and checksum;
- inspector role attestation and confirmation that the job is
  synthetic/de-identified.

Observe one continuous field-only journey:

1. Open the seeded combined Building + Timber Pest job.
2. Capture linked cracked-tile photo and voice evidence plus at least one
   unlinked context photo.
3. Confirm durable local acknowledgement within the declared performance
   profile and show the shutter did not wait for network/AI.
4. Attach recent evidence, inspect adjacent surfaces, record extent and preserve
   concealed-condition uncertainty.
5. Activate airplane mode, capture, terminate at each declared persistence
   boundary, relaunch, reconcile and verify the same capture IDs.
6. Exercise AI suggestion/edit/reverify and complete manual provider-outage
   fallback.
7. Approve Building and Timber Pest independently and show the exact-version
   package blocked until both are current.
8. Leave delivery fake-sent or durably queued without desktop reconstruction.
9. Exercise sunlight, one-handed, wet-hand/light-glove, VoiceOver, 200% text,
   sound-off and haptics-off states required by the Build Week profile.

Save raw samples, device recording and structured result under one unique
`artifacts/validation/<run-id>/` directory. Compute SHA-256 after capture.
Failures and assistance remain in the record; do not trim them from the proof.

## Current signing blocker (17 July 2026)

The connected iPhone 16 Pro is visible to Xcode with Developer Mode enabled,
and the developer-disk-image service mounts. A Debug build of the current
workspace was attempted with automatic signing for the configured development
team and reached provisioning. Xcode then failed with exit 65:

```text
No Accounts: Add a new account in Accounts settings.
No profiles for 'co.inspectionhub.field' were found.
```

No app from this source state was installed on the physical phone, so no
physical-device journey, timing, accessibility or recovery proof is claimed.
The next authorised run must first sign in the matching Apple developer account
and create/download an iOS App Development profile for
`co.inspectionhub.field`; it must then execute the complete protocol above
against the exact final commit.
