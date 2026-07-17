import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { expoInspectionDigest } from "../investigations/expo-inspection-digest";
import { createLocalInspectionRepository } from "../investigations/local-inspection-repository";
import { SqliteInspectionSnapshotPort } from "../investigations/sqlite-inspection-snapshot-port";
import {
  createSQLiteCaptureLedger,
  type SQLiteCaptureConnection,
  type SQLiteValue,
} from "./sqlite-capture-ledger";

function adaptDatabase(database: SQLiteDatabase): SQLiteCaptureConnection {
  return {
    execAsync: (source) => database.execAsync(source),
    getAllAsync: <T>(source: string, ...params: readonly SQLiteValue[]) =>
      database.getAllAsync<T>(source, ...params),
    getFirstAsync: <T>(source: string, ...params: readonly SQLiteValue[]) =>
      database.getFirstAsync<T>(source, ...params),
    runAsync: (source, ...params) => database.runAsync(source, ...params),
    withExclusiveTransactionAsync: (task) =>
      database.withExclusiveTransactionAsync((transaction) =>
        task(adaptDatabase(transaction)),
      ),
  };
}

export async function openCaptureLedger() {
  return (await openFieldPersistence()).captureLedger;
}

export async function openFieldPersistence() {
  const database = await openDatabaseAsync("inspection-field-v1.db");
  const captureLedger = await createSQLiteCaptureLedger(
    adaptDatabase(database),
    (payload) => expoInspectionDigest.sha256(payload),
  );
  const inspectionStorage = new SqliteInspectionSnapshotPort(database);
  await inspectionStorage.initialise();
  return {
    captureLedger,
    inspectionRepository: createLocalInspectionRepository({
      digest: expoInspectionDigest,
      storage: inspectionStorage,
    }),
  };
}
