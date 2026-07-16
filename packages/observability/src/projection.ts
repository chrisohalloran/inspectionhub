import type {
  OperationalCategory,
  OperationalState,
  SafeOperationalEvent,
} from "./events.js";

export type OperationsSummary = {
  readonly counts: Readonly<
    Record<
      OperationalCategory,
      Readonly<Partial<Record<OperationalState, number>>>
    >
  >;
  readonly stuck: readonly {
    readonly category: OperationalCategory;
    readonly aggregateIdHash: string;
    readonly state: OperationalState;
    readonly lastObservedAt: string;
  }[];
  readonly unknownOutcomeCount: number;
  readonly deadLetterCount: number;
  readonly egressBlocked: boolean;
};

const CATEGORIES: readonly OperationalCategory[] = [
  "agent",
  "task",
  "provider",
  "delivery",
  "access",
  "device",
  "lifecycle",
  "restore",
];

export class OperationsProjection {
  readonly #latest = new Map<string, SafeOperationalEvent>();

  ingest(event: SafeOperationalEvent): void {
    const key = JSON.stringify([
      event.organizationHash,
      event.category,
      event.aggregateIdHash,
    ]);
    const prior = this.#latest.get(key);
    if (
      prior !== undefined &&
      Date.parse(event.occurredAt) < Date.parse(prior.occurredAt)
    ) {
      throw new Error(
        "Operations projection rejects out-of-order state regression",
      );
    }
    this.#latest.set(key, event);
  }

  summary(input: {
    readonly now: string;
    readonly stuckAfterMilliseconds: number;
  }): OperationsSummary {
    const now = Date.parse(input.now);
    const counts = Object.fromEntries(
      CATEGORIES.map((category) => [category, {}]),
    ) as Record<OperationalCategory, Partial<Record<OperationalState, number>>>;
    const stuck: OperationsSummary["stuck"][number][] = [];
    let unknownOutcomeCount = 0;
    let deadLetterCount = 0;
    let egressBlocked = false;
    for (const event of this.#latest.values()) {
      counts[event.category][event.state] =
        (counts[event.category][event.state] ?? 0) + 1;
      if (event.state === "unknown") unknownOutcomeCount += 1;
      if (event.state === "failed") deadLetterCount += 1;
      if (event.category === "restore" && event.state === "blocked") {
        egressBlocked = true;
      }
      if (
        ["queued", "running", "retry_wait", "unknown"].includes(event.state) &&
        now - Date.parse(event.occurredAt) > input.stuckAfterMilliseconds
      ) {
        stuck.push({
          category: event.category,
          aggregateIdHash: event.aggregateIdHash,
          state: event.state,
          lastObservedAt: event.occurredAt,
        });
      }
    }
    return Object.freeze({
      counts: Object.freeze(counts),
      stuck: Object.freeze(
        stuck.sort((left, right) =>
          left.lastObservedAt.localeCompare(right.lastObservedAt),
        ),
      ),
      unknownOutcomeCount,
      deadLetterCount,
      egressBlocked,
    });
  }
}
