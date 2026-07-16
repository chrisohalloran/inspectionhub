import { sha256 } from "@inspection/domain";

import { BookingConflictError } from "./errors.js";

export type CommandMetadata = Readonly<{
  idempotencyKey: string;
  expectedRevision: number;
}>;

export type CommandReceipt = Readonly<{
  idempotencyKey: string;
  requestFingerprint: string;
}>;

export function inspectCommand(
  currentRevision: number,
  receipts: readonly CommandReceipt[],
  command: CommandMetadata,
  operation: string,
  payload: unknown,
): Readonly<{
  replayed: boolean;
  receipt: CommandReceipt;
}> {
  const receipt = {
    idempotencyKey: command.idempotencyKey,
    requestFingerprint: sha256({ operation, payload }),
  };
  const prior = receipts.find(
    (candidate) => candidate.idempotencyKey === command.idempotencyKey,
  );
  if (prior !== undefined) {
    if (prior.requestFingerprint !== receipt.requestFingerprint) {
      throw new BookingConflictError(
        "idempotency_key_reused",
        "An idempotency key cannot be reused with a different command payload",
      );
    }
    return { replayed: true, receipt };
  }
  if (command.expectedRevision !== currentRevision) {
    throw new BookingConflictError(
      "stale_revision",
      `Expected revision ${command.expectedRevision} but current revision is ${currentRevision}`,
      { expectedRevision: command.expectedRevision, currentRevision },
    );
  }
  return { replayed: false, receipt };
}
