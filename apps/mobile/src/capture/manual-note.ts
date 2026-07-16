import type { CaptureLedger } from "../storage/ports";

export async function recordManualFallback(input: {
  areaId: string;
  idFactory: () => string;
  jobId: string;
  ledger: CaptureLedger;
  recordedAt: string;
  text: string;
}): Promise<{ noteId: string; state: "queued_locally" }> {
  const noteId = input.idFactory();
  await input.ledger.recordManualNote({
    areaId: input.areaId,
    jobId: input.jobId,
    noteId,
    recordedAt: input.recordedAt,
    text: input.text,
  });
  return { noteId, state: "queued_locally" };
}
