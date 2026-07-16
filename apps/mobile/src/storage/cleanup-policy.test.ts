import { describe, expect, it } from "vitest";

import { canDeleteLocalOriginal } from "./cleanup-policy.js";

describe("local original cleanup policy", () => {
  it("requires observed server durability and retention eligibility", () => {
    expect(
      canDeleteLocalOriginal({
        disputeOrProfessionalHold: false,
        referencedByRetainedRecord: false,
        retentionEligible: true,
        serverDurable: true,
      }),
    ).toEqual({ allowed: true });

    expect(
      canDeleteLocalOriginal({
        disputeOrProfessionalHold: false,
        referencedByRetainedRecord: false,
        retentionEligible: true,
        serverDurable: false,
      }),
    ).toEqual({ allowed: false, reason: "not_server_durable" });
  });

  it("never removes evidence that remains referenced or held", () => {
    expect(
      canDeleteLocalOriginal({
        disputeOrProfessionalHold: true,
        referencedByRetainedRecord: false,
        retentionEligible: true,
        serverDurable: true,
      }),
    ).toEqual({ allowed: false, reason: "evidence_hold" });
    expect(
      canDeleteLocalOriginal({
        disputeOrProfessionalHold: false,
        referencedByRetainedRecord: true,
        retentionEligible: true,
        serverDurable: true,
      }),
    ).toEqual({ allowed: false, reason: "retained_reference" });
  });
});
