import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import { seedDocument } from "../demo-seed/generate.mjs";
import { defaultEvidenceInput, loadContracts } from "./validation.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const observedSources = Object.freeze({
  repository:
    "docs/validation/build-week/public-repository-check-2026-07-16.md",
  review: "docs/validation/build-week/adversarial-review-2026-07-16.md",
});

function parseArguments(argv) {
  const parsed = { observedLocal: false, artifactDirectory: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--observed-local") {
      parsed.observedLocal = true;
      continue;
    }
    if (argument === "--artifact-directory") {
      const value = argv[index + 1];
      if (!value) throw new Error("--artifact-directory requires a path");
      parsed.artifactDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (parsed.artifactDirectory && !parsed.observedLocal) {
    throw new Error("--artifact-directory requires --observed-local");
  }
  return parsed;
}

function safeArtifactDirectory(value, now) {
  const path =
    value ??
    `artifacts/validation/build-week-observed-${now
      .replaceAll(":", "-")
      .replaceAll(".", "-")}`;
  if (
    isAbsolute(path) ||
    !path.startsWith("artifacts/validation/") ||
    path.split("/").includes("..")
  ) {
    throw new Error("Observed artifacts must stay under artifacts/validation/");
  }
  return path.replace(/\/$/u, "");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function snapshot(source, artifactDirectory, name) {
  const bytes = await readFile(resolve(repositoryRoot, source));
  const artifactPath = `${artifactDirectory}/observations/${name}`;
  const destination = resolve(repositoryRoot, artifactPath);
  await mkdir(resolve(repositoryRoot, artifactDirectory, "observations"), {
    recursive: true,
  });
  await writeFile(destination, bytes, { flag: "wx" });
  return { path: artifactPath, sha256: sha256(bytes) };
}

function extractRequired(pattern, value, label) {
  const match = value.match(pattern)?.[1];
  if (!match) throw new Error(`Observed ${label} is missing`);
  return match;
}

function requireSourceClaim(pattern, value, label) {
  if (!pattern.test(value)) throw new Error(`Observed ${label} is missing`);
}

async function addObservedLocalEvidence(input, { now, artifactDirectory }) {
  const [repositoryText, reviewText] = await Promise.all([
    readFile(resolve(repositoryRoot, observedSources.repository), "utf8"),
    readFile(resolve(repositoryRoot, observedSources.review), "utf8"),
  ]);
  const repositoryUrl = extractRequired(
    /(https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+)/u,
    repositoryText,
    "repository URL",
  );
  const repositoryStatus = Number(
    extractRequired(/HTTP\s+(\d{3})/u, repositoryText, "repository status"),
  );
  const reviewedCommitSha = extractRequired(
    /Reviewed commit:\s+`([a-f0-9]{40})`/u,
    reviewText,
    "reviewed commit SHA",
  );
  requireSourceClaim(
    /reachable without GitHub authentication/u,
    repositoryText,
    "logged-out repository claim",
  );
  requireSourceClaim(
    /No unresolved P0 or P1 finding remained/u,
    reviewText,
    "zero unresolved P0/P1 review claim",
  );
  requireSourceClaim(
    /implementation, security and document review/u,
    reviewText,
    "review scopes",
  );
  const publicRepositoryArtifact = await snapshot(
    observedSources.repository,
    artifactDirectory,
    "public-repository-check.md",
  );
  const adversarialReviewArtifact = await snapshot(
    observedSources.review,
    artifactDirectory,
    "adversarial-review.md",
  );
  const provenance = {
    mode: "observed",
    observer: "Codex root implementation session",
    observedAt: now,
  };

  input.evidence.push(
    {
      id: "logged-out-public-repository",
      kind: "link_check",
      claim:
        "The public source repository was reachable logged out at the recorded commit; no product demo claim is made.",
      provenance,
      artifact: publicRepositoryArtifact,
      details: {
        asset: "repository",
        url: repositoryUrl,
        finalUrl: repositoryUrl,
        loggedOut: true,
        status: repositoryStatus,
        expectedContentPresent: true,
      },
    },
    {
      id: "parallel-model-assisted-review",
      kind: "review",
      claim:
        "Separate Codex reviewers completed implementation, security and document review with no unresolved P0 or P1; this is not an external human audit.",
      provenance,
      artifact: adversarialReviewArtifact,
      details: {
        unresolvedP0: 0,
        unresolvedP1: 0,
        scopes: ["implementation", "security", "document"],
        reviewType: "parallel_model_assisted",
        externalHuman: false,
        reviewedCommitSha,
        verificationReadback: "bounded_summary_only",
        rawCommandArtifacts: false,
      },
    },
  );
  input.publicUrlsChecked.push({ url: repositoryUrl });
}

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

try {
  const args = parseArguments(process.argv.slice(2));
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
  if (args.observedLocal) {
    await addObservedLocalEvidence(input, {
      now,
      artifactDirectory: safeArtifactDirectory(args.artifactDirectory, now),
    });
  }
  process.stdout.write(`${JSON.stringify(input, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `Build Week evidence input creation failed: ${error.message}\n`,
  );
  process.exitCode = 2;
}
