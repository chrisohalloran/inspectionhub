# Deployment Topology Decision

- Status: accepted for scaffolding; external activation remains gated
- Decision date: 2026-07-14
- Scope: U1 topology, account prerequisites, connection boundaries, secrets, DNS and cost assumptions
- Governing plan: `docs/plans/2026-07-14-001-feat-building-timber-pest-inspection-platform-plan.md`

## Decision

Use one Australian-region modular monolith with a separately deployed, continuously running worker:

| Surface                                                   | Selected platform and region                 | Runtime boundary                                                                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js public, booking, administration and recipient web | Vercel, Sydney compute region `syd1`         | Server functions perform trusted web actions; the browser never receives service-role credentials.                                                                  |
| Postgres, Auth and private object storage                 | Supabase, `ap-southeast-2`                   | Postgres is canonical. Row-level security and server checks enforce tenant, module, grant and privileged-action boundaries. Storage buckets are private.            |
| Async task, media-safety and PDF worker                   | Fly.io, Sydney region `syd`                  | One continuously running Node container leases fenced `async_tasks` rows. Its image pins the Chromium version and image digest used for PDF rendering.              |
| Native field client                                       | Expo development builds and EAS Build/Update | Separate `development`, `preview` and `production` profiles/channels use app-version runtime compatibility. An update may not cross an incompatible native runtime. |

No message broker is introduced for the MVP. Postgres `async_tasks`, fenced leases, a transactional outbox and append-only events are the durable coordination boundary.

## Domain and DNS routing

The selected host split is:

- `inspectionhub.co` and `www.inspectionhub.co`: InspectionHub product/acquisition surface.
- `app.inspectionhub.co`: authenticated inspector and administration surface.
- `reports.inspectionhub.co`: named-recipient report experience; report media remains grant-checked and is not exposed through public Storage URLs.
- `seeitinspections.com.au` and `www.seeitinspections.com.au`: See It Inspections service/acquisition surface.
- `buildingpestinspectiongoldcoast.com.au` and `www.buildingpestinspectiongoldcoast.com.au`: canonical Gold Coast acquisition surface, routed to the relevant See It Inspections service page.

The currently held defensive/legacy domains `buildingpestinspectiongoldcoast.com`, `buildinginspectiongoldcoast.com`, `buildinginspectiongoldcoast.com.au`, `seeitinspections.com` and `houseinspect.co` are not additional products. If retained for launch, each is a path-preserving redirect to its reviewed canonical host; otherwise it remains parked and is explicitly absent from campaign links. Their final redirect/parking matrix is a Revenue Activation record and every enabled alias, including `www`, must be checked from the public internet.

All hosts terminate at the same Vercel project and are separated by host routing, not divergent applications. The current DNS provider remains authoritative. A platform-issued `vercel.app` URL is acceptable for the Build Week public demo when it is checked directly and recorded in the milestone manifest. Custom-domain creation, DNS mutation, redirects and canonical-host activation require separate user authority and are Revenue Activation gates. Revenue Activation must verify every canonical host plus `www` and any retained marketing aliases from the actual public internet before release.

## Database connections and pooling

Connection use is deliberately bounded:

| Caller                               | Connection mode                      | Assumption                                                                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel server functions              | Supabase managed transaction pooler  | Runtime ORM/driver must support transaction pooling, must not depend on connection-local state, and must disable named prepared statements where the driver requires it. Cap each function instance at one database connection.                |
| Vercel recipient portal routes       | Supabase REST RPC                    | Recipient invitation, challenge, grant, revocation, withdrawal, share and contact state uses service-only transactional commands. Public mode fails closed without server-only Supabase configuration; the JSONL adapter is test-harness-only. |
| Fly worker                           | Supabase managed session pooler      | Use a bounded application pool with maximum 10 connections per worker process. Worker concurrency must remain at or below the measured database and provider limits.                                                                           |
| Migrations and controlled operations | Direct database connection           | Used only by CI/release operations with a separately scoped secret; never exposed to web or mobile clients.                                                                                                                                    |
| Browser and mobile clients           | Supabase client connection under RLS | Use publishable client credentials only. Service-role credentials are prohibited.                                                                                                                                                              |

Initial database safety assumptions are a 30-second statement timeout and a 5-second lock timeout for trusted application operations, with shorter request timeouts at the HTTP boundary. Pool size, task concurrency and timeouts are configuration, not code constants, and must be load-tested before Revenue Activation. If a selected Supabase plan or region does not provide the assumed pooler mode or connection allowance, deployment validation fails; it must not silently fall back to unpooled serverless connections.

## Accounts, plans and cost assumptions

The following are prerequisites, not proof that accounts are currently provisioned or paid:

