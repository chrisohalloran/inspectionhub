import { randomUUID } from "node:crypto";

import { deepFreeze } from "@inspection/domain";

import type {
  DeliveryAuditEvent,
  DeliveryOutboxRecord,
  DeliveryPackageRecord,
  DeliveryState,
} from "./types.js";

export class DeliveryConflictError extends Error {
  readonly code = "delivery_revision_conflict";

  constructor(message: string) {
    super(message);
    this.name = "DeliveryConflictError";
  }
}

export class InMemoryDeliveryRepository {
  #packages = new Map<string, DeliveryPackageRecord>();
  #outbox = new Map<string, DeliveryOutboxRecord>();
  #idempotency = new Map<
    string,
    Readonly<{ fingerprint: string; packageId: string }>
  >();
  #events: DeliveryAuditEvent[] = [];

  constructor(private readonly ids: () => string = randomUUID) {}

  transact<T>(work: (transaction: DeliveryTransaction) => T): T {
    const before = {
      packages: new Map(this.#packages),
      outbox: new Map(this.#outbox),
      idempotency: new Map(this.#idempotency),
      eventLength: this.#events.length,
    };
    try {
      return work(new DeliveryTransaction(this, this.ids));
    } catch (error) {
      this.#packages = before.packages;
      this.#outbox = before.outbox;
      this.#idempotency = before.idempotency;
      this.#events.splice(before.eventLength);
      throw error;
    }
  }

  getPackage(packageId: string): DeliveryPackageRecord | undefined {
    return this.#packages.get(packageId);
  }

  getOutboxForPackage(packageId: string): DeliveryOutboxRecord | undefined {
    return [...this.#outbox.values()].find(
      (outbox) => outbox.packageId === packageId,
    );
  }

  events(): readonly DeliveryAuditEvent[] {
    return deepFreeze([...this.#events]);
  }

  _getPackage(packageId: string): DeliveryPackageRecord | undefined {
    return this.#packages.get(packageId);
  }

  _setPackage(value: DeliveryPackageRecord): void {
    this.#packages.set(value.packageId, deepFreeze({ ...value }));
  }

  _getIdempotency(key: string) {
    return this.#idempotency.get(key);
  }

  _setIdempotency(
    key: string,
    value: Readonly<{ fingerprint: string; packageId: string }>,
  ): void {
    this.#idempotency.set(key, deepFreeze({ ...value }));
  }

  _setOutbox(value: DeliveryOutboxRecord): void {
    this.#outbox.set(value.outboxId, deepFreeze({ ...value }));
  }

  _getOutboxForPackage(packageId: string): DeliveryOutboxRecord | undefined {
    return this.getOutboxForPackage(packageId);
  }

  _appendEvent(event: Omit<DeliveryAuditEvent, "eventId">): void {
    this.#events.push(deepFreeze({ ...event, eventId: this.ids() }));
  }
}

export class DeliveryTransaction {
  constructor(
    private readonly repository: InMemoryDeliveryRepository,
    private readonly ids: () => string,
  ) {}

  getPackage(packageId: string): DeliveryPackageRecord | undefined {
    return this.repository._getPackage(packageId);
  }

  getIdempotentPackage(
    key: string,
    fingerprint: string,
  ): DeliveryPackageRecord | undefined {
    const prior = this.repository._getIdempotency(key);
    if (prior === undefined) return undefined;
    if (prior.fingerprint !== fingerprint) {
      throw new DeliveryConflictError(
        "Delivery idempotency key was reused with different package content",
      );
    }
    const value = this.repository._getPackage(prior.packageId);
    if (value === undefined) {
      throw new Error(
        "Delivery idempotency index references a missing package",
      );
    }
    return value;
  }

  writePackage(
    value: DeliveryPackageRecord,
    expectedRevision: number,
  ): DeliveryPackageRecord {
    const existing = this.repository._getPackage(value.packageId);
    const currentRevision = existing?.revision ?? 0;
    if (currentRevision !== expectedRevision) {
      throw new DeliveryConflictError(
        `Expected package revision ${expectedRevision}, current revision is ${currentRevision}`,
      );
    }
    if (value.revision !== expectedRevision + 1) {
      throw new DeliveryConflictError(
        "Delivery package must advance its revision exactly once",
      );
    }
    this.repository._setPackage(value);
    return value;
  }

  bindIdempotency(key: string, fingerprint: string, packageId: string): void {
    this.repository._setIdempotency(key, { fingerprint, packageId });
  }

  enqueueOutbox(
    input: Omit<DeliveryOutboxRecord, "outboxId">,
  ): DeliveryOutboxRecord {
    if (this.repository._getOutboxForPackage(input.packageId) !== undefined) {
      throw new DeliveryConflictError(
        "A package can have only one durable send outbox record",
      );
    }
    const created = deepFreeze({ ...input, outboxId: this.ids() });
    this.repository._setOutbox(created);
    return created;
  }

  updateOutbox(
    packageId: string,
    state: DeliveryOutboxRecord["state"],
    updatedAt: string,
  ): void {
    const outbox = this.repository._getOutboxForPackage(packageId);
    if (outbox === undefined) {
      throw new Error("Delivery package has no outbox record");
    }
    this.repository._setOutbox({ ...outbox, state, updatedAt });
  }

  transition(
    packageId: string,
    expectedState: DeliveryState | readonly DeliveryState[],
    next: DeliveryState,
    at: string,
    changes: Partial<
      Pick<
        DeliveryPackageRecord,
        | "providerReference"
        | "failureCode"
        | "interventionRequired"
        | "cancellationReason"
      >
    > = {},
  ): DeliveryPackageRecord {
    const current = this.repository._getPackage(packageId);
    if (current === undefined)
      throw new Error("Delivery package does not exist");
    const allowed = Array.isArray(expectedState)
      ? expectedState
      : [expectedState];
    if (!allowed.includes(current.state)) {
      throw new DeliveryConflictError(
        `Cannot transition delivery from ${current.state} to ${next}`,
      );
    }
    const updated = deepFreeze({
      ...current,
      ...changes,
      state: next,
      revision: current.revision + 1,
      updatedAt: at,
    });
    this.repository._setPackage(updated);
    return updated;
  }

  appendEvent(event: Omit<DeliveryAuditEvent, "eventId">): void {
    this.repository._appendEvent(event);
  }
}
