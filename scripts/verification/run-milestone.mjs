import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const milestone = process.argv[2];

if (!new Set(["build-week", "revenue-activation"]).has(milestone)) {
  process.stderr.write(`Unknown milestone: ${milestone ?? "<missing>"}\n`);
  process.exit(2);
}

if (milestone === "build-week") {
  const result = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, "../milestone-build-week/run.mjs"),
      ...process.argv.slice(3),
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 2);
}

const result = spawnSync(
  process.execPath,
  [
    resolve(import.meta.dirname, "../release-validate/run.mjs"),
    ...process.argv.slice(3),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 2);
