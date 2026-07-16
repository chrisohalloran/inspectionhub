export type SqlValue =
  string | number | boolean | null | Date | readonly string[];
export type SqlRow = Record<string, unknown>;

export interface SqlExecutor {
  unsafe(
    query: string,
    parameters?: readonly SqlValue[],
  ): Promise<readonly SqlRow[]>;
}

export type TransactionClient = SqlExecutor;

export interface DatabaseClient extends SqlExecutor {
  begin<TResult>(
    work: (transaction: TransactionClient) => Promise<TResult>,
  ): Promise<TResult>;
  end(): Promise<void>;
}
