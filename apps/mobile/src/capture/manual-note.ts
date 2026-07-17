import type { CaptureLedger } from "../storage/ports";
import {
  canonicalManualNoteContent,
  hashManualNoteContent,
} from "./manual-note-content";
import type { ManualNoteDigest } from "./types";

export async function recordManualFallback(input: {
  areaId: string;
  digest: ManualNoteDigest;
  idFactory: () => string;
  jobId: string;
  ledger: CaptureLedger;
  recordedAt: string;
  text: string;
}): Promise<{
  contentHash: string;
  noteId: string;
  state: "queued_locally";
}> {
  const noteId = input.idFactory();
  const content = canonicalManualNoteContent(input);
  const contentHash = await hashManualNoteContent(content, input.digest);
  await input.ledger.recordManualNote({
    ...content,
    contentHash,
    noteId,
  });
  return { contentHash, noteId, state: "queued_locally" };
}
