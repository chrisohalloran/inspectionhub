import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("live comparison harness contract", () => {
  it("builds the agent and every transitive workspace dependency", async () => {
    const runner = await readFile(
      new URL(
        "../../scripts/verification/run-agent-evals.mjs",
        import.meta.url,
      ),
      "utf8",
    );

    expect(runner).toContain(
      'run("pnpm", ["--filter", "@inspection/agent...", "build"]);',
    );
  });

  it("rejects a mutable trial count before preparing or calling a model", () => {
    const result = runComparison(["--preflight"], {
      LIVE_EVAL_TRIALS: "4",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires exactly 3 predeclared trials");
  });

  it("keeps the no-key preflight development-only and release-ineligible", () => {
    const result = runComparison(["--preflight"], {
      LIVE_EVAL_TRIALS: "3",
      OPENAI_API_KEY: "",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "passed",
      evidenceKind: "architecture_development_preflight",
      lockedHoldoutEvaluated: false,
      releaseEligible: false,
    });
  });
});

function runComparison(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>,
) {
  return spawnSync(
    process.execPath,
    ["evals/inspection-drafting/run-live-comparison.mjs", ...arguments_],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );
}
