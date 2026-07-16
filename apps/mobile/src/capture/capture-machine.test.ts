import { describe, expect, it } from "vitest";

import { CaptureMachine, transitionCaptureMachine } from "./capture-machine.js";

describe("capture state machine", () => {
  it("has one ordered acknowledgement path", () => {
    const machine = new CaptureMachine();
    machine.send("reserve_identity");
    machine.send("persist_file");
    machine.send("commit_ledger");
    machine.send("acknowledge");

    expect(machine.trace).toEqual([
      "idle",
      "reserving_identity",
      "persisting_file",
      "committing_ledger",
      "acknowledged",
    ]);
  });

  it("rejects acknowledgement before the ledger boundary", () => {
    expect(() =>
      transitionCaptureMachine("persisting_file", "acknowledge"),
    ).toThrow("Invalid capture transition");
    expect(() => transitionCaptureMachine("idle", "acknowledge")).toThrow(
      "Invalid capture transition",
    );
  });
});
