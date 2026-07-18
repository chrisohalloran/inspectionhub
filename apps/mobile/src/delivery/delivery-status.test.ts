import { describe, expect, it } from "vitest";

import {
  fieldDeliveryStatus,
  syntheticProviderDeliveryPath,
} from "./delivery-status.js";

describe("literal field delivery status", () => {
  it("allows departure while evidence synchronises without claiming sent", () => {
    expect(fieldDeliveryStatus("waiting_for_evidence")).toEqual({
      heading: "Delivery queued — evidence synchronising",
      detail:
        "You can leave site. Delivery will start only after required originals are checksum-confirmed as durable.",
      terminal: false,
      leaveSiteAllowed: true,
      interventionRequired: false,
    });
  });

  it("keeps queued, accepted, sent, unknown and failed semantically distinct", () => {
    expect(fieldDeliveryStatus("queued").heading).toBe("Delivery queued");
    expect(fieldDeliveryStatus("provider_accepted").heading).toBe(
      "Provider accepted",
    );
    expect(fieldDeliveryStatus("sent").heading).toBe("Sent");
    expect(fieldDeliveryStatus("unknown").heading).toBe(
      "Delivery outcome unknown",
    );
    expect(fieldDeliveryStatus("failed", true).heading).toBe(
      "Delivery needs attention",
    );
  });

  it("lets the provider fixture traverse only a queued hash-bound package", () => {
    expect(
      syntheticProviderDeliveryPath({
        packageManifestSha256: "a".repeat(64),
        state: "queued",
      }),
    ).toEqual(["sending", "provider_accepted", "sent"]);
    for (const state of [
      "waiting_for_evidence",
      "failed",
      "unknown",
      "cancelled",
    ] as const) {
      expect(() =>
        syntheticProviderDeliveryPath({
          packageManifestSha256: "a".repeat(64),
          state,
        }),
      ).toThrow("queued, hash-bound package");
    }
  });
});
