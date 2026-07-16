import {
  DeterministicObservedProvider,
  type ObservedFakeMode,
  type ObservedProviderResult,
} from "../observed-provider.js";

export type CheckoutRequest = Readonly<{
  amountCents: number;
  bookingId: string;
  currency: "AUD";
  idempotencyKey: string;
  returnUrl: string;
}>;

export type RefundRequest = Readonly<{
  bookingId: string;
  idempotencyKey: string;
  paymentReference: string;
}>;

export interface StripeAdapter {
  checkout(
    request: CheckoutRequest,
  ): Promise<ObservedProviderResult<{ checkoutUrl: string }>>;
  refund(
    request: RefundRequest,
  ): Promise<ObservedProviderResult<{ refundReference: string }>>;
}

export class StripeTestAdapter implements StripeAdapter {
  readonly #checkout: DeterministicObservedProvider<
    CheckoutRequest,
    { checkoutUrl: string }
  >;
  readonly #refund: DeterministicObservedProvider<
    RefundRequest,
    { refundReference: string }
  >;

  constructor(mode: ObservedFakeMode = "accepted") {
    this.#checkout = new DeterministicObservedProvider({
      mode,
      handler: (request) => ({
        checkoutUrl: `https://checkout.stripe.test/${request.bookingId}`,
      }),
    });
    this.#refund = new DeterministicObservedProvider({
      mode,
      handler: (request) => ({
        refundReference: `refund_test_${request.paymentReference}`,
      }),
    });
  }

  checkout(request: CheckoutRequest) {
    assertPositiveAmount(request.amountCents);
    return this.#checkout.execute({
      operation: "payment.checkout",
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: stableFingerprint(request),
      payload: request,
    });
  }

  refund(request: RefundRequest) {
    return this.#refund.execute({
      operation: "payment.refund",
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: stableFingerprint(request),
      payload: request,
    });
  }
}

function assertPositiveAmount(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(
      "Checkout amount must be a positive integer number of cents",
    );
  }
}

function stableFingerprint(value: object): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}
