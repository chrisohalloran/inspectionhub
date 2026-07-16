import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  defaultEvidenceInput,
  loadContracts,
  repositoryRoot,
  validateAndBuildManifest,
} from "./validation.mjs";

const execFileAsync = promisify(execFile);

function parseArguments(argv) {
  const parsed = { evidence: null, output: null, verifyArtifacts: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--evidence" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      parsed[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    if (argument === "--no-artifact-verification") {
      parsed.verifyArtifacts = false;
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
  const runId = `revenue-activation-${now.replaceAll(":", "-").replaceAll(".", "-")}`;
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
    : defaultEvidenceInput({ now, commitSha: await gitCommitSha() });
  const result = await validateAndBuildManifest(input, await loadContracts(), {
    generatedAt: now,
    verifyArtifacts: args.verifyArtifacts,
  });
  const output = args.output ? resolve(args.output) : defaultOutputPath(now);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result.manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outcome: result.manifest.outcome,
        score: `${result.manifest.rubric.percent}%`,
        commercialOutcome: result.manifest.commercialOutcome.status,
        output,
        blockers: result.manifest.blockers,
        validationErrors: result.manifest.validationErrors,
      },
      null,
      2,
    )}\n`,
  );
  if (!result.valid) process.exitCode = 2;
  else if (!result.complete) process.exitCode = 4;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Revenue Activation validation failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}
