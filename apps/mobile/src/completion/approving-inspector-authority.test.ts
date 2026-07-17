import { describe, expect, it } from "vitest";

import { resolveApprovingInspectorAuthority } from "./approving-inspector-authority.js";

const confirmedAt = "2026-07-17T10:30:00.000Z";

describe("approving inspector authority", () => {
  it("fails closed outside the synthetic demo when no verified profile exists", () => {
    expect(
      resolveApprovingInspectorAuthority({
        allowSyntheticFixture: false,
        confirmedAt,
        module: "building",
        syntheticInspectorId: "actor_demo",
      }),
    ).toBeUndefined();
  });

  it("binds an available verified inspector profile", () => {
    expect(
      resolveApprovingInspectorAuthority({
        allowSyntheticFixture: false,
        confirmedAt,
        module: "building",
        syntheticInspectorId: "actor_demo",
        verifiedProfile: {
          credential: "Verified credential",
          displayName: "Inspector Example",
          inspectorId: "actor_verified",
        },
      }),
    ).toEqual({
      authority: "verified_profile",
      confirmedAt,
      credential: "Verified credential",
      displayName: "Inspector Example",
      inspectorId: "actor_verified",
    });
  });

  it("allows the explicit synthetic fixture only in demo mode", () => {
    expect(
      resolveApprovingInspectorAuthority({
        allowSyntheticFixture: true,
        confirmedAt,
        module: "timber_pest",
        syntheticInspectorId: "actor_demo",
      }),
    ).toEqual({
      authority: "synthetic_fixture",
      confirmedAt,
      credential: "Synthetic fixture credential — not a live licensing claim",
      displayName: "Synthetic Build Week timber pest inspector",
      inspectorId: "actor_demo",
    });
  });
});
