import type { FieldSessionSnapshot } from "../capture/types";
import { cloneFieldSession } from "./field-workflow";

export type FieldSessionMutation = (
  current: FieldSessionSnapshot,
) => FieldSessionSnapshot;

/** Serialises the read-modify-write boundary, not stale full snapshots. */
export class SerializedFieldSessionWriter {
  #current: FieldSessionSnapshot;
  #tail: Promise<void> = Promise.resolve();
  readonly #onCommitted: (snapshot: FieldSessionSnapshot) => void;
  readonly #persist: (snapshot: FieldSessionSnapshot) => Promise<void>;

  constructor(input: {
    readonly initial: FieldSessionSnapshot;
    readonly persist: (snapshot: FieldSessionSnapshot) => Promise<void>;
    readonly onCommitted: (snapshot: FieldSessionSnapshot) => void;
  }) {
    this.#current = cloneFieldSession(input.initial);
    this.#persist = input.persist;
    this.#onCommitted = input.onCommitted;
  }

  update(mutate: FieldSessionMutation): Promise<FieldSessionSnapshot> {
    const write = this.#tail.then(async () => {
      const current = cloneFieldSession(this.#current);
      const next = cloneFieldSession(mutate(current));
      if (next.nextSequence < current.nextSequence) {
        throw new Error("Field capture sequence cannot move backwards");
      }
      await this.#persist(next);
      this.#current = cloneFieldSession(next);
      const committed = cloneFieldSession(next);
      this.#onCommitted(committed);
      return committed;
    });
    this.#tail = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }
}
