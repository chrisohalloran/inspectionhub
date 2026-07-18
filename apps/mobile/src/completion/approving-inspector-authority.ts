import type { ModuleApprovalInspectorAuthority } from "../capture/types";

type VerifiedInspectorProfile = Readonly<{
  credential: string;
  displayName: string;
  inspectorId: string;
}>;

export function resolveApprovingInspectorAuthority(input: {
  allowSyntheticFixture: boolean;
  confirmedAt: string;
  module: "building" | "timber_pest";
  syntheticInspectorId: string;
  verifiedProfile?: VerifiedInspectorProfile;
}): ModuleApprovalInspectorAuthority | undefined {
  if (input.verifiedProfile !== undefined) {
    return {
      ...input.verifiedProfile,
      authority: "verified_profile",
      confirmedAt: input.confirmedAt,
    };
  }
  if (!input.allowSyntheticFixture) return undefined;
  return {
    authority: "synthetic_fixture",
    confirmedAt: input.confirmedAt,
    credential: "Synthetic fixture credential — not a live licensing claim",
    displayName:
      input.module === "building"
        ? "Synthetic Build Week building inspector"
        : "Synthetic Build Week timber pest inspector",
    inspectorId: input.syntheticInspectorId,
  };
}
