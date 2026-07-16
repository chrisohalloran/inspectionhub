import postgres from "postgres";

import type {
  DatabaseClient,
  SqlExecutor,
  SqlRow,
  SqlValue,
  TransactionClient,
} from "./types.js";

function wrapExecutor(client: {
  unsafe: (query: string, parameters?: never[]) => Promise<unknown>;
}): SqlExecutor {
  return {
    async unsafe(
      query: string,
      parameters: readonly SqlValue[] = [],
    ): Promise<readonly SqlRow[]> {
      const rows = await client.unsafe(query, [...parameters] as never[]);
      return rows as readonly SqlRow[];
    },
  };
}

export function createDatabaseClient(
  connectionString: string,
  options: { maxConnections?: number; applicationName?: string } = {},
): DatabaseClient {
  if (!connectionString.startsWith("postgres")) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  const client = postgres(connectionString, {
    max: options.maxConnections ?? 10,
    prepare: false,
    connection: {
      application_name: options.applicationName ?? "inspection-platform",
    },
  });
  const executor = wrapExecutor(client);
  return {
    ...executor,
    async begin<TResult>(
      work: (transaction: TransactionClient) => Promise<TResult>,
    ) {
      const result = await client.begin(async (transaction) =>
        work(wrapExecutor(transaction)),
      );
      return result as TResult;
    },
    async end() {
      await client.end({ timeout: 5 });
    },
  };
}
