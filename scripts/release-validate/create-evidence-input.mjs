import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  canonicalJson,
  defaultEvidenceInput,
  repositoryRoot,
  sha256,
} from "./validation.mjs";

const execFileAsync = promisify(execFile);

function parseArguments(argv) {
  let buildWeekManifest = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--build-week-manifest" || !argv[index + 1])
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    buildWeekManifest = argv[index + 1];
    index += 1;
  }
  return { buildWeekManifest };
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

async function buildWeekReference(pathInput) {
  if (!pathInput) return null;
  const path = resolve(pathInput);
  const pathFromRoot = relative(repositoryRoot, path).replaceAll("\\", "/");
  if (
    pathFromRoot.startsWith("..") ||
    !pathFromRoot.startsWith("artifacts/validation/")
  )
    throw new Error("Build Week manifest must be under artifacts/validation/");
  const bytes = await readFile(path);
  const info = await stat(path);
  const manifest = JSON.parse(bytes.toString("utf8"));
  const {
    integrity: _integrity,
    completionEvent: _completionEvent,
    ...payload
  } = manifest;
  return {
    artifact: {
      path: pathFromRoot,
      sha256: sha256(bytes),
      bytes: info.size,
      mediaType: "application/json",
    },
    manifestPayloadSha256: sha256(canonicalJson(payload)),
  };
}

const args = parseArguments(process.argv.slice(2));
const now = new Date().toISOString();
const input = defaultEvidenceInput({ now, commitSha: await gitCommitSha() });
input.buildWeekManifest = await buildWeekReference(args.buildWeekManifest);
process.stdout.write(`${JSON.stringify(input, null, 2)}\n`);
