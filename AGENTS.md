# Agent instructions

Guidance for AI coding agents working in the InspectionHub repository.

## Cursor Cloud specific instructions

### Stack

| Layer       | Technology                                        |
| ----------- | ------------------------------------------------- |
| Monorepo    | pnpm 10.29.3 workspaces + Turborepo               |
| Runtime     | Node.js 22+ (CI and cloud use Node 24)            |
| Web         | Next.js 16 (`apps/web`)                           |
| Mobile      | Expo 57 dev client (`apps/mobile`)                |
| Worker      | Node async task runner (`apps/worker`)            |
| Shared code | TypeScript packages under `packages/*`            |
| Database    | PostgreSQL 17, Supabase migrations in `supabase/` |
| Unit tests  | Vitest                                            |
| Web e2e     | Playwright (`e2e/web/`)                           |
| Mobile e2e  | Maestro YAML harness (`apps/mobile/e2e/`)         |

Environment files live in `.cursor/`:

- `environment.json` — Cloud Agent container build and startup config (`container.build`)
- `Dockerfile` — system packages (Node, PostgreSQL 17, git, sudo); does **not** copy the repo
- `install.sh` — idempotent dependency install run during Builds

### Secrets and adapters

Keep `PROVIDER_MODE=fake` for routine development and verification. The install
script seeds `.env.local` from `.env.example` when missing. Never commit API keys,
service-role tokens, or other secrets. Add live credentials only through Cursor
Secrets when a task explicitly requires them.

### Dev servers

```bash
pnpm dev
```

Turbo starts web, worker, and mobile targets in parallel. Next.js listens on port
**3000** by default.

### Verification commands

These mirror the CI quality job in `.github/workflows/ci.yml`:

```bash
pnpm design:lint
pnpm foundation:validate
pnpm native:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:submission-readiness
pnpm test:e2e:mobile
pnpm test:integration
pnpm test:soak
pnpm test:eval
pnpm test:security
pnpm test:e2e:web
pnpm build
```

`pnpm test:integration` uses ephemeral local PostgreSQL via `initdb`/`pg_ctl`
when `TEST_DATABASE_URL` is unset. The cloud Dockerfile installs PostgreSQL 17
for that path.

Playwright web e2e builds and serves Next.js on **3010** with fake adapters;
Chromium is installed during the cloud Build.

### Local judge demo

```bash
pnpm demo:judge
```

One-command synthetic walkthrough for Build Week review. Loopback-only; do not
wire live providers without explicit launch authority.
