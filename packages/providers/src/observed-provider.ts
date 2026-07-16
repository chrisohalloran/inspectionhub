export const providerOperations = [
  "payment.checkout",
  "payment.refund",
  "calendar.free_busy",
  "calendar.reserve",
  "calendar.cancel",
  "notification.send",
] as const;

export type ProviderOperation = (typeof providerOperations)[number];

export interface ObservedProviderRequest<TPayload> {
  readonly operation: ProviderOperation;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly payload: TPayload;
}

export type ObservedProviderResult<TValue> =
  | Readonly<{
      state: "accepted";
      providerReference: string;
      value: TValue;
      replayed: boolean;
    }>
  | Readonly<{
      state: "failed";
      code: string;
      retryable: boolean;
      replayed: boolean;
    }>
  | Readonly<{
      state: "unknown";
      reconciliationKey: string;
      replayed: boolean;
    }>;

export interface ObservedProviderPort<TPayload, TValue> {
  execute(
    request: ObservedProviderRequest<TPayload>,
  ): Promise<ObservedProviderResult<TValue>>;
}

export type ObservedFakeMode =
  "accepted" | "retryable_failure" | "terminal_failure" | "unknown";

type StoredObservation<TValue> = Readonly<{
  requestFingerprint: string;
  result: ObservedProviderResult<TValue>;
}>;

export class DeterministicObservedProvider<
  TPayload,
  TValue,
> implements ObservedProviderPort<TPayload, TValue> {
  readonly #handler: (payload: TPayload) => TValue;
  readonly #observations = new Map<string, StoredObservation<TValue>>();
  #mode: ObservedFakeMode;

  constructor(options: {
    mode?: ObservedFakeMode;
    handler: (payload: TPayload) => TValue;
  }) {
    this.#mode = options.mode ?? "accepted";
    this.#handler = options.handler;
  }

  setMode(mode: ObservedFakeMode): void {
    this.#mode = mode;
  }

  async execute(
    request: ObservedProviderRequest<TPayload>,
  ): Promise<ObservedProviderResult<TValue>> {
    // Preserve the asynchronous provider boundary in deterministic tests.
    await Promise.resolve();
    const prior = this.#observations.get(request.idempotencyKey);
    if (prior !== undefined) {
      if (prior.requestFingerprint !== request.requestFingerprint) {
        throw new Error(
          "A provider idempotency key cannot be reused with another request fingerprint",
        );
      }
      return withReplay(prior.result);
    }
    const result = this.#createObservation(request);
    this.#observations.set(request.idempotencyKey, {
      requestFingerprint: request.requestFingerprint,
      result,
    });
    return result;
  }

  reconcile(
    idempotencyKey: string,
    result: ObservedProviderResult<TValue>,
  ): void {
    const existing = this.#observations.get(idempotencyKey);
    if (existing === undefined) {
      throw new Error("Cannot reconcile an unknown provider idempotency key");
    }
    if (existing.result.state !== "unknown") {
      throw new Error("Only an unknown provider observation can be reconciled");
    }
    this.#observations.set(idempotencyKey, {
      requestFingerprint: existing.requestFingerprint,
      result: { ...result, replayed: false },
    });
  }

  #createObservation(
    request: ObservedProviderRequest<TPayload>,
  ): ObservedProviderResult<TValue> {
    if (this.#mode === "unknown") {
      return {
        state: "unknown",
        reconciliationKey: `reconcile_${request.idempotencyKey}`,
        replayed: false,
      };
    }
    if (this.#mode === "retryable_failure") {
      return {
        state: "failed",
        code: "fake_provider_retryable_failure",
        retryable: true,
        replayed: false,
      };
    }
    if (this.#mode === "terminal_failure") {
      return {
        state: "failed",
        code: "fake_provider_terminal_failure",
        retryable: false,
        replayed: false,
      };
    }
    return {
      state: "accepted",
      providerReference: `fake_${request.operation}_${request.idempotencyKey}`,
      value: this.#handler(request.payload),
      replayed: false,
    };
  }
}

function withReplay<TValue>(
  result: ObservedProviderResult<TValue>,
): ObservedProviderResult<TValue> {
  return { ...result, replayed: true };
}
