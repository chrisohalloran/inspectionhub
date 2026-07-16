import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "../demo-seed/generate.mjs";
import { availableLoopbackPort, SYNTHETIC_OTP } from "../judge-demo/config.mjs";
import {
  assembleObservedSubmissionInput,
  createObservedSubmissionEvidence,
  observedExpectedBlockers,
} from "./observed-input.mjs";
import {
  deriveSubmissionDescriptionObservation,
  evidenceBindingSha256,
  SUBMISSION_PERIOD_END,
  SUBMISSION_PERIOD_START,
  validateAndBuildSubmissionManifest,
} from "./validation.mjs";

const defaultRepositoryRoot = resolve(import.meta.dirname, "../..");
const repositorySlug = "chrisohalloran/inspectionhub";
const repositoryUrl = `https://github.com/${repositorySlug}`;
const githubApi = `https://api.github.com/repos/${repositorySlug}`;
const expectedBlockers = new Set(observedExpectedBlockers);
const maxHttpBodyBytes = 2 * 1024 * 1024;
const defaultCommandTimeoutMs = 10 * 60_000;
const ownershipMarkerName = ".inspectionhub-observer-owner";

export function parseArguments(argv) {
  const parsed = { artifactDirectory: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--artifact-directory") {
      const value = argv[index + 1];
      if (!value) throw new Error("--artifact-directory requires a path");
      parsed.artifactDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

export function runtimeObserverLabel({
  nodeVersion = process.version,
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  return `automated-submission-observer/${nodeVersion}/${platform}-${architecture}`;
}

export function safeArtifactDirectory(value, now) {
  const path =
    value ??
    `artifacts/validation/devpost-observed-${now
      .replaceAll(":", "-")
      .replaceAll(".", "-")}`;
  if (
    isAbsolute(path) ||
    !/^artifacts\/validation\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(path)
  ) {
    throw new Error(
      "Observed artifacts must use a direct, safe child of artifacts/validation/",
    );
  }
  return path;
}

export async function collectObservedSubmissionEvidence(options = {}) {
  const repositoryRoot = resolve(
    options.repositoryRoot ?? defaultRepositoryRoot,
  );
  const dependencies = createDependencies(repositoryRoot, options.dependencies);
  const startedAt = dependencies.now();
  const artifactDirectory = safeArtifactDirectory(
    options.artifactDirectory,
    startedAt,
  );
  let ownedOutput = null;
  try {
    const commitSha = await dependencies.requireCleanPublicCommit();
    const [repository, ci, submissionFields, provenance, isolatedRun] =
      await Promise.all([
        dependencies.observePublicRepository(commitSha),
        dependencies.observePublicCi(commitSha),
        dependencies.observeSubmissionFields(commitSha),
        dependencies.observeProvenance(commitSha),
        dependencies.observeExactCommit(commitSha),
      ]);
    const endedAt = dependencies.now();
    const observationInput = {
      observer: dependencies.observerLabel(),
      startedAt,
      endedAt,
      commitSha,
      ci,
      repository,
      judgeDemo: isolatedRun.judgeDemo,
      provenance,
    };
    const observations = {
      "working-project": {
        commitSha,
        ci,
        cleanBuild: isolatedRun.cleanBuild,
        judgeDemo: isolatedRun.judgeDemo,
        runtime: isolatedRun.runtime,
      },
      track: {
        sourcePath: submissionFields.path,
        sourceSha256: submissionFields.sha256,
        track: submissionFields.track,
      },
      description: {
        sourcePath: submissionFields.path,
        sourceText: submissionFields.sourceText,
        sourceSha256: submissionFields.sha256,
        sections: submissionFields.sections,
        sectionLengths: submissionFields.sectionLengths,
        englishDescriptionPresent: submissionFields.englishDescriptionPresent,
        featuresAndFunctionalityPresent:
          submissionFields.featuresAndFunctionalityPresent,
      },
      "public-repository": repository,
      "submission-period-provenance": provenance,
    };

    // Recheck immediately before any evidence is materialized. Observations for
    // a superseded or locally modified commit must never reach disk.
    await dependencies.recheckExactCommit(commitSha);
    ownedOutput = await dependencies.prepareOutputDirectory(artifactDirectory);
    const ownedObservations = await dependencies.createOwnedDirectory(
      `${artifactDirectory}/observations`,
      ownedOutput,
    );
    const evidence = [];
    for (const draft of createObservedSubmissionEvidence(observationInput)) {
      const path = `${artifactDirectory}/observations/${draft.id}.json`;
      const artifact = await dependencies.writeEvidenceArtifact(
        draft,
        commitSha,
        observations[draft.id],
        path,
        ownedOutput,
        ownedObservations,
      );
      evidence.push({ ...draft, artifact });
    }
    const evidenceInput = assembleObservedSubmissionInput(
      observationInput,
      evidence,
    );
    const evidencePath = `${artifactDirectory}/submission-evidence.json`;
    await dependencies.writeExclusive(evidencePath, evidenceInput, ownedOutput);
    const provenanceEvidence = evidence.find(
      (item) => item.id === "submission-period-provenance",
    );
    if (!provenanceEvidence) {
      throw new Error("Observed provenance evidence was not materialized");
    }
    const result = await dependencies.validateSubmission(evidenceInput, {
      generatedAt: endedAt,
      verifiedExternalObservations: {
        provenance: {
          evidenceId: provenanceEvidence.id,
          evidenceKind: provenanceEvidence.kind,
          commitSha,
          observedAt: provenanceEvidence.provenance.observedAt,
          artifactSha256: provenanceEvidence.artifact.sha256,
          observation: provenance,
        },
      },
    });
    if (!result.valid || result.ready) {
      throw new Error(
        `Observed preflight must be valid and blocked, received valid=${result.valid} ready=${result.ready}`,
      );
    }
    const blockers = new Set(result.manifest.blockers);
    if (
      blockers.size !== expectedBlockers.size ||
      [...expectedBlockers].some((blocker) => !blockers.has(blocker))
    ) {
      throw new Error(
        `Observed preflight produced an unexpected blocker set: ${result.manifest.blockers.join(", ")}`,
      );
    }
    const manifestPath = `${artifactDirectory}/submission-manifest.json`;
    await dependencies.writeExclusive(
      manifestPath,
      result.manifest,
      ownedOutput,
    );
    return {
      outcome: result.manifest.outcome,
      commitSha,
      evidencePath: resolve(repositoryRoot, evidencePath),
      manifestPath: resolve(repositoryRoot, manifestPath),
      passed: result.manifest.requirements
        .filter((item) => item.status === "pass")
        .map((item) => item.id),
      blockers: result.manifest.blockers,
    };
  } catch (error) {
    if (ownedOutput) {
      try {
        await dependencies.cleanupOutputDirectory(ownedOutput);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Observed evidence collection failed: ${errorMessage(error)}; cleanup also failed: ${errorMessage(cleanupError)}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}

function createDependencies(repositoryRoot, overrides = {}) {
  const defaults = {
    now: () => new Date().toISOString(),
    observerLabel: () => runtimeObserverLabel(),
    requireCleanPublicCommit: () => requireCleanPublicCommit(repositoryRoot),
    recheckExactCommit: (commitSha) =>
      requireCleanPublicCommit(repositoryRoot, commitSha),
    observePublicRepository: (commitSha) =>
      observePublicRepository(commitSha, { repositoryRoot }),
    observePublicCi,
    observeSubmissionFields: () => observeSubmissionFields(repositoryRoot),
    observeProvenance: (commitSha) =>
      observeProvenance(commitSha, { repositoryRoot }),
    observeExactCommit: (commitSha) =>
      observeExactCommit(commitSha, { repositoryRoot }),
    prepareOutputDirectory: (path) =>
      prepareFreshOutputDirectory(repositoryRoot, path),
    createOwnedDirectory,
    writeEvidenceArtifact,
    writeExclusive,
    validateSubmission: validateAndBuildSubmissionManifest,
    cleanupOutputDirectory,
  };
  return { ...defaults, ...overrides };
}

export async function requireCleanPublicCommit(
  repositoryRoot,
  expectedCommitSha,
) {
  const status = await git(["status", "--porcelain"], repositoryRoot);
  if (status) throw new Error("Observed evidence requires a clean worktree");
  const [head, remoteMain] = await Promise.all([
    git(["rev-parse", "HEAD"], repositoryRoot),
    git(["rev-parse", "origin/main"], repositoryRoot),
  ]);
  if (
    head !== remoteMain ||
    (expectedCommitSha && head !== expectedCommitSha)
  ) {
    throw new Error(
      "Observed evidence requires the exact HEAD to match origin/main",
    );
  }
  return head;
}

export async function observePublicRepository(
  commitSha,
  {
    repositoryRoot = defaultRepositoryRoot,
    fetchTextImpl = fetchText,
    fetchJsonImpl = fetchJson,
  } = {},
) {
  const rawRoot = `https://raw.githubusercontent.com/${repositorySlug}/${commitSha}`;
  const [page, readme, license, codexStory, judgeGuide, mainCommit] =
    await Promise.all([
      fetchTextImpl(repositoryUrl),
      fetchTextImpl(`${rawRoot}/README.md`),
      fetchTextImpl(`${rawRoot}/LICENSE`),
      fetchTextImpl(`${rawRoot}/docs/submission/codex-and-gpt.md`),
      fetchTextImpl(`${rawRoot}/docs/submission/judge-demo.md`),
      fetchJsonImpl(`${githubApi}/commits/main`),
    ]);
  requireStatus(page, 200, "public repository");
  for (const [label, response] of [
    ["README", readme],
    ["license", license],
    ["Codex/GPT story", codexStory],
    ["judge guide", judgeGuide],
  ]) {
    requireStatus(response, 200, label);
  }
  if (mainCommit.body?.sha !== commitSha) {
    throw new Error("Public main does not expose the exact observed commit");
  }
  const localReadme = await readFile(resolve(repositoryRoot, "README.md"));
  const localLicense = await readFile(resolve(repositoryRoot, "LICENSE"));
  if (sha256(localReadme) !== sha256(readme.bytes)) {
    throw new Error("Public README differs from the observed commit");
  }
  if (sha256(localLicense) !== sha256(license.bytes)) {
    throw new Error("Public license differs from the observed commit");
  }
  for (const [pattern, label] of [
    [/## Local setup/u, "README setup"],
    [/pnpm test:e2e:web/u, "README tests"],
    [/scripts\/demo-seed/u, "README sample data"],
    [/AGPL-3\.0-only/u, "README license"],
  ]) {
    if (!pattern.test(readme.text)) throw new Error(`${label} is missing`);
  }
  const collaboration = boundedMarkdownSection(
    readme.text,
    "## Codex collaboration and GPT-5.6",
    { minimumLength: 120, maximumLength: 8_000 },
  );
  if (
    !/\bCodex\b/u.test(collaboration) ||
    !/\bGPT-5\.6\b/u.test(collaboration)
  ) {
    throw new Error(
      "README Codex collaboration and GPT-5.6 section is not substantive",
    );
  }
  if (!/GNU AFFERO GENERAL PUBLIC LICENSE/u.test(license.text)) {
    throw new Error("Public AGPL license text is missing");
  }
  return {
    url: repositoryUrl,
    finalUrl: page.finalUrl,
    status: page.status,
    loggedOut: true,
    headSha: commitSha,
    readmeStatus: readme.status,
    licenseStatus: license.status,
    codexStoryStatus: codexStory.status,
    judgeGuideUrl: `${repositoryUrl}/blob/${commitSha}/docs/submission/judge-demo.md`,
    judgeGuideStatus: judgeGuide.status,
    readmeSha256: sha256(readme.bytes),
    licenseSha256: sha256(license.bytes),
    collaborationSectionLength: collaboration.length,
  };
}

export async function observePublicCi(
  commitSha,
  { fetchJsonImpl = fetchJson } = {},
) {
  const response = await fetchJsonImpl(
    `${githubApi}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${commitSha}&per_page=20`,
  );
  requireStatus(response, 200, "public CI API");
  const candidates = (response.body?.workflow_runs ?? []).filter(
    (candidate) =>
      candidate.head_sha === commitSha &&
      candidate.head_branch === "main" &&
      candidate.event === "push" &&
      candidate.path === ".github/workflows/ci.yml",
  );
  const run = candidates.sort(compareWorkflowRunsNewestFirst)[0];
  if (!run || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(
      "No successful completed CI/main/push latest attempt exists for HEAD",
    );
  }
  return {
    headSha: run.head_sha,
    headBranch: run.head_branch,
    event: run.event,
    workflowPath: run.path,
    conclusion: run.conclusion,
    status: run.status,
    runAttempt: run.run_attempt,
    url: run.html_url,
    runId: run.id,
  };
}

function compareWorkflowRunsNewestFirst(left, right) {
  const leftStartedAt = Date.parse(
    left.run_started_at ?? left.created_at ?? "",
  );
  const rightStartedAt = Date.parse(
    right.run_started_at ?? right.created_at ?? "",
  );
  if (Number.isFinite(leftStartedAt) && Number.isFinite(rightStartedAt)) {
    const timestampDifference = rightStartedAt - leftStartedAt;
    if (timestampDifference !== 0) return timestampDifference;
  }
  return Number(right.id ?? 0) - Number(left.id ?? 0);
}

export async function observeSubmissionFields(repositoryRoot) {
  const path = resolve(repositoryRoot, "docs/submission/devpost-copy.md");
  const bytes = await readFile(path);
  let sourceText;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Devpost copy must be valid UTF-8");
  }
  const track = boundedMarkdownSection(sourceText, "## Track", {
    minimumLength: 10,
    maximumLength: 100,
  });
  if (track !== "Work and Productivity") {
    throw new Error("Submission track is missing from Devpost copy");
  }
  const description = deriveSubmissionDescriptionObservation(sourceText);
  if (!description) {
    throw new Error("Devpost description copy is missing or outside bounds");
  }
  if (!description.englishDescriptionPresent) {
    throw new Error("Devpost description copy is not conservatively English");
  }
  if (!description.featuresAndFunctionalityPresent) {
    throw new Error(
      "Devpost description copy does not explain concrete product features and functionality",
    );
  }
  return {
    path: relative(repositoryRoot, path),
    sourceText,
    sha256: sha256(bytes),
    track,
    ...description,
  };
}

export function boundedMarkdownSection(
  text,
  heading,
  { minimumLength = 1, maximumLength = 10_000 } = {},
) {
  const lines = text.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => line.trimEnd() === heading);
  if (headingIndex < 0)
    throw new Error(`Required section is missing: ${heading}`);
  const bodyLines = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^##\s+/u.test(line)) break;
    bodyLines.push(line);
  }
  const body = bodyLines.join("\n").trim();
  if (body.length < minimumLength || body.length > maximumLength) {
    throw new Error(
      `${heading} must contain ${minimumLength}-${maximumLength} characters of bounded copy`,
    );
  }
  return body;
}

export async function observeProvenance(
  commitSha,
  {
    repositoryRoot = defaultRepositoryRoot,
    gitImpl = git,
    fetchJsonImpl = fetchJson,
  } = {},
) {
  const roots = (
    await gitImpl(["rev-list", "--max-parents=0", commitSha], repositoryRoot)
  )
    .split("\n")
    .filter(Boolean);
  if (roots.length !== 1) {
    throw new Error(
      `Expected exactly one root commit, observed ${roots.length}`,
    );
  }
  const rootCommitSha = roots[0];
  const rootCommitAt = await gitImpl(
    ["show", "--no-patch", "--format=%cI", rootCommitSha],
    repositoryRoot,
  );
  const [repository, publicRootCommit] = await Promise.all([
    fetchJsonImpl(githubApi),
    fetchJsonImpl(`${githubApi}/commits/${rootCommitSha}`),
  ]);
  requireStatus(repository, 200, "public repository metadata");
  requireStatus(publicRootCommit, 200, "public root commit");
  const repositoryCreatedAt = repository.body?.created_at;
  const publicRootCommitSha = publicRootCommit.body?.sha;
  const publicRootCommitAt =
    publicRootCommit.body?.commit?.committer?.date ??
    publicRootCommit.body?.commit?.author?.date;
  if (
    publicRootCommitSha !== rootCommitSha ||
    Date.parse(publicRootCommitAt ?? "") !== Date.parse(rootCommitAt)
  ) {
    throw new Error(
      "Public root commit identity does not match the exact local root commit",
    );
  }
  for (const [label, value] of [
    ["repository creation", repositoryCreatedAt],
    ["root commit", rootCommitAt],
  ]) {
    const timestamp = Date.parse(value ?? "");
    if (
      !Number.isFinite(timestamp) ||
      timestamp < Date.parse(SUBMISSION_PERIOD_START) ||
      timestamp > Date.parse(SUBMISSION_PERIOD_END)
    ) {
      throw new Error(`${label} is outside the official submission period`);
    }
  }
  return {
    rootCommitCount: roots.length,
    rootCommitSha,
    rootCommitAt,
    publicRootCommitSha,
    publicRootCommitAt,
    repositoryCreatedAt,
  };
}

export async function observeExactCommit(
  commitSha,
  {
    repositoryRoot = defaultRepositoryRoot,
    runCommandImpl = runCommand,
    observeJudgeDemoImpl = observeJudgeDemo,
    gitImpl = git,
  } = {},
) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "inspectionhub-observer-"),
  );
  const worktree = join(temporaryRoot, "worktree");
  const environment = boundedInheritedEnvironment();
  let worktreeAdded = false;
  let observation;
  let operationError;
  try {
    await gitImpl(
      ["worktree", "add", "--detach", worktree, commitSha],
      repositoryRoot,
    );
    worktreeAdded = true;
    const nodeVersion = await runCommandImpl(process.execPath, ["--version"], {
      cwd: worktree,
      env: environment,
      timeoutMs: 30_000,
    });
    const pnpmVersion = await runCommandImpl("pnpm", ["--version"], {
      cwd: worktree,
      env: environment,
      timeoutMs: 30_000,
    });
    const install = await runCommandImpl(
      "pnpm",
      ["install", "--frozen-lockfile"],
      {
        cwd: worktree,
        env: environment,
        timeoutMs: 10 * 60_000,
      },
    );
    const build = await runCommandImpl("pnpm", ["build"], {
      cwd: worktree,
      env: environment,
      timeoutMs: 15 * 60_000,
    });
    const judgeDemo = await observeJudgeDemoImpl({
      repositoryRoot: worktree,
      environment,
    });
    observation = {
      runtime: {
        node: nodeVersion.stdout.trim(),
        pnpm: pnpmVersion.stdout.trim(),
      },
      cleanBuild: { install, build },
      judgeDemo,
    };
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  if (worktreeAdded) {
    await cleanupExactCommitWorktree(worktree, repositoryRoot, gitImpl).catch(
      (error) => cleanupErrors.push(error),
    );
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }

  const cleanupError =
    cleanupErrors.length > 1
      ? new AggregateError(cleanupErrors, "Exact-commit cleanup failed")
      : cleanupErrors[0];
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      `Exact-commit observation failed: ${operationError.message}; cleanup also failed: ${cleanupError.message}`,
      { cause: operationError },
    );
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return observation;
}

async function cleanupExactCommitWorktree(worktree, repositoryRoot, gitImpl) {
  const removalErrors = [];
  for (const arguments_ of [
    ["worktree", "remove", "--force", worktree],
    ["worktree", "remove", "--force", "--force", worktree],
  ]) {
    try {
      await gitImpl(arguments_, repositoryRoot);
      return;
    } catch (error) {
      removalErrors.push(error);
    }
  }

  try {
    await rm(worktree, { recursive: true, force: true });
    await gitImpl(["worktree", "prune", "--expire", "now"], repositoryRoot);
  } catch (error) {
    throw new AggregateError(
      [...removalErrors, error],
      "Could not remove or prune the exact-commit worktree",
    );
  }
}

export function boundedInheritedEnvironment(source = process.env) {
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SHELL",
    "LANG",
    "LC_ALL",
    "XDG_CACHE_HOME",
    "PNPM_HOME",
    "COREPACK_HOME",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ];
  const environment = Object.fromEntries(
    allowed.filter((key) => source[key]).map((key) => [key, source[key]]),
  );
  return {
    ...environment,
    CI: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
}

export async function observeJudgeDemo({
  repositoryRoot,
  environment,
  fetchImpl = fetch,
}) {
  const port = await availableLoopbackPort();
  const child = spawn("pnpm", ["demo:judge"], {
    cwd: repositoryRoot,
    env: {
      ...environment,
      JUDGE_DEMO_PORT: String(port),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-100_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  try {
    await waitForOutput(child, () =>
      output.includes("LOCAL SYNTHETIC JUDGE DEMO"),
    );
    const base = `http://127.0.0.1:${port}`;
    const root = await fetchText(base, {}, { fetchImpl });
    requireStatus(root, 200, "judge demo root");
    if (!root.text.includes("InspectionHub")) {
      throw new Error("Judge demo root is missing InspectionHub content");
    }
    const invitation = await fetchHeadersOnly(
      `${base}/auth/invitation/redeem`,
      {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({
          invitationToken: `demo-invite-observed-${randomUUID()}`,
          email: "recipient@example.com",
        }),
      },
      { fetchImpl },
    );
    if (
      invitation.status !== 303 ||
      invitation.headers.get("location") !== "/auth/verify"
    ) {
      throw new Error(
        "Judge demo invitation did not produce the verified redirect",
      );
    }
    const pendingCookie = cookieHeader(invitation);
    const otp = await fetchHeadersOnly(
      `${base}/auth/verify/complete`,
      {
        method: "POST",
        redirect: "manual",
        headers: { cookie: pendingCookie },
        body: new URLSearchParams({ otp: SYNTHETIC_OTP }),
      },
      { fetchImpl },
    );
    if (otp.status !== 303 || otp.headers.get("location") !== "/reports/demo") {
      throw new Error("Judge demo OTP did not produce the report redirect");
    }
    const sessionCookie = cookieHeader(otp);
    const report = await fetchText(
      `${base}/reports/demo`,
      { headers: { cookie: sessionCookie } },
      { fetchImpl },
    );
    requireStatus(report, 200, "judge demo report");
    const expectedContentPresent =
      report.text.includes("InspectionHub") &&
      report.text.includes("Major defect") &&
      report.text.includes("Timber Pest");
    if (!expectedContentPresent) {
      throw new Error(
        "Judge demo report is missing expected synthetic content",
      );
    }
    const exitCode = await stopProcessTree(child, "SIGINT", 10_000);
    if (exitCode !== 0) throw new Error(`Judge demo exited with ${exitCode}`);
    return {
      statuses: {
        root: root.status,
        invitation: invitation.status,
        otp: otp.status,
        report: report.status,
      },
      expectedContentPresent,
      exitCode,
      outputTailSha256: sha256(Buffer.from(output)),
    };
  } catch (error) {
    await terminateProcessTree(child, 2_000).catch(() => undefined);
    throw error;
  }
}

async function waitForOutput(child, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Judge demo exited before readiness (${child.exitCode})`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Judge demo did not become ready before the timeout");
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode;
  }
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Process did not stop before the timeout")),
      timeoutMs,
    );
  });
  try {
    const [code] = await Promise.race([once(child, "exit"), timeout]);
    return code;
  } finally {
    clearTimeout(timeoutId);
  }
}

function signalProcessTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function stopProcessTree(child, signal, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode;
  }
  signalProcessTree(child, signal);
  return waitForExit(child, timeoutMs);
}

export async function terminateProcessTree(child, graceMs = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcessTree(child, "SIGTERM");
  try {
    await waitForExit(child, graceMs);
    return;
  } catch {
    signalProcessTree(child, "SIGKILL");
    await waitForExit(child, 2_000).catch(() => undefined);
  }
}

function cookieHeader(response) {
  const lines =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const cookies = lines
    .map((line) => line.split(";", 1)[0])
    .filter((line) => line && !line.endsWith("="));
  if (cookies.length === 0) {
    throw new Error("Expected recipient cookie is missing");
  }
  return cookies.join("; ");
}

export async function fetchText(
  url,
  options = {},
  { fetchImpl = fetch, maximumBytes = maxHttpBodyBytes } = {},
) {
  const response = await fetchImpl(url, requestOptions(options));
  const bytes = await readBoundedBody(response, maximumBytes);
  return {
    status: response.status,
    finalUrl: response.url,
    bytes,
    text: bytes.toString("utf8"),
  };
}

export async function fetchJson(
  url,
  { fetchImpl = fetch, maximumBytes = maxHttpBodyBytes } = {},
) {
  const response = await fetchImpl(
    url,
    requestOptions({ headers: { accept: "application/vnd.github+json" } }),
  );
  const bytes = await readBoundedBody(response, maximumBytes);
  let body;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
  return { status: response.status, finalUrl: response.url, body };
}

async function fetchHeadersOnly(url, options, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, requestOptions(options));
  await response.body?.cancel();
  return response;
}

function requestOptions(options) {
  return {
    ...options,
    headers: {
      "user-agent": "inspectionhub-submission-observer",
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  };
}

async function readBoundedBody(response, maximumBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel();
    throw new Error(`HTTP response exceeds ${maximumBytes} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(`HTTP response exceeds ${maximumBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, total);
}

function requireStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned HTTP ${response.status}, expected ${expected}`,
    );
  }
}

export async function prepareFreshOutputDirectory(repositoryRoot, path) {
  const root = await realpath(repositoryRoot);
  const validation = resolve(root, "artifacts/validation");
  await ensureDirectoryWithoutSymlinks(root, "artifacts");
  await ensureDirectoryWithoutSymlinks(root, "artifacts/validation");
  const validationReal = await realpath(validation);
  if (validationReal !== validation) {
    throw new Error("Validation artifact root must not resolve through a link");
  }
  const absolutePath = resolve(root, path);
  if (dirname(absolutePath) !== validationReal) {
    throw new Error("Observed output must be a direct validation child");
  }
  try {
    await mkdir(absolutePath);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("Observed output directory already exists");
    }
    throw error;
  }
  try {
    const outputReal = await realpath(absolutePath);
    if (outputReal !== absolutePath) {
      throw new Error(
        "Observed output directory ownership could not be verified",
      );
    }
    return await recordOwnedDirectory(absolutePath, path);
  } catch (error) {
    try {
      await rm(absolutePath, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Observed output ownership setup and cleanup both failed",
        { cause: error },
      );
    }
    throw error;
  }
}

async function ensureDirectoryWithoutSymlinks(root, path) {
  const target = resolve(root, path);
  const parentRelative = dirname(path);
  if (parentRelative !== "." && parentRelative !== path) {
    await ensureDirectoryWithoutSymlinks(root, parentRelative);
  }
  try {
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${path} must be a real directory`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(target);
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${path} must be a real directory`);
    }
  }
}

