import type { DraftVerification, InspectionDraft } from "./schemas.js";

export type ProvisionalDraftRecord = {
  readonly runId: string;
  readonly attempt: number;
  readonly organizationId: string;
  readonly jobId: string;
  readonly packetId: string;
  readonly packetHash: string;
  readonly draftHash: string;
  readonly draft: InspectionDraft;
  readonly deterministicChecked: boolean;
  readonly verification: DraftVerification | null;
  readonly status: "provisional" | "verified" | "rejected" | "stale";
};

export type AgentRunIdentity = Readonly<{
  runId: string;
  organizationId: string;
  jobId: string;
  packetId: string;
  packetHash: string;
}>;

export interface CurrentPacketRepository {
  isCurrent(input: {
    readonly organizationId: string;
    readonly packetId: string;
    readonly packetHash: string;
  }): boolean | Promise<boolean>;
}

export interface ProvisionalDraftRepository {
  bindAndGet(
    identity: AgentRunIdentity,
  ): ProvisionalDraftRecord | null | Promise<ProvisionalDraftRecord | null>;
  insertIfCurrent(input: {
    readonly record: ProvisionalDraftRecord;
    readonly packetRepository: CurrentPacketRepository;
  }): ProvisionalDraftRecord | Promise<ProvisionalDraftRecord>;
  updateIfCurrent(input: {
    readonly runId: string;
    readonly expectedDraftHash: string;
    readonly packetRepository: CurrentPacketRepository;
    readonly update: (record: ProvisionalDraftRecord) => ProvisionalDraftRecord;
  }): ProvisionalDraftRecord | Promise<ProvisionalDraftRecord>;
  markStale(input: {
    readonly runId: string;
    readonly expectedDraftHash: string;
  }): ProvisionalDraftRecord | Promise<ProvisionalDraftRecord>;
}

export class InMemoryCurrentPacketRepository implements CurrentPacketRepository {
  readonly #current = new Map<string, string>();

  setCurrent(
    organizationId: string,
    packetId: string,
    packetHash: string,
  ): void {
    this.#current.set(JSON.stringify([organizationId, packetId]), packetHash);
  }

  isCurrent(input: {
    readonly organizationId: string;
    readonly packetId: string;
    readonly packetHash: string;
  }): boolean {
    return (
      this.#current.get(
        JSON.stringify([input.organizationId, input.packetId]),
      ) === input.packetHash
    );
  }
}

export class InMemoryProvisionalDraftRepository implements ProvisionalDraftRepository {
  readonly #records = new Map<string, ProvisionalDraftRecord>();
  readonly #identities = new Map<string, AgentRunIdentity>();

  bindAndGet(identity: AgentRunIdentity): ProvisionalDraftRecord | null {
    this.#bindIdentity(identity);
    const record = this.#records.get(identity.runId) ?? null;
    if (record !== null) assertRunIdentity(record, identity);
    return record;
  }

  async insertIfCurrent(input: {
    readonly record: ProvisionalDraftRecord;
    readonly packetRepository: CurrentPacketRepository;
  }): Promise<ProvisionalDraftRecord> {
    this.#bindIdentity(input.record);
    if (this.#records.has(input.record.runId)) {
      throw new Error(
        "A model attempt cannot overwrite an existing provisional draft",
      );
    }
    await assertPacketCurrent(input.record, input.packetRepository);
    const record = Object.freeze({ ...input.record });
    this.#records.set(record.runId, record);
    return record;
  }

  async updateIfCurrent(input: {
    readonly runId: string;
    readonly expectedDraftHash: string;
    readonly packetRepository: CurrentPacketRepository;
    readonly update: (record: ProvisionalDraftRecord) => ProvisionalDraftRecord;
  }): Promise<ProvisionalDraftRecord> {
    const current = this.#records.get(input.runId);
    if (
      current === undefined ||
      current.draftHash !== input.expectedDraftHash
    ) {
      throw new Error(
        "Draft compare-and-set rejected a missing or changed version",
      );
    }
    await assertPacketCurrent(current, input.packetRepository);
    const next = Object.freeze(input.update(current));
    if (
      next.runId !== current.runId ||
      next.draftHash !== current.draftHash ||
      !sameRunIdentity(next, current)
    ) {
      throw new Error(
        "A checkpoint update cannot change immutable draft identity",
      );
    }
    this.#records.set(input.runId, next);
    return next;
  }

  #bindIdentity(identity: AgentRunIdentity): void {
    const current = this.#identities.get(identity.runId);
    if (current !== undefined) {
      assertRunIdentity(current, identity);
      return;
    }
    this.#identities.set(identity.runId, Object.freeze({ ...identity }));
  }

  markStale(input: {
    readonly runId: string;
    readonly expectedDraftHash: string;
  }): ProvisionalDraftRecord {
    const current = this.#records.get(input.runId);
    if (
      current === undefined ||
      current.draftHash !== input.expectedDraftHash
    ) {
      throw new Error(
        "Stale marker compare-and-set rejected a missing or changed draft",
      );
    }
    const next = Object.freeze({ ...current, status: "stale" as const });
    this.#records.set(input.runId, next);
    return next;
  }
}

function sameRunIdentity(
  left: AgentRunIdentity,
  right: AgentRunIdentity,
): boolean {
  return (
    left.runId === right.runId &&
    left.organizationId === right.organizationId &&
    left.jobId === right.jobId &&
    left.packetId === right.packetId &&
    left.packetHash === right.packetHash
  );
}

function assertRunIdentity(
  expected: AgentRunIdentity,
  actual: AgentRunIdentity,
): void {
  if (!sameRunIdentity(expected, actual)) {
    throw new RunIdentityConflictError();
  }
}

export class RunIdentityConflictError extends Error {
  constructor() {
    super("Agent run identifier is already bound to another packet context");
    this.name = "RunIdentityConflictError";
  }
}

async function assertPacketCurrent(
  record: Pick<
    ProvisionalDraftRecord,
    "organizationId" | "packetId" | "packetHash"
  >,
  repository: CurrentPacketRepository,
): Promise<void> {
  if (!(await repository.isCurrent(record))) {
    throw new StalePacketError();
  }
}

export class StalePacketError extends Error {
  constructor() {
    super("Frozen packet is no longer current; model output was rejected");
    this.name = "StalePacketError";
  }
}
