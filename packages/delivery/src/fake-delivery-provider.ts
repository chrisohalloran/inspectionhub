import type {
  DeliveryProviderPort,
  DeliveryProviderRequest,
  DeliveryProviderResult,
} from "./types.js";

export type FakeDeliveryMode =
  "accepted" | "sent" | "retryable_failure" | "terminal_failure" | "unknown";

export class FakeDeliveryProvider implements DeliveryProviderPort {
  readonly #observed = new Map<
    string,
    Readonly<{ fingerprint: string; result: DeliveryProviderResult }>
  >();
  readonly requests: DeliveryProviderRequest[] = [];

  constructor(private mode: FakeDeliveryMode = "sent") {}

  setMode(mode: FakeDeliveryMode): void {
    this.mode = mode;
  }

  async send(
    request: DeliveryProviderRequest,
  ): Promise<DeliveryProviderResult> {
    await Promise.resolve();
    const existing = this.#observed.get(request.idempotencyKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== request.requestFingerprint) {
        throw new Error(
          "Delivery provider idempotency key was reused with another fingerprint",
        );
      }
      return existing.result;
    }
    this.requests.push(request);
    const result = this.#result(request);
    this.#observed.set(request.idempotencyKey, {
      fingerprint: request.requestFingerprint,
      result,
    });
    return result;
  }

  #result(request: DeliveryProviderRequest): DeliveryProviderResult {
    if (this.mode === "accepted") {
      return {
        state: "accepted",
        providerReference: `accepted:${request.packageId}`,
      };
    }
    if (this.mode === "sent") {
      return { state: "sent", providerReference: `sent:${request.packageId}` };
    }
    if (this.mode === "unknown") {
      return {
        state: "unknown",
        reconciliationKey: `unknown:${request.packageId}`,
      };
    }
    return {
      state: "failed",
      code:
        this.mode === "retryable_failure"
          ? "provider_temporarily_unavailable"
          : "recipient_configuration_invalid",
      retryable: this.mode === "retryable_failure",
    };
  }
}
