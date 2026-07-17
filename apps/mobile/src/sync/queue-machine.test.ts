import { describe, expect, it } from "vitest";

import {
  syntheticServerDurabilityPath,
  transitionQueueState,
} from "./queue-machine.js";

describe("capture queue state machine", () => {
  it("requires checksum-confirmed server durability after an upload begins", () => {
    expect(transitionQueueState("pending", "begin_upload")).toBe("uploading");
    expect(transitionQueueState("uploading", "confirm_server_durable")).toBe(
      "server_durable",
    );
  });

  it("does not resurrect server-durable or revoked-device work", () => {
    expect(() => transitionQueueState("server_durable", "retry")).toThrow(
      "Invalid queue transition",
    );
    expect(() => transitionQueueState("blocked_revoked", "retry")).toThrow(
      "Invalid queue transition",
    );
  });

  it("gives the E2E server fixture only valid queue transitions", () => {
    expect(syntheticServerDurabilityPath("pending")).toEqual([
      "begin_upload",
      "confirm_server_durable",
    ]);
    expect(syntheticServerDurabilityPath("uploading")).toEqual([
      "confirm_server_durable",
    ]);
    expect(syntheticServerDurabilityPath("failed")).toEqual([
      "retry",
      "begin_upload",
      "confirm_server_durable",
    ]);
    expect(syntheticServerDurabilityPath("blocked_session")).toEqual([
      "retry",
      "begin_upload",
      "confirm_server_durable",
    ]);
    expect(syntheticServerDurabilityPath("server_durable")).toEqual([]);
    expect(() => syntheticServerDurabilityPath("blocked_revoked")).toThrow(
      "cannot bypass a revoked-device block",
    );
  });
});
