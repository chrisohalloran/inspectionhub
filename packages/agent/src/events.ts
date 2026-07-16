import { sha256 } from "@inspection/domain";

export type AgentRunEventType =
  | "run.started"
  | "attempt.started"
  | "packet.loaded"
  | "skill.loaded"
  | "model.requested"
  | "model.completed"
  | "draft.persisted"
  | "deterministic_check.completed"
  | "verifier.requested"
  | "verifier.completed"
  | "run.superseded"
  | "run.completed"
  | "run.failed"
  | "run.manual_fallback";

export type SafeEventValue = string | number | boolean | null;

export type AgentRunEvent = {
  readonly eventId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly sequence: number;
  readonly type: AgentRunEventType;
  readonly occurredAt: string;
  readonly safeMetadata: Readonly<Record<string, SafeEventValue>>;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
};

export interface AgentRunEventStore {
  append(
    input: Omit<AgentRunEvent, "sequence" | "previousEventHash" | "eventHash">,
  ): AgentRunEvent | Promise<AgentRunEvent>;
  read(
    runId: string,
  ): readonly AgentRunEvent[] | Promise<readonly AgentRunEvent[]>;
}

export class InMemoryAgentRunEventStore implements AgentRunEventStore {
  readonly #events = new Map<string, AgentRunEvent[]>();

  append(
    input: Omit<AgentRunEvent, "sequence" | "previousEventHash" | "eventHash">,
  ): AgentRunEvent {
    assertSafeMetadata(input.safeMetadata);
    const events = this.#events.get(input.runId) ?? [];
    const previousEventHash = events.at(-1)?.eventHash ?? null;
    const content = {
      ...input,
      sequence: events.length + 1,
      previousEventHash,
    };
    const event = Object.freeze({ ...content, eventHash: sha256(content) });
    events.push(event);
    this.#events.set(input.runId, events);
    return event;
  }

  read(runId: string): readonly AgentRunEvent[] {
    return Object.freeze([...(this.#events.get(runId) ?? [])]);
  }
}

function assertSafeMetadata(
  metadata: Readonly<Record<string, SafeEventValue>>,
): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (key.trim().length === 0 || key.length > 100) {
      throw new Error("Agent event metadata keys must be short and non-blank");
    }
    if (typeof value === "string" && value.length > 500) {
      throw new Error(
        "Agent event metadata may not contain protected artifact content",
      );
    }
  }
}
