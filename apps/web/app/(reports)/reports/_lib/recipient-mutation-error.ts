export type RecipientMutationLimitReason =
  "grant_mutation_limit_reached" | "report_mutation_window_reached";

export class RecipientMutationLimitError extends Error {
  constructor(readonly reason: RecipientMutationLimitReason) {
    super(reason);
    this.name = "RecipientMutationLimitError";
  }
}

export function parseRecipientMutationLimitError(
  value: unknown,
): RecipientMutationLimitError | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.code !== "P0001") return null;
  return record.message === "grant_mutation_limit_reached" ||
    record.message === "report_mutation_window_reached"
    ? new RecipientMutationLimitError(record.message)
    : null;
}
