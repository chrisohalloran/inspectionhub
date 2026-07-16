import type { CaptureMachineState } from "./types";

export type CaptureMachineEvent =
  | "acknowledge"
  | "block"
  | "commit_ledger"
  | "fail"
  | "persist_file"
  | "reserve_identity";

const transitions: Readonly<
  Record<
    CaptureMachineState,
    Partial<Record<CaptureMachineEvent, CaptureMachineState>>
  >
> = {
  acknowledged: {},
  blocked: {},
  committing_ledger: { acknowledge: "acknowledged", fail: "failed" },
  failed: {},
  idle: { block: "blocked", reserve_identity: "reserving_identity" },
  persisting_file: { commit_ledger: "committing_ledger", fail: "failed" },
  reserving_identity: { fail: "failed", persist_file: "persisting_file" },
};

export function transitionCaptureMachine(
  state: CaptureMachineState,
  event: CaptureMachineEvent,
): CaptureMachineState {
  const next = transitions[state][event];
  if (next === undefined) {
    throw new Error(`Invalid capture transition: ${state} -> ${event}`);
  }
  return next;
}

export class CaptureMachine {
  readonly #trace: CaptureMachineState[] = ["idle"];

  get state(): CaptureMachineState {
    return this.#trace.at(-1) ?? "idle";
  }

  get trace(): readonly CaptureMachineState[] {
    return [...this.#trace];
  }

  send(event: CaptureMachineEvent): void {
    this.#trace.push(transitionCaptureMachine(this.state, event));
  }
}
