import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);

run("pnpm", ["--filter", "@inspection/agent", "build"]);
run("pnpm", [
  "exec",
  "vitest",
  "run",
  "--config",
  "evals/inspection-drafting/vitest.config.ts",
]);

if (process.env.REQUIRE_LIVE_MODEL_EVAL === "1") {
  if (!process.env.OPENAI_API_KEY) {
    process.stderr.write(
      "Live model evaluation is required but OPENAI_API_KEY is absent. The OpenAI Platform connector must be reauthenticated before an observed architecture verdict can be recorded.\n",
    );
    process.exit(5);
  }
  run("node", ["evals/inspection-drafting/run-live-comparison.mjs"]);
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
