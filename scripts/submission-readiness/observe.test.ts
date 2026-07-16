import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedMarkdownSection,
  captureProcess,
  collectObservedSubmissionEvidence,
  createOwnedDirectory,
  observeExactCommit,
  observeProvenance,
  observePublicCi,
  observePublicRepository,
  observeSubmissionFields,
  prepareFreshOutputDirectory,
  runtimeObserverLabel,
} from "./observe.mjs";
import { observedExpectedBlockers } from "./observed-input.mjs";

const commitSha = "a".repeat(40);
const rootCommitSha = "c".repeat(40);
const temporaryDirectories: string[] = [];

const validSections = {
  oneLine:
    "InspectionHub is a local-first inspection workflow to capture evidence and deliver clear reports from the field.",
  whatWeBuilt:
    "InspectionHub gives the inspector a field workflow to capture every photo and voice note as durable evidence. The local store saves each item before the inspector continues, while investigation threads connect extent checks and measurements. The inspector can review suggested language, approve selected conditions, and deliver a clear recipient report. A verifier checks source links before the system can render the final report, so the professional remains responsible for every conclusion.",
  codexAndGpt:
    "Codex is the primary engineering workspace for architecture, implementation, and tests. GPT-5.6 drafts bounded report language from selected evidence while a verifier checks every source and keeps final approval with the inspector.",
};

function devpostCopy(sections = validSections) {
  return [
    "# Devpost copy",
    "## Track",
    "Work and Productivity",
    "## One-line description",
    sections.oneLine,
    "## What we built",
    sections.whatWeBuilt,
    "## How we used Codex and GPT-5.6",
    sections.codexAndGpt,
    "## Technical implementation",
    "Additional bounded public submission material.",
  ].join("\n\n");
}

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "inspectionhub-observe-test-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function observationDependencies(overrides = {}) {
  const timestamps = ["2026-07-16T03:00:00.000Z", "2026-07-16T03:10:00.000Z"];
  const sourceText = devpostCopy();
  return {
    now: () => timestamps.shift() ?? "2026-07-16T03:10:00.000Z",
    requireCleanPublicCommit: async () => commitSha,
    recheckExactCommit: async (value: string) => {
      if (value !== commitSha) throw new Error("wrong commit");
      return value;
    },
    observePublicRepository: async () => ({
      url: "https://github.com/example/project",
      finalUrl: "https://github.com/example/project",
      status: 200,
      loggedOut: true,
      headSha: commitSha,
    }),
    observePublicCi: async () => ({
      conclusion: "success",
      headSha: commitSha,
      url: "https://github.com/example/project/actions/runs/1",
    }),
    observeSubmissionFields: async () => ({
      path: "docs/submission/devpost-copy.md",
      sourceText,
      sha256: "b".repeat(64),
      track: "Work and Productivity",
      sections: validSections,
      sectionLengths: Object.fromEntries(
        Object.entries(validSections).map(([key, body]) => [key, body.length]),
      ),
      englishDescriptionPresent: true,
      featuresAndFunctionalityPresent: true,
    }),
    observeProvenance: async () => ({
      rootCommitCount: 1,
      rootCommitSha,
      publicRootCommitSha: rootCommitSha,
      rootCommitAt: "2026-07-15T01:00:00.000Z",
      publicRootCommitAt: "2026-07-15T01:00:00.000Z",
      repositoryCreatedAt: "2026-07-14T01:00:00.000Z",
    }),
    observeExactCommit: async () => ({
      runtime: { node: "v24.0.0", pnpm: "10.29.3" },
      cleanBuild: { install: { exitCode: 0 }, build: { exitCode: 0 } },
      judgeDemo: {
        statuses: { root: 200, invitation: 303, otp: 303, report: 200 },
        expectedContentPresent: true,
        exitCode: 0,
      },
    }),
    validateSubmission: async (input: { requirements: unknown[] }) => ({
      valid: true,
      ready: false,
      manifest: {
        outcome: "blocked",
        requirements: input.requirements,
        blockers: [...observedExpectedBlockers],
      },
    }),
    observerLabel: () => runtimeObserverLabel(),
    ...overrides,
  };
}

