import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { seedDocument } from "../demo-seed/generate.mjs";
import { defaultEvidenceInput, loadContracts } from "./validation.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");

async function commitSha() {
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

const now = new Date().toISOString();
const input = defaultEvidenceInput({
  now,
  commitSha: await commitSha(),
  seedSha256: seedDocument().integrity.canonicalPayloadSha256,
});
const { deferred } = await loadContracts();
input.deferredBoundaries = deferred.boundaries.map((boundary) => ({
  ...boundary,
  status: "unproven",
  evidenceIds: [],
}));

process.stdout.write(`${JSON.stringify(input, null, 2)}\n`);
