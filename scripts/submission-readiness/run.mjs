import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  defaultSubmissionInput,
  validateAndBuildSubmissionManifest,
} from "./validation.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");

function parseArguments(argv) {
  const parsed = { evidence: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--evidence" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      parsed[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

async function gitCommitSha() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    return stdout.trim();
  } catch {
    return "uncommitted";
  }
}

function defaultOutputPath(now) {
  const runId = `devpost-submission-${now
    .replaceAll(":", "-")
    .replaceAll(".", "-")}`;
  return resolve(
    repositoryRoot,
    "artifacts",
    "validation",
    runId,
    "manifest.json",
  );
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const now = new Date().toISOString();
  const input = args.evidence
    ? JSON.parse(await readFile(resolve(args.evidence), "utf8"))
    : defaultSubmissionInput({
        now,
        commitSha: await gitCommitSha(),
      });
  const { manifest, valid, ready } = await validateAndBuildSubmissionManifest(
    input,
    { generatedAt: now },
  );
  const output = args.output ? resolve(args.output) : defaultOutputPath(now);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outcome: manifest.outcome,
        output,
        blockers: manifest.blockers,
        validationErrors: manifest.validationErrors,
      },
      null,
      2,
    )}\n`,
  );
  if (!valid) process.exitCode = 2;
  else if (!ready) process.exitCode = 4;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Devpost submission preflight failed closed: ${error.message}\n`,
  );
  process.exitCode = 2;
}
