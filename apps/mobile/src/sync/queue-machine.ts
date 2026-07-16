import type { CaptureQueueState } from "../capture/types";

export type QueueEvent =
  | "begin_upload"
  | "block_revoked"
  | "block_session"
  | "confirm_server_durable"
  | "fail"
  | "retry";

const queueTransitions: Readonly<
  Record<CaptureQueueState, Partial<Record<QueueEvent, CaptureQueueState>>>
> = {
  blocked_revoked: {},
  blocked_session: { retry: "pending" },
  failed: { retry: "pending" },
  pending: {
    begin_upload: "uploading",
    block_revoked: "blocked_revoked",
    block_session: "blocked_session",
    fail: "failed",
  },
  server_durable: {},
  uploading: {
    block_revoked: "blocked_revoked",
    block_session: "blocked_session",
    confirm_server_durable: "server_durable",
    fail: "failed",
    retry: "pending",
  },
};

export function transitionQueueState(
  state: CaptureQueueState,
  event: QueueEvent,
): CaptureQueueState {
  const next = queueTransitions[state][event];
  if (next === undefined) {
    throw new Error(`Invalid queue transition: ${state} -> ${event}`);
  }
  return next;
}
