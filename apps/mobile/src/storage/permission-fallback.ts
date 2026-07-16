import type { CaptureKind, CapturePermission } from "../capture/types";

export type PermissionFallback = {
  blockedCapability: "camera" | "microphone" | "storage";
  manualNoteAvailable: true;
  message: string;
};

export function permissionFallback(
  kind: CaptureKind | "storage",
  permission: Exclude<CapturePermission, "granted">,
): PermissionFallback {
  const capability =
    kind === "photo" ? "camera" : kind === "voice" ? "microphone" : "storage";
  return {
    blockedCapability: capability,
    manualNoteAvailable: true,
    message: `${capability === "storage" ? "Local storage" : capability} is ${permission}. Add a manual note now and resolve access before capturing media.`,
  };
}
