export type FakeProviderMode = "success" | "delay" | "replay" | "failure";

export interface ProviderRequest<TPayload> {
  idempotencyKey: string;
  payload: TPayload;
}

export type ProviderResult<TValue> =
  | {
      state: "accepted";
      providerReference: string;
      value: TValue;
      replayed: boolean;
    }
  | { state: "failed"; code: string; retryable: boolean };

export class DeterministicFakeProvider<TPayload, TValue> {
  readonly #handler: (payload: TPayload) => TValue;
  readonly #results = new Map<string, ProviderResult<TValue>>();
  #mode: FakeProviderMode;
  #delayMs: number;

  constructor(options: {
    mode?: FakeProviderMode;
    delayMs?: number;
    handler: (payload: TPayload) => TValue;
  }) {
    this.#mode = options.mode ?? "success";
    this.#delayMs = options.delayMs ?? 0;
    this.#handler = options.handler;
  }

  setMode(mode: FakeProviderMode, delayMs = this.#delayMs): void {
    this.#mode = mode;
    this.#delayMs = delayMs;
  }

  async execute(
    request: ProviderRequest<TPayload>,
  ): Promise<ProviderResult<TValue>> {
    const prior = this.#results.get(request.idempotencyKey);
    if (prior && this.#mode === "replay") {
      return prior.state === "accepted" ? { ...prior, replayed: true } : prior;
    }
    if (this.#mode === "delay" && this.#delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#delayMs));
    }
    if (this.#mode === "failure") {
      return {
        state: "failed",
        code: "fake_provider_failure",
        retryable: true,
      };
    }

    const result: ProviderResult<TValue> = {
      state: "accepted",
      providerReference: `fake_${request.idempotencyKey}`,
      value: this.#handler(request.payload),
      replayed: false,
    };
    this.#results.set(request.idempotencyKey, result);
    return result;
  }
}
