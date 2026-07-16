# Deterministic Build Week seed

`generate.mjs` produces the same synthetic/de-identified combined inspection on
every run. It uses a fixed clock, fixed UUIDs and canonical SHA-256 hashes. The
fixture contains no real customer, address, credential or provider result.

Generate the seed without changing the repository:

```bash
node scripts/demo-seed/generate.mjs --output /tmp/build-week-demo-seed.json
```

The seed deliberately leaves professional approvals, recipient access and the
physical offline/restart proof incomplete. A deterministic fixture is useful
for a demo; it is not evidence that a human, device, public URL or live service
was observed.
