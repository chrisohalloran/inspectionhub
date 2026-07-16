import { describe, expect, it } from "vitest";

import { fieldDeliveryStatus } from "./delivery-status.js";

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
});
