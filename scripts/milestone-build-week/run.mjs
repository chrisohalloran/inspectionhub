import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { seedDocument } from "../demo-seed/generate.mjs";
import {
  defaultEvidenceInput,
  loadContracts,
  validateAndBuildManifest,
} from "./validation.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");

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

async function gitRuntimeSource() {
  try {
    const [{ stdout: commit }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }),
      execFileAsync(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=normal"],
        { cwd: repositoryRoot, encoding: "utf8" },
      ),
    ]);
    return { commitSha: commit.trim(), worktreeClean: status.trim() === "" };
  } catch {
    return { commitSha: "uncommitted", worktreeClean: false };
  }
}

function defaultOutputPath(now) {
  const runId = `build-week-${now.replaceAll(":", "-").replaceAll(".", "-")}`;
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
  const seed = seedDocument();
  const now = new Date().toISOString();
  const contracts = await loadContracts();
  const runtimeSource = await gitRuntimeSource();
  const input = args.evidence
    ? JSON.parse(await readFile(resolve(args.evidence), "utf8"))
    : defaultEvidenceInput({
        now,
        commitSha: runtimeSource.commitSha,
        seedSha256: seed.integrity.canonicalPayloadSha256,
      });
  const { manifest, valid, complete } = await validateAndBuildManifest(
    input,
    contracts,
    {
      expectedSeedSha256: seed.integrity.canonicalPayloadSha256,
      generatedAt: now,
      runtimeCommitSha: runtimeSource.commitSha,
      runtimeWorktreeClean: runtimeSource.worktreeClean,
      verifyArtifacts: args.verifyArtifacts,
    },
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
        score: `${manifest.rubric.percent}%`,
        output,
        blockers: manifest.blockers,
        validationErrors: manifest.validationErrors,
      },
      null,
      2,
    )}\n`,
  );
  if (!valid) process.exitCode = 2;
  else if (!complete) process.exitCode = 4;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Build Week milestone validation failed closed: ${error.message}\n`,
  );
  process.exitCode = 2;
}
