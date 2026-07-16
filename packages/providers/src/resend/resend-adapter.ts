import {
  DeterministicObservedProvider,
  type ObservedFakeMode,
  type ObservedProviderResult,
} from "../observed-provider.js";

export type NotificationRequest = Readonly<{
  idempotencyKey: string;
  recipient: string;
  templateVersion: string;
  variables: Readonly<Record<string, string>>;
}>;

export interface ResendAdapter {
  send(
    request: NotificationRequest,
  ): Promise<ObservedProviderResult<{ messageId: string }>>;
}

export class ResendTestAdapter implements ResendAdapter {
  readonly #provider: DeterministicObservedProvider<
    NotificationRequest,
    { messageId: string }
  >;

  constructor(mode: ObservedFakeMode = "accepted") {
    this.#provider = new DeterministicObservedProvider({
      mode,
      handler: (request) => ({
        messageId: `resend_test_${request.templateVersion}_${request.recipient}`,
      }),
    });
  }

  send(request: NotificationRequest) {
    return this.#provider.execute({
      operation: "notification.send",
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: fingerprint(request),
      payload: request,
    });
  }
}

function fingerprint(value: object): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}
