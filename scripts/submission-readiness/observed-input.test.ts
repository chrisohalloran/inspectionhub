import { describe, expect, it } from "vitest";

import {
  assembleObservedSubmissionInput,
  createObservedSubmissionEvidence,
  createObservedSubmissionInput,
  observedExpectedBlockers,
} from "./observed-input.mjs";

const sha = "a".repeat(40);
function artifact(id: string) {
  return {
    path: `artifacts/validation/observed/${id}.json`,
    sha256: "b".repeat(64),
  };
}

function observation() {
  return {
    observer: "Codex root implementation session",
    startedAt: "2026-07-16T03:00:00.000Z",
    endedAt: "2026-07-16T03:10:00.000Z",
    commitSha: sha,
    ci: {
      conclusion: "success",
      headSha: sha,
      url: "https://github.com/example/project/actions/runs/1",
    },
    repository: {
      url: "https://github.com/example/project",
      finalUrl: "https://github.com/example/project",
      status: 200,
      loggedOut: true,
      headSha: sha,
    },
    judgeDemo: {
      statuses: { root: 200, invitation: 303, otp: 303, report: 200 },
      expectedContentPresent: true,
      exitCode: 0,
    },
    provenance: {
      rootCommitCount: 1,
      rootCommitSha: "c".repeat(40),
      publicRootCommitSha: "c".repeat(40),
      rootCommitAt: "2026-07-15T01:00:00.000Z",
      repositoryCreatedAt: "2026-07-14T01:00:00.000Z",
    },
    artifacts: {
      workingProject: artifact("working-project"),
      track: artifact("track"),
      description: artifact("description"),
      repository: artifact("repository"),
      provenance: artifact("provenance"),
    },
  };
}

describe("observed submission input", () => {
  it("passes only the five requirements supported by current observations", () => {
    const input = createObservedSubmissionInput(observation());
    const passed = input.requirements
      .filter((item) => item.status === "pass")
      .map((item) => item.id);
    const unproven = input.requirements
      .filter((item) => item.status === "unproven")
      .map((item) => item.id);

    expect(passed).toEqual([
      "working_project",
      "track",
      "description",
      "repository",
      "provenance",
    ]);
    expect(unproven).toEqual([
      "codex_and_gpt56",
      "video",
      "feedback_session",
      "judge_access",
      "rights_and_safety",
      "devpost_form",
    ]);
    expect(input.evidence).toHaveLength(5);
    expect(input.evidence.some((item) => item.id === "judge-test-build")).toBe(
      false,
    );
    expect(
      input.evidence.find((item) => item.id === "working-project")?.details
        .localStatuses,
    ).toEqual({ root: 200, invitation: 303, otp: 303, report: 200 });
  });

  it("rejects a green CI run for a different commit", () => {
    const value = observation();
    value.ci.headSha = "d".repeat(40);
    expect(() => createObservedSubmissionInput(value)).toThrow(
      /exact observed commit/u,
    );
  });

  it("does not fabricate a judge-access pass from a local flow", () => {
    const value = observation();
    const input = createObservedSubmissionInput(value);
    expect(
      input.requirements.find((item) => item.id === "judge_access"),
    ).toMatchObject({
      status: "unproven",
      evidenceIds: [],
    });
  });

  it("rejects provenance outside the official submission period", () => {
    const value = observation();
    value.provenance.rootCommitAt = "2026-07-12T00:00:00.000Z";
    expect(() => createObservedSubmissionInput(value)).toThrow(
      /provenance must match/u,
    );
  });

  it("rejects a public root commit that differs from the local root", () => {
    const value = observation();
    value.provenance.publicRootCommitSha = "d".repeat(40);
    expect(() => createObservedSubmissionInput(value)).toThrow(
      /provenance must match/u,
    );
  });

  it("assembles only fully materialized claim-specific evidence", () => {
    const value = observation();
    const drafts = createObservedSubmissionEvidence(value);
    expect(drafts.every((record) => !("artifact" in record))).toBe(true);
    const evidence = drafts.map((record) => ({
      ...record,
      artifact: artifact(record.id),
    }));
    const input = assembleObservedSubmissionInput(value, evidence);
    expect(input.evidence.map((record) => record.artifact.path)).toEqual(
      drafts.map((record) => `artifacts/validation/observed/${record.id}.json`),
    );
    expect(observedExpectedBlockers).toEqual([
      "codex_and_gpt56_unproven",
      "video_unproven",
      "feedback_session_unproven",
      "judge_access_unproven",
      "rights_and_safety_unproven",
      "devpost_form_unproven",
      "skipped_checks_present",
    ]);
  });
});