| Provider                           | Build Week prerequisite                                                                                                                                 | Revenue Activation prerequisite                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel                             | Account and project capable of `syd1`, public demo hosting and protected environment variables.                                                         | Commercially permitted paid plan with custom domains, production observability and sufficient function/concurrency allowance.                                                                |
| Supabase                           | Australian-region project supporting Postgres, Auth, private Storage, RLS and managed pooling.                                                          | Paid production project in `ap-southeast-2` with backup/restore, retention, connection and support capabilities accepted against the launch runbook.                                         |
| Fly.io                             | Billing-enabled organisation able to run a Sydney Machine and private secrets.                                                                          | Sized redundant/replaceable worker deployment, volume-free disposable runtime, alerts and an accepted operating budget.                                                                      |
| Expo EAS                           | Account able to create an iOS development/adhoc build and development/preview channels. Apple signing access is required for the physical iPhone build. | Production channel/profile, signing custody, Android credentials and enough build/update entitlement for supported-device releases. App Store distribution is not a Build Week prerequisite. |
| OpenAI, Stripe, calendar and email | Deterministic fakes or explicitly authorised test modes.                                                                                                | Separately authorised production accounts, accepted privacy/retention posture, least-scoped credentials, reconciliation and spend controls.                                                  |
| DNS                                | No custom-host mutation is required if the verified public demo uses the Vercel URL.                                                                    | Authority over the current DNS provider and verified control of every canonical domain and retained alias.                                                                                   |

No numeric infrastructure budget or paid-plan purchase is assumed or authorised by this decision. Build Week may use existing entitlements, free allowances or test modes only where their terms and capabilities satisfy the gate. Provider pricing is deliberately not frozen into the architecture record because it is time-sensitive. Before any paid plan is purchased or upgraded, the release record must capture the then-current official quote, expected base and usage charges, transaction/model/email exclusions, taxes, cancellation path, an explicit monthly ceiling and owner approval. A missing accepted ceiling blocks paid activation rather than being filled with a post-hoc estimate.

## Secrets and privileged access

- Vercel, Fly.io, Supabase and Expo credentials are separate by environment and stored only in the owning platform's managed secret store. Local development uses ignored environment files derived from `.env.example`.
- Web, worker, migration, mobile-build and provider credentials are separate and least-scoped. A credential may not be copied between preview and production.
- Service secrets are configuration, never application data or event payloads. Logs and validation manifests record only secret identifiers/versions, never values.
- Build Week may use synthetic identities and fake/test provider credentials. Production secrets, dual-key rotation, audited access, emergency revocation and provider reconciliation are Revenue Activation gates.
- Privileged production accounts require Supabase TOTP MFA at `aal2`. Approval, credential/integration changes, recipient-grant changes, exports and access suspension require recent-auth step-up plus a server-side session-row check.

## Pinned worker runtime

The worker Dockerfile pins the Fly `amd64` base to `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6`; that image fixes the Playwright browser revision used for later PDF work. The deployment manifest must record both the resolved container image digest and observed Chromium version. Floating `latest` tags or an unpinned browser download fail the topology gate. PDF parity tests run against the same pinned browser major version used by Fly.io. The container is stateless; artifacts live in private Storage and durable facts in Postgres.

## Expo channel contract

| EAS profile   | Update channel | Distribution                                         | Gate                                                                             |
| ------------- | -------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `development` | `development`  | Internal development client                          | Required for the physical Build Week iPhone native-storage oracle.               |
| `preview`     | `preview`      | Internal/adhoc                                       | Build Week demo and reviewer distribution; synthetic/de-identified data only.    |
| `production`  | `production`   | Store/internal production distribution as authorised | Revenue Activation only, after supported iOS/Android runtime and signing checks. |

Runtime compatibility is derived from the app version. An EAS Update must target exactly one compatible runtime and channel; production updates require the full release gate and rollback metadata.

## Milestone gates

### Build Week

Build Week is allowed to use synthetic/de-identified data, deterministic fakes or authorised test modes, a Vercel public demo URL, a physical iPhone development/adhoc build and non-production accounts. It still requires:

1. The deployed demo actually resolves and contains the expected product content.
2. Vercel functions declare `syd1`; Supabase is created in `ap-southeast-2`; the Fly worker configuration declares `syd` and a pinned Chromium runtime.
3. The physical iPhone benchmark facts are recorded before measured samples, and the KTD3 durable-sync/atomic-rename/surfaced-failure oracle passes. If it does not, U4 remains blocked on a named native-module task.
4. EAS development and preview profiles/channels are compatible with the native build.
5. The milestone manifest identifies every live-provider, custom-domain, production-security, Android-floor and production-restore claim as unproven unless it has separate observed evidence.

### Revenue Activation

Revenue Activation cannot inherit unobserved Build Week assumptions as proof. It additionally requires:

1. Provisioned, accepted production accounts/plans and an owner-approved then-current cost record.
2. Canonical domains and retained aliases configured and verified from the real public internet.
3. Production secrets, MFA/step-up, session bounds, rotation, provider reconciliation and content-quarantine controls proven.
4. Live-provider smoke and unknown-outcome reconciliation under separately authorised credentials.
5. The identical KTD3 durability oracle and benchmark profile run on the declared iPhone 12 and Pixel 6 support floors, or documented slower supported devices selected before results.
6. Measured backup/restore, lifecycle and capacity evidence, plus release-manifest references to (never overwrites of) the Build Week evidence.

## Rejection conditions

Deployment validation must fail if a region, browser version/image digest, channel/runtime mapping, database connection mode, required account capability, canonical host, secret owner, cost approval or milestone proof is missing or contradicts this record. A configuration file naming the correct provider without its selected region/runtime is insufficient.
