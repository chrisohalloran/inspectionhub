import type { CaptureQueueItem, DeviceState } from "../capture/types";

type PendingSyncIdentity = Pick<CaptureQueueItem, "captureId" | "lane">;

type SyncPolicyInput = {
  appState: "background" | "foreground";
  deviceState: DeviceState;
  network: "available" | "unavailable";
  pending: readonly PendingSyncIdentity[];
  session: "expired" | "valid";
};

type SyncPlan =
  | {
      blockedBy:
        | "app_not_foreground"
        | "device_lost"
        | "device_revoked"
        | "offline"
        | "session_refresh_required";
      claim: "not_scheduled";
      lanes: {
        photo_upload: readonly string[];
        voice_upload: readonly string[];
      };
    }
  | {
      claim: "foreground_attempt_only";
      lanes: {
        photo_upload: readonly string[];
        voice_upload: readonly string[];
      };
    };

const emptyLanes = {
  photo_upload: [] as readonly string[],
  voice_upload: [] as readonly string[],
};

export function planForegroundSync(input: SyncPolicyInput): SyncPlan {
  let blockedBy:
    Extract<SyncPlan, { claim: "not_scheduled" }>["blockedBy"] | undefined;
  if (input.appState !== "foreground") {
    blockedBy = "app_not_foreground";
  } else if (input.deviceState !== "enrolled") {
    blockedBy =
      input.deviceState === "revoked" ? "device_revoked" : "device_lost";
  } else if (input.session !== "valid") {
    blockedBy = "session_refresh_required";
  } else if (input.network !== "available") {
    blockedBy = "offline";
  }

  if (blockedBy !== undefined) {
    return { blockedBy, claim: "not_scheduled", lanes: emptyLanes };
  }

  return {
    claim: "foreground_attempt_only",
    lanes: {
      photo_upload: input.pending
        .filter((item) => item.lane === "photo_upload")
        .map((item) => item.captureId),
      voice_upload: input.pending
        .filter((item) => item.lane === "voice_upload")
        .map((item) => item.captureId),
    },
  };
}

export function assessEvidenceRisk(input: {
  deviceState: DeviceState;
  unsynchronisedCaptureIds: readonly string[];
}):
  | { captureIds: readonly string[]; state: "evidence_at_risk" }
  | { captureIds: readonly []; state: "server_durable" }
  | { captureIds: readonly string[]; state: "local_pending" } {
  if (input.unsynchronisedCaptureIds.length === 0) {
    return { captureIds: [], state: "server_durable" };
  }
  if (input.deviceState === "lost" || input.deviceState === "revoked") {
    return {
      captureIds: [...input.unsynchronisedCaptureIds],
      state: "evidence_at_risk",
    };
  }
  return {
    captureIds: [...input.unsynchronisedCaptureIds],
    state: "local_pending",
  };
}
