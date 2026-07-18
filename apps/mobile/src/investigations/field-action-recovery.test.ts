import { describe, expect, it } from "vitest";

import { describeFieldActionFailure } from "./field-action-recovery";

describe("field action recovery wording", () => {
  it("invites retry only after durable reload succeeds", () => {
    expect(describeFieldActionFailure(new Error("save failed"))).toEqual({
      message:
        "Field action not completed — save failed. Durable state reloaded; review and retry.",
      recoveryBlocked: false,
    });
  });

  it("preserves both failures and blocks work when durable reload fails", () => {
    expect(
      describeFieldActionFailure(
        new Error("save failed"),
        new Error("snapshot corrupt"),
      ),
    ).toEqual({
      message:
        "Field action not completed — save failed. Recovery blocked — durable state could not be reloaded (snapshot corrupt). Restart the app before continuing professional work.",
      recoveryBlocked: true,
    });
  });
});