describe("observed submission collector", () => {
  it("collects exact-commit evidence without fabricating judge availability", async () => {
    const repositoryRoot = await temporaryDirectory();
    let validationOptions: {
      verifiedExternalObservations?: {
        provenance?: {
          evidenceId: string;
          evidenceKind: string;
          commitSha: string;
          observedAt: string;
          artifactSha256: string;
          observation: { publicRootCommitSha: string };
        };
      };
    } = {};
    const result = await collectObservedSubmissionEvidence({
      repositoryRoot,
      artifactDirectory: "artifacts/validation/happy-path",
      dependencies: observationDependencies({
        validateSubmission: async (
          input: { requirements: unknown[] },
          options: typeof validationOptions,
        ) => {
          validationOptions = options;
          return {
            valid: true,
            ready: false,
            manifest: {
              outcome: "blocked",
              requirements: input.requirements,
              blockers: [...observedExpectedBlockers],
            },
          };
        },
      }),
    });

    expect(result.passed).toEqual([
      "working_project",
      "track",
      "description",
      "repository",
      "provenance",
    ]);
    expect(result.passed).not.toContain("judge_access");
    expect(result.blockers).toContain("judge_access_unproven");
    const evidence = JSON.parse(await readFile(result.evidencePath, "utf8"));
    expect(
      evidence.evidence.map((item: { id: string }) => item.id),
    ).not.toContain("judge-test-build");
    expect(evidence.evidence[0].provenance.observer).toMatch(
      /^automated-submission-observer\//u,
    );
    expect(
      validationOptions.verifiedExternalObservations?.provenance,
    ).toMatchObject({
      evidenceId: "submission-period-provenance",
      evidenceKind: "submission_field",
      commitSha,
      observedAt: "2026-07-16T03:10:00.000Z",
      observation: { publicRootCommitSha: rootCommitSha },
    });
    expect(
      validationOptions.verifiedExternalObservations?.provenance
        ?.artifactSha256,
    ).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("cleans its fresh output when materialization fails mid-write", async () => {
    const repositoryRoot = await temporaryDirectory();
    const output = join(
      repositoryRoot,
      "artifacts/validation/mid-write-failure",
    );
    await expect(
      collectObservedSubmissionEvidence({
        repositoryRoot,
        artifactDirectory: "artifacts/validation/mid-write-failure",
        dependencies: observationDependencies({
          writeEvidenceArtifact: async () => {
            throw new Error("simulated write failure");
          },
        }),
      }),
    ).rejects.toThrow(/simulated write failure/u);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves collection and cleanup failures in one AggregateError", async () => {
    const repositoryRoot = await temporaryDirectory();
    const operationError = new Error("simulated write failure");
    const cleanupError = new Error("simulated cleanup failure");

    await expect(
      collectObservedSubmissionEvidence({
        repositoryRoot,
        artifactDirectory: "artifacts/validation/combined-failure",
        dependencies: observationDependencies({
          writeEvidenceArtifact: async () => {
            throw operationError;
          },
          cleanupOutputDirectory: async () => {
            throw cleanupError;
          },
        }),
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([
        operationError,
        cleanupError,
      ]);
      expect((error as Error).message).toMatch(/cleanup also failed/u);
      return true;
    });
  });

  it("rejects a replaced observations directory without touching its symlink target", async () => {
    const repositoryRoot = await temporaryDirectory();
    const externalTarget = await temporaryDirectory();
    const externalMarker = join(externalTarget, "keep.txt");
    await writeFile(externalMarker, "do not touch");
    const artifactDirectory = "artifacts/validation/replaced-observations";

    await expect(
      collectObservedSubmissionEvidence({
        repositoryRoot,
        artifactDirectory,
        dependencies: observationDependencies({
          createOwnedDirectory: async (
            path: string,
            ownedOutput: {
              absolutePath: string;
              relativePath: string;
              identity: { device: number; inode: number };
              marker: {
                path: string;
                token: string;
                identity: { device: number; inode: number };
              };
            },
          ) => {
            const ownedObservations = await createOwnedDirectory(
              path,
              ownedOutput,
            );
            await rm(ownedObservations.absolutePath, {
              recursive: true,
              force: true,
            });
            await symlink(externalTarget, ownedObservations.absolutePath);
            return ownedObservations;
          },
        }),
      }),
    ).rejects.toThrow(/ownership changed/u);

    await expect(readFile(externalMarker, "utf8")).resolves.toBe(
      "do not touch",
    );
    await expect(
      readFile(join(externalTarget, "working-project.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["before-create", "before-write"])(
    "rejects a replacement output %s and does not delete it",
    async (phase) => {
      const repositoryRoot = await temporaryDirectory();
      const artifactDirectory = `artifacts/validation/replaced-${phase}`;
      const output = join(repositoryRoot, artifactDirectory);
      const marker = join(output, "replacement.txt");
      const replaceOutput = async (ownedOutput: { absolutePath: string }) => {
        await rm(ownedOutput.absolutePath, { recursive: true, force: true });
        await mkdir(ownedOutput.absolutePath);
        await writeFile(marker, "replacement");
      };
      const overrides =
        phase === "before-create"
          ? {
              prepareOutputDirectory: async (path: string) => {
                const ownedOutput = await prepareFreshOutputDirectory(
                  repositoryRoot,
                  path,
                );
                await replaceOutput(ownedOutput);
                return ownedOutput;
              },
            }
          : {
              createOwnedDirectory: async (
                path: string,
                ownedOutput: Parameters<typeof createOwnedDirectory>[1],
              ) => {
                const ownedObservations = await createOwnedDirectory(
                  path,
                  ownedOutput,
                );
                await replaceOutput(ownedOutput);
                return ownedObservations;
              },
            };

      await expect(
        collectObservedSubmissionEvidence({
          repositoryRoot,
          artifactDirectory,
          dependencies: observationDependencies(overrides),
        }),
      ).rejects.toThrow(/ownership changed/u);
      await expect(readFile(marker, "utf8")).resolves.toBe("replacement");
    },
  );
});

describe("bounded public observations", () => {
  it("derives English and product-feature evidence from bounded Devpost copy", async () => {
    const repositoryRoot = await temporaryDirectory();
    const path = join(repositoryRoot, "docs/submission/devpost-copy.md");
    const sourceText = devpostCopy();
    await mkdir(join(repositoryRoot, "docs/submission"), { recursive: true });
    await writeFile(path, sourceText);

    const result = await observeSubmissionFields(repositoryRoot);

    expect(result.sourceText).toBe(sourceText);
    expect(result.sections).toEqual(validSections);
    expect(result.englishDescriptionPresent).toBe(true);
    expect(result.featuresAndFunctionalityPresent).toBe(true);
  });

  it("rejects bounded non-English Devpost description copy", async () => {
    const repositoryRoot = await temporaryDirectory();
    const path = join(repositoryRoot, "docs/submission/devpost-copy.md");
    const sections = {
      oneLine:
        "InspectionHub es un flujo local que permite capturar pruebas visuales y entregar informes claros desde cada propiedad.",
      whatWeBuilt:
        "InspectionHub ofrece un flujo de campo donde el inspector captura cada foto y nota de voz como prueba duradera. El almacenamiento local conserva cada elemento antes de continuar, mientras los hilos de investigación conectan comprobaciones y medidas. El inspector revisa lenguaje sugerido, confirma condiciones seleccionadas y entrega un informe claro. Un verificador comprueba los enlaces de origen antes de preparar el informe final, manteniendo la responsabilidad profesional sobre cada conclusión documentada.",
      codexAndGpt:
        "Codex fue el espacio principal para arquitectura, implementación y pruebas. GPT-5.6 redactó lenguaje limitado desde pruebas seleccionadas, mientras un verificador comprobó cada fuente y mantuvo la aprobación final con el inspector responsable.",
    };
    await mkdir(join(repositoryRoot, "docs/submission"), { recursive: true });
    await writeFile(path, devpostCopy(sections));

    await expect(observeSubmissionFields(repositoryRoot)).rejects.toThrow(
      /not conservatively English/u,
    );
  });

  it("rejects bounded English copy unrelated to product functionality", async () => {
    const repositoryRoot = await temporaryDirectory();
    const path = join(repositoryRoot, "docs/submission/devpost-copy.md");
    const sections = {
      oneLine:
        "This cheerful recipe notebook is a place to remember favourite meals and share family stories with friends.",
      whatWeBuilt:
        "The notebook is a welcoming collection of recipes for people who enjoy cooking at home. Each page tells the story of a meal, the people who shared it, and the ingredients that made it memorable. Readers can browse notes about bread, soup, fruit, and festive dinners. The writing is clear and friendly, with enough detail for a family member to understand why each recipe matters and when it became part of the household tradition.",
      codexAndGpt:
        "Codex was used for implementation and tests in the writing workspace. GPT-5.6 helped draft short introductions while the editor checked the language and retained final approval for every published recipe.",
    };
    await mkdir(join(repositoryRoot, "docs/submission"), { recursive: true });
    await writeFile(path, devpostCopy(sections));

    await expect(observeSubmissionFields(repositoryRoot)).rejects.toThrow(
      /does not explain concrete product features/u,
    );
  });

  it("rejects CI results from the wrong workflow or event", async () => {
    await expect(
      observePublicCi(commitSha, {
        fetchJsonImpl: async () => ({
          status: 200,
          body: {
            workflow_runs: [
              {
                id: 1,
                head_sha: commitSha,
                head_branch: "main",
                event: "pull_request",
                path: ".github/workflows/other.yml",
                status: "completed",
                conclusion: "success",
                run_attempt: 1,
              },
            ],
          },
        }),
      }),
    ).rejects.toThrow(/CI\/main\/push/u);
  });

  it.each([
    {
      label: "failed",
      newest: {
        id: 2,
        status: "completed",
        conclusion: "failure",
        run_started_at: "2026-07-16T03:05:00.000Z",
      },
    },
    {
      label: "in progress",
      newest: { id: 3, status: "in_progress", conclusion: null },
    },
  ])(
    "rejects an older CI success when the newest run is $label",
    async ({ newest }) => {
      const identity = {
        head_sha: commitSha,
        head_branch: "main",
        event: "push",
        path: ".github/workflows/ci.yml",
        run_attempt: 1,
      };
      await expect(
        observePublicCi(commitSha, {
          fetchJsonImpl: async () => ({
            status: 200,
            body: {
              workflow_runs: [
                { ...identity, ...newest },
                {
                  ...identity,
                  id: 1,
                  status: "completed",
                  conclusion: "success",
                  run_started_at: "2026-07-16T03:00:00.000Z",
                },
              ],
            },
          }),
        }),
      ).rejects.toThrow(/latest attempt/u);
    },
  );

  it("uses the injected JSON transport for public repository identity", async () => {
    const repositoryRoot = await temporaryDirectory();
    const readme = [
      "## Local setup",
      "pnpm test:e2e:web scripts/demo-seed AGPL-3.0-only",
      "## Codex collaboration and GPT-5.6",
      `Codex and GPT-5.6 were used for ${"grounded evidence ".repeat(12)}`,
    ].join("\n\n");
    const license = "GNU AFFERO GENERAL PUBLIC LICENSE";
    await writeFile(join(repositoryRoot, "README.md"), readme);
    await writeFile(join(repositoryRoot, "LICENSE"), license);
    let jsonCalls = 0;

    const result = await observePublicRepository(commitSha, {
      repositoryRoot,
      fetchTextImpl: async (url: string) => {
        let text = "available";
        if (url.endsWith("/README.md")) text = readme;
        else if (url.endsWith("/LICENSE")) text = license;
        return {
          status: 200,
          finalUrl: url,
          bytes: Buffer.from(text),
          text,
        };
      },
      fetchJsonImpl: async () => {
        jsonCalls += 1;
        return { status: 200, body: { sha: commitSha } };
      },
    });

    expect(result.headSha).toBe(commitSha);
    expect(jsonCalls).toBe(1);
  });

  it("rejects heading-only submission copy", () => {
    expect(() =>
      boundedMarkdownSection(
        "## How we used Codex and GPT-5.6\n\n## Technical implementation",
        "## How we used Codex and GPT-5.6",
        { minimumLength: 120 },
      ),
    ).toThrow(/must contain/u);
  });

  it("rejects a public root identity that differs from the only local root", async () => {
    const responses = [
      { status: 200, body: { created_at: "2026-07-14T01:00:00.000Z" } },
      {
        status: 200,
        body: {
          sha: "d".repeat(40),
          commit: { committer: { date: "2026-07-15T01:00:00.000Z" } },
        },
      },
    ];
    await expect(
      observeProvenance(commitSha, {
        repositoryRoot: "/unused",
        gitImpl: async (arguments_: string[]) =>
          arguments_[0] === "rev-list"
            ? rootCommitSha
            : "2026-07-15T01:00:00.000Z",
        fetchJsonImpl: async () => responses.shift(),
      }),
    ).rejects.toThrow(/Public root commit identity/u);
  });

  it("times out and terminates a hanging command", async () => {
    await expect(
      captureProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/timed out/u);
  });

  it("surfaces worktree cleanup failure without masking the primary error", async () => {
    const gitCalls: string[][] = [];
    const gitImpl = async (arguments_: string[]) => {
      gitCalls.push(arguments_);
      if (arguments_[1] === "add") return "";
      if (arguments_[1] === "remove") throw new Error("remove failed");
      if (arguments_[1] === "prune") throw new Error("prune failed");
      throw new Error(`unexpected git call: ${arguments_.join(" ")}`);
    };

    await expect(
      observeExactCommit(commitSha, {
        repositoryRoot: "/unused",
        gitImpl,
        runCommandImpl: async () => {
          throw new Error("primary build failed");
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as Error).message).toMatch(/primary build failed/u);
      expect((error as Error).message).toMatch(/cleanup also failed/u);
      return true;
    });
    expect(gitCalls.filter((call) => call[1] === "remove")).toHaveLength(2);
    expect(gitCalls.filter((call) => call[1] === "prune")).toHaveLength(1);
  });

  it("throws a cleanup-only exact-commit failure", async () => {
    const gitImpl = async (arguments_: string[]) => {
      if (arguments_[1] === "add") return "";
      if (arguments_[1] === "remove") throw new Error("remove failed");
      if (arguments_[1] === "prune") throw new Error("prune failed");
      throw new Error(`unexpected git call: ${arguments_.join(" ")}`);
    };

    await expect(
      observeExactCommit(commitSha, {
        repositoryRoot: "/unused",
        gitImpl,
        runCommandImpl: async () => ({
          command: "stub",
          exitCode: 0,
          stdout: "v24.0.0",
          outputTailSha256: "d".repeat(64),
        }),
        observeJudgeDemoImpl: async () => ({
          statuses: { root: 200, invitation: 303, otp: 303, report: 200 },
          expectedContentPresent: true,
          exitCode: 0,
        }),
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as Error).message).toMatch(/remove or prune/u);
      return true;
    });
  });

  it("does not follow or remove a prepared output symlink", async () => {
    const repositoryRoot = await temporaryDirectory();
    const target = await temporaryDirectory();
    await mkdir(join(repositoryRoot, "artifacts/validation"), {
      recursive: true,
    });
    const link = join(repositoryRoot, "artifacts/validation/prepared-link");
    await symlink(target, link);
    await expect(
      prepareFreshOutputDirectory(
        repositoryRoot,
        "artifacts/validation/prepared-link",
      ),
    ).rejects.toThrow(/already exists/u);
    await expect(readFile(join(target, "missing"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
