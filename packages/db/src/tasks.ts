import type { SqlExecutor } from "./types.js";

export interface AsyncTaskLease {
  id: string;
  organizationId: string;
  taskType: string;
  generation: number;
  leaseToken: string;
  leasedUntil: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = optionalString(row[key]);
  if (!value) throw new Error(`Database task row is missing ${key}.`);
  return value;
}

export async function leaseAsyncTask(
  sql: SqlExecutor,
  workerId: string,
  leaseDurationMs: number,
): Promise<AsyncTaskLease | null> {
  const seconds = leaseDurationMs / 1000;
  if (
    !workerId.trim() ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 900
  ) {
    throw new Error(
      "Task lease duration must be between 1 and 900 seconds with a named worker.",
    );
  }
  const rows = await sql.unsafe(
    "select * from public.lease_async_task($1, make_interval(secs => $2))",
    [workerId, seconds],
  );
  const row = rows[0];
  if (!row) return null;
  const generation = Number(row.lease_generation);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("Database task row has an invalid lease_generation.");
  }
  return {
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    taskType: requiredString(row, "task_type"),
    generation,
    leaseToken: requiredString(row, "lease_token"),
    leasedUntil: String(row.leased_until),
  };
}

export async function completeAsyncTask(
  sql: SqlExecutor,
  command: {
    taskId: string;
    generation: number;
    leaseToken: string;
    resultArtifactId?: string;
  },
): Promise<boolean> {
  const rows = await sql.unsafe(
    "select public.complete_async_task($1, $2, $3, $4) as completed",
    [
      command.taskId,
      command.generation,
      command.leaseToken,
      command.resultArtifactId ?? null,
    ],
  );
  return rows[0]?.completed === true;
}
