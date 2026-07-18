export const RATE_LIMIT_POLICIES = [
  "recipient_access",
  "recipient_demo_global",
  "privileged_action",
  "provider_callback",
  "booking_quote",
] as const;

export type RateLimitPolicy = (typeof RATE_LIMIT_POLICIES)[number];

export type RateLimitResult = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}>;

export type DurableRateLimitInput = Readonly<{
  policy: RateLimitPolicy;
  opaqueKey: string;
}>;

export interface DurableRateLimitStore {
  consume(input: DurableRateLimitInput): Promise<RateLimitResult>;
}

const policyLimits = Object.freeze({
  recipient_access: 30,
  recipient_demo_global: 300,
  privileged_action: 10,
  provider_callback: 120,
  booking_quote: 20,
}) satisfies Readonly<Record<RateLimitPolicy, number>>;

function isPolicy(value: string): value is RateLimitPolicy {
  return (RATE_LIMIT_POLICIES as readonly string[]).includes(value);
}

function isValidResult(
  result: RateLimitResult,
  policy: RateLimitPolicy,
): boolean {
  const limit = policyLimits[policy];
  if (
    typeof result.allowed !== "boolean" ||
    !Number.isSafeInteger(result.remaining) ||
    result.remaining < 0 ||
    result.remaining >= limit ||
    !Number.isSafeInteger(result.retryAfterSeconds) ||
    result.retryAfterSeconds < 0 ||
    result.retryAfterSeconds > 60
  ) {
    return false;
  }
  return result.allowed
    ? result.retryAfterSeconds === 0
    : result.remaining === 0 && result.retryAfterSeconds >= 1;
}

/**
 * A fail-closed application boundary over an atomic shared store. The caller
 * selects only a fixed policy and a one-way identity digest; limits, time and
 * window ownership remain in the database command.
 */
export class DurableRateLimiter {
  readonly #store: DurableRateLimitStore;

  constructor(store: DurableRateLimitStore) {
    this.#store = store;
  }

  async consume(input: DurableRateLimitInput): Promise<RateLimitResult> {
    if (!isPolicy(input.policy)) {
      throw new Error("Rate limiting requires a fixed policy");
    }
    if (!/^[a-f0-9]{64}$/u.test(input.opaqueKey)) {
      throw new Error(
        "Rate-limit keys must be one-way digests, not raw identity or IP data",
      );
    }

    const result = await this.#store.consume(input);
    if (!isValidResult(result, input.policy)) {
      throw new Error("Rate-limit store returned invalid durable state");
    }
    return Object.freeze({ ...result });
  }
}
