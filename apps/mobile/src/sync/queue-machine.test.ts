import { describe, expect, it } from "vitest";

import { transitionQueueState } from "./queue-machine.js";

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
});
