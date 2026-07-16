import { spawnSync } from "node:child_process";

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    process.stderr.write(
      `${command} could not start: ${result.error.message}\n`,
    );
    process.exit(2);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/security-check/static-security-check.mjs"]);
run("node", ["scripts/security-check/dependency-audit.mjs"]);
run("pnpm", [
  "exec",
  "vitest",
  "run",
  "--config",
  "vitest.config.ts",
  "packages/security/src/security.test.ts",
  "packages/observability/src/observability.test.ts",
  "packages/delivery/src/delivery-service.test.ts",
  "packages/providers/src/provider-adapters.test.ts",
  "apps/web/app/api/webhooks/access/route.test.ts",
  "apps/web/app/api/webhooks/booking/route.test.ts",
  "apps/web/app/api/webhooks/rate-limit.test.ts",
]);
run("node", ["scripts/integration/run-postgres.mjs"]);

process.stdout.write("Security and operations gate passed.\n");
