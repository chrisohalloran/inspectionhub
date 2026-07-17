export type FieldActionFailure = Readonly<{
  message: string;
  recoveryBlocked: boolean;
}>;

export function describeFieldActionFailure(
  actionFailure: unknown,
  reloadFailure?: unknown,
): FieldActionFailure {
  const action = errorMessage(actionFailure, "Field action failed");
  if (reloadFailure !== undefined) {
    const reload = errorMessage(reloadFailure, "durable reload failed");
    return {
      message: `Field action not completed — ${action}. Recovery blocked — durable state could not be reloaded (${reload}). Restart the app before continuing professional work.`,
      recoveryBlocked: true,
    };
  }
  return {
    message: `Field action not completed — ${action}. Durable state reloaded; review and retry.`,
    recoveryBlocked: false,
  };
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error && value.message.trim().length > 0
    ? value.message
    : fallback;
}
