import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { verifyRecipientAuthorityContract } from "./verify-recipient-authority.mjs";

const VERCEL_ENVIRONMENTS = new Set(["development", "preview", "production"]);

export async function runProtectedVercelBuild(input = {}) {
  const environment = input.environment ?? process.env;
  const vercelEnvironment = deploymentEnvironment(environment);
  if (vercelEnvironment === "production") {
    await (input.preflight ?? (() => productionPreflight(environment)))();
  }
  (input.build ?? runWebBuild)();
}

function deploymentEnvironment(environment) {
  const value = environment.VERCEL_ENV?.trim();
  if (value === undefined || !VERCEL_ENVIRONMENTS.has(value)) {
    throw new Error(
      "VERCEL_ENV must identify development, preview, or production before the Vercel build can run",
    );
  }
  return value;
}

function productionPreflight(environment) {
  return verifyRecipientAuthorityContract({
    supabaseUrl:
      environment.SUPABASE_API_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
}

function runWebBuild() {
  const result = spawnSync("pnpm", ["--filter", "@inspection/web", "build"], {
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Recipient web build failed with status ${String(result.status)}`,
    );
  }
}

async function main() {
  await runProtectedVercelBuild();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Protected Vercel build failed"}\n`,
    );
    process.exitCode = 1;
  });
}