export async function createOwnedDirectory(path, ownedOutput) {
  await assertOwnedOutput(ownedOutput);
  const absolutePath = resolveOwnedArtifactPath(path, ownedOutput);
  await mkdir(absolutePath);
  return recordOwnedDirectory(absolutePath, path);
}

async function recordOwnedDirectory(absolutePath, relativePath) {
  const stat = await lstat(absolutePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Owned artifact subdirectory is unsafe");
  }
  const markerToken = randomUUID();
  const markerPath = join(absolutePath, ownershipMarkerName);
  await writeFile(markerPath, markerToken, { flag: "wx", mode: 0o600 });
  const markerStat = await lstat(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error("Owned artifact marker is unsafe");
  }
  return {
    absolutePath,
    relativePath,
    identity: { device: stat.dev, inode: stat.ino },
    marker: {
      path: markerPath,
      token: markerToken,
      identity: { device: markerStat.dev, inode: markerStat.ino },
    },
  };
}

async function writeEvidenceArtifact(
  evidence,
  commitSha,
  observation,
  path,
  ownedOutput,
  ownedObservations,
) {
  if (!observation || typeof observation !== "object") {
    throw new Error(`No bounded observation exists for ${evidence.id}`);
  }
  const envelope = {
    schemaVersion: 1,
    evidenceId: evidence.id,
    evidenceKind: evidence.kind,
    commitSha,
    observedAt: evidence.provenance.observedAt,
    bindingSha256: evidenceBindingSha256(evidence, commitSha),
    observation,
  };
  const bytes = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`);
  await assertOwnedOutput(ownedOutput);
  await assertOwnedOutput(ownedObservations);
  const absolutePath = resolveDirectOwnedArtifactPath(path, ownedObservations);
  await writeFile(absolutePath, bytes, { flag: "wx" });
  return { path, sha256: sha256(bytes) };
}

async function writeExclusive(path, value, ownedOutput) {
  await assertOwnedOutput(ownedOutput);
  const absolutePath = resolveOwnedArtifactPath(path, ownedOutput);
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
}

function resolveOwnedArtifactPath(path, ownedOutput) {
  const rel = relative(ownedOutput.relativePath, path);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("Artifact path escapes the exclusively owned output");
  }
  return resolve(ownedOutput.absolutePath, rel);
}

function resolveDirectOwnedArtifactPath(path, ownedDirectory) {
  const absolutePath = resolveOwnedArtifactPath(path, ownedDirectory);
  if (dirname(absolutePath) !== ownedDirectory.absolutePath) {
    throw new Error("Observation artifact must be a direct owned child");
  }
  return absolutePath;
}

async function cleanupOutputDirectory(ownedOutput) {
  await assertOwnedOutput(ownedOutput);
  await rm(ownedOutput.absolutePath, { recursive: true, force: true });
}

async function assertOwnedOutput(ownedOutput) {
  if (
    !ownedOutput ||
    typeof ownedOutput.absolutePath !== "string" ||
    typeof ownedOutput.identity?.device !== "number" ||
    typeof ownedOutput.identity?.inode !== "number" ||
    typeof ownedOutput.marker?.path !== "string" ||
    ownedOutput.marker.path !==
      join(ownedOutput.absolutePath, ownershipMarkerName) ||
    typeof ownedOutput.marker?.token !== "string" ||
    typeof ownedOutput.marker?.identity?.device !== "number" ||
    typeof ownedOutput.marker?.identity?.inode !== "number"
  ) {
    throw new Error("Observed output directory ownership changed");
  }
  let stat;
  try {
    stat = await lstat(ownedOutput.absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Observed output directory ownership changed");
    }
    throw error;
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.dev !== ownedOutput.identity.device ||
    stat.ino !== ownedOutput.identity.inode
  ) {
    throw new Error("Observed output directory ownership changed");
  }
  try {
    const markerHandle = await open(
      ownedOutput.marker.path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      const markerStat = await markerHandle.stat();
      const markerToken = await markerHandle.readFile("utf8");
      if (
        !markerStat.isFile() ||
        markerStat.dev !== ownedOutput.marker.identity.device ||
        markerStat.ino !== ownedOutput.marker.identity.inode ||
        markerToken !== ownedOutput.marker.token
      ) {
        throw new Error("Observed output directory ownership changed");
      }
    } finally {
      await markerHandle.close();
    }
  } catch (error) {
    if (error.message === "Observed output directory ownership changed") {
      throw error;
    }
    throw new Error("Observed output directory ownership changed", {
      cause: error,
    });
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runCommand(command, arguments_, options = {}) {
  const result = await captureProcess(command, arguments_, {
    ...options,
    maxOutputCharacters: options.maxOutputCharacters ?? 100_000,
    timeoutMs: options.timeoutMs ?? defaultCommandTimeoutMs,
  });
  if (result.code !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} failed (${result.code}): ${result.stderr.trim()}`,
    );
  }
  return {
    command: [command, ...arguments_].join(" "),
    exitCode: result.code,
    stdout: result.stdout,
    outputTailSha256: sha256(
      Buffer.from(`${result.stdout}\n${result.stderr}`.slice(-100_000)),
    ),
  };
}

