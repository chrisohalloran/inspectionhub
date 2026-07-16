import {
  CommandEnvelopeSchema,
  type CommandEnvelope,
} from "@inspection/contracts";

import { deepFreeze, sha256 } from "./canonical.js";
import { DomainConflictError } from "./errors.js";

export type IdempotencyRecord = Readonly<{
  organizationId: string;
  aggregateId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  commandId: string;
}>;

export type IdempotencyLedger = Readonly<{
  records: readonly IdempotencyRecord[];
}>;

export type IdempotencyDecision = Readonly<{
  outcome: "accepted" | "replay";
  ledger: IdempotencyLedger;
  requestFingerprint: string;
}>;

export function createIdempotencyLedger(): IdempotencyLedger {
  return deepFreeze({ records: [] });
}

export function registerVersionedCommand(
  ledger: IdempotencyLedger,
  input: CommandEnvelope,
): IdempotencyDecision {
  const command = CommandEnvelopeSchema.parse(input);
  const requestFingerprint = fingerprintCommand(command);
  const existing = ledger.records.find(
    (record) =>
      record.organizationId === command.organizationId &&
      record.aggregateId === command.aggregateId &&
      record.idempotencyKey === command.idempotencyKey,
  );
  if (existing !== undefined) {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new DomainConflictError(
        "idempotency_key_reused",
        "An idempotency key cannot be reused with a different request fingerprint",
      );
    }
    return deepFreeze({ outcome: "replay", ledger, requestFingerprint });
  }
  const nextLedger = deepFreeze({
    records: [
      ...ledger.records,
      {
        organizationId: command.organizationId,
        aggregateId: command.aggregateId,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint,
        commandId: command.commandId,
      },
    ],
  });
  return deepFreeze({
    outcome: "accepted",
    ledger: nextLedger,
    requestFingerprint,
  });
}

function fingerprintCommand(command: CommandEnvelope): string {
  return sha256({
    schemaVersion: command.schemaVersion,
    type: command.type,
    organizationId: command.organizationId,
    aggregateId: command.aggregateId,
    actor: command.actor,
    expectedRevision: command.expectedRevision,
    payload: command.payload,
  });
}
