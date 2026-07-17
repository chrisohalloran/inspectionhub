import { canonicalJson } from "../integrity/canonical-json";
import type { ManualNote, ManualNoteContent, ManualNoteDigest } from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;

export function canonicalManualNoteContent(input: {
  areaId: string;
  jobId: string;
  recordedAt: string;
  text: string;
}): ManualNoteContent {
  const areaId = requiredCanonicalField(input.areaId, "area identity");
  const jobId = requiredCanonicalField(input.jobId, "job identity");
  const recordedAt = requiredCanonicalField(
    input.recordedAt,
    "recorded timestamp",
  );
  const text = input.text.replace(/\r\n?/gu, "\n").normalize("NFC").trim();
  if (text.length === 0) throw new Error("Manual note text is required");
  return {
    areaId,
    jobId,
    recordedAt,
    schemaVersion: "manual-note-v1",
    text,
  };
}

export function canonicalManualNotePayload(note: ManualNoteContent): string {
  if (note.schemaVersion !== "manual-note-v1") {
    throw new Error("Manual note schema version is unsupported");
  }
  return canonicalJson(canonicalManualNoteContent(note));
}

export async function hashManualNoteContent(
  note: ManualNoteContent,
  digest: ManualNoteDigest,
): Promise<string> {
  const contentHash = await digest(canonicalManualNotePayload(note));
  if (!SHA256.test(contentHash)) {
    throw new Error("Manual note digest must be a lowercase SHA-256 identity");
  }
  return contentHash;
}

export async function assertManualNoteIdentity(
  note: ManualNote,
  digest: ManualNoteDigest,
): Promise<ManualNote> {
  const content = canonicalManualNoteContent(note);
  const contentHash = await hashManualNoteContent(content, digest);
  if (note.contentHash !== contentHash) {
    throw new Error(
      "Manual note content hash does not match canonical content",
    );
  }
  const noteId = requiredCanonicalField(note.noteId, "note identity");
  return { ...content, contentHash, noteId };
}

function requiredCanonicalField(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`Manual note ${label} is invalid`);
  }
  return value;
}
