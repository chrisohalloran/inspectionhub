import { describe, expect, it, vi } from "vitest";

import { withActorContext } from "./context.js";
import { completeAsyncTask, leaseAsyncTask } from "./tasks.js";
import type { SqlExecutor, TransactionClient } from "./types.js";

function executor() {
  const unsafe = vi.fn<SqlExecutor["unsafe"]>(() => Promise.resolve([]));
  return {
    unsafe,
  } satisfies SqlExecutor;
}

describe("database actor context", () => {
  it("sets tenant and actor claims inside the same transaction as the work", async () => {
    const transaction = executor();
    const begin = vi.fn();
    const client = {
      async begin<TResult>(
        work: (client: TransactionClient) => Promise<TResult>,
      ) {
        begin();
        return work(transaction);
      },
    };

    await expect(
      withActorContext(
        client,
        {
          organizationId: "11111111-1111-4111-8111-111111111111",
          actorId: "22222222-2222-4222-8222-222222222222",
          actorRole: "inspector",
          authSubject: "33333333-3333-4333-8333-333333333333",
          assuranceLevel: "aal2",
        },
        () => Promise.resolve("worked"),
      ),
    ).resolves.toBe("worked");
    expect(begin).toHaveBeenCalledOnce();
    expect(transaction.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config"),
      expect.arrayContaining([
        "11111111-1111-4111-8111-111111111111",
        "inspector",
        "aal2",
      ]),
    );
  });

  it("rejects a blank or non-UUID context before opening a transaction", async () => {
    const begin = vi.fn();
    const client = {
      async begin<TResult>(
        work: (client: TransactionClient) => Promise<TResult>,
      ) {
        begin();
        return work(executor());
      },
    };
    await expect(
      withActorContext(
        client,
        {
          organizationId: "not-a-uuid",
          actorId: "",
          actorRole: "inspector",
          authSubject: "33333333-3333-4333-8333-333333333333",
          assuranceLevel: "aal1",
        },
        () => Promise.resolve(undefined),
      ),
    ).rejects.toThrow("Invalid database actor context");
    expect(begin).not.toHaveBeenCalled();
  });

  it("rejects roles that are not valid organization membership roles", async () => {
    const begin = vi.fn();
    const client = {
      async begin<TResult>(
        work: (client: TransactionClient) => Promise<TResult>,
      ) {
        begin();
        return work(executor());
      },
    };
    await expect(
      withActorContext(
        client,
        {
          organizationId: "11111111-1111-4111-8111-111111111111",
          actorId: "22222222-2222-4222-8222-222222222222",
          // This cast exercises runtime validation at an untrusted boundary.
          actorRole: "owner" as never,
          authSubject: "33333333-3333-4333-8333-333333333333",
          assuranceLevel: "aal2",
        },
        () => Promise.resolve(undefined),
      ),
    ).rejects.toThrow("Invalid database actor context");
    expect(begin).not.toHaveBeenCalled();
  });
});

describe("fenced task commands", () => {
  it("leases through the database function with a bounded duration", async () => {
    const sql = executor();
    sql.unsafe.mockResolvedValueOnce([
      {
        id: "task-1",
        organization_id: "org-1",
        task_type: "render_pdf",
        lease_generation: 3,
        lease_token: "lease-1",
        leased_until: "2026-07-14T06:00:00Z",
      },
    ]);

    await expect(
      leaseAsyncTask(sql, "worker-a", 120_000),
    ).resolves.toMatchObject({ id: "task-1" });
    expect(sql.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("lease_async_task"),
      ["worker-a", 120],
    );
    await expect(leaseAsyncTask(sql, "worker-a", 0)).rejects.toThrow(
      "between 1 and 900 seconds",
    );
  });

  it("requires the exact generation and lease token to complete", async () => {
    const sql = executor();
    sql.unsafe.mockResolvedValueOnce([{ completed: false }]);

    await expect(
      completeAsyncTask(sql, {
        taskId: "11111111-1111-4111-8111-111111111111",
        generation: 7,
        leaseToken: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toBe(false);
    expect(sql.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("complete_async_task"),
      [
        "11111111-1111-4111-8111-111111111111",
        7,
        "22222222-2222-4222-8222-222222222222",
        null,
      ],
    );
  });
});