async function git(arguments_, repositoryRoot) {
  const result = await captureProcess("git", arguments_, {
    cwd: repositoryRoot,
    env: boundedInheritedEnvironment(),
    timeoutMs: 30_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `git ${arguments_.join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

export async function captureProcess(command, arguments_, options = {}) {
  const {
    maxOutputCharacters,
    timeoutMs = defaultCommandTimeoutMs,
    ...spawnOptions
  } = options;
  const child = spawn(command, arguments_, {
    ...spawnOptions,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const append = (value, chunk) => {
    const combined = `${value}${String(chunk)}`;
    return maxOutputCharacters
      ? combined.slice(-maxOutputCharacters)
      : combined;
  };
  child.stdout.on("data", (chunk) => (stdout = append(stdout, chunk)));
  child.stderr.on("data", (chunk) => (stderr = append(stderr, chunk)));
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      callback();
    };
    const timeoutId = setTimeout(async () => {
      if (settled) return;
      settled = true;
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      await terminateProcessTree(child).catch(() => undefined);
      reject(
        new Error(
          `${command} ${arguments_.join(" ")} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) =>
      finish(() => resolvePromise({ code, stdout, stderr })),
    );
  });
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const result = await collectObservedSubmissionEvidence({
    artifactDirectory: args.artifactDirectory,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const directExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(
      `Observed submission evidence collection failed closed: ${error.message}\n`,
    );
    process.exitCode = 2;
  }
}
