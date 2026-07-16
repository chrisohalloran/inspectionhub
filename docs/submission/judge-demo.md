# Local judge demo

From a clean checkout with Node.js 22+ and pnpm 10.29.3 installed, run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm demo:judge
```

The command builds the same optimized Next.js application used by the
production-build Playwright harness, starts its durable rate-limit fixture, and
prints the local URL plus synthetic recipient credentials. Open the printed URL
in a browser. To exercise named-recipient access, open the printed invitation
URL, use a fresh `demo-invite-<any-unique-value>` code, the displayed synthetic
email, and the displayed one-time code.

The command is intentionally local and synthetic. It binds both services to
`127.0.0.1`, forces `APP_ENV=test`, fake providers and the filesystem recipient
adapter, blanks live-provider credentials, and creates a unique temporary state
directory per run. Press Enter for a clean exit; Ctrl-C and SIGTERM also stop
child processes and remove that state. It is not evidence of a public or
production deployment and does not perform live AI, payment, email or delivery
operations.

Set `JUDGE_DEMO_PORT` to an unused local port from 1024 to 65535 if a stable web
port is needed; otherwise the command selects an available loopback port.
