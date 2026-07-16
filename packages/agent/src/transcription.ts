import type OpenAI from "openai";
import type { Uploadable } from "openai";

export type TranscriptionTokenConfidence = {
  readonly token: string;
  readonly logProbability: number | null;
};

export type VoiceNoteTranscription = {
  readonly model: "gpt-4o-transcribe";
  readonly language: "en";
  readonly text: string;
  readonly tokenConfidence: readonly TranscriptionTokenConfidence[];
  readonly timestampProvenance: "whole_note_only";
};

export function transcriptionRequestPolicy(): Readonly<{
  model: "gpt-4o-transcribe";
  language: "en";
  response_format: "json";
  include: readonly ["logprobs"];
  prompt: string;
}> {
  const policy = {
    model: "gpt-4o-transcribe",
    language: "en",
    response_format: "json",
    include: ["logprobs"] as const,
    prompt:
      "Australian English building and timber pest inspection field note. Preserve measurements, locations, uncertainty words, trade terminology and incomplete phrases exactly.",
  } as const;
  return Object.freeze(policy);
}

export class OpenAIVoiceNoteTranscriber {
  readonly #client: OpenAI;

  constructor(client: OpenAI) {
    this.#client = client;
  }

  async transcribe(input: {
    readonly file: Uploadable;
    readonly signal?: AbortSignal;
  }): Promise<VoiceNoteTranscription> {
    const policy = transcriptionRequestPolicy();
    const response = await this.#client.audio.transcriptions.create(
      { ...policy, include: [...policy.include], file: input.file },
      { signal: input.signal },
    );
    return Object.freeze({
      model: policy.model,
      language: policy.language,
      text: response.text,
      tokenConfidence: Object.freeze(
        (response.logprobs ?? []).map((item) => ({
          token: item.token ?? "",
          logProbability: item.logprob ?? null,
        })),
      ),
      timestampProvenance: "whole_note_only",
    });
  }
}
