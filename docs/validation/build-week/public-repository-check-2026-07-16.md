# Public repository logged-out check

Observed at: `2026-07-16T02:43:24Z`
Observer: Codex root implementation session
Commit: `6d08e2933ccfd1607e8212aeb7cda60ec5336429`

Bounded claim: the public source repository used for the Build Week project is
reachable without GitHub authentication and exposes the expected InspectionHub
repository identity. This does not prove a public product demo, a video, a
published submission description or a completed Build Week milestone.

## Logged-out probe

Requested URL and final URL:

```text
https://github.com/chrisohalloran/inspectionhub
```

Observed result:

```text
HTTP 200
GitHub - chrisohalloran/inspectionhub: Local-first building and timber pest inspection platform built with Codex · GitHub
```

An unauthenticated `curl -L` response contained the expected repository title
and description. GitHub's repository API separately reported `PUBLIC`, the
same canonical URL and default branch `codex/building-inspection-platform`.
Remote readback returned the exact committed branch head
`6d08e2933ccfd1607e8212aeb7cda60ec5336429`.

This observation is suitable only for the milestone validator's repository
`link_check` evidence kind after its SHA-256 is recorded in an evidence input.
It must not be used as public-demo or recipient-security evidence.
