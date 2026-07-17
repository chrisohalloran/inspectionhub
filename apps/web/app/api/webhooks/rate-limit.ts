import { createHmac } from "node:crypto";

import {
  DurableRateLimiter,
  type DurableRateLimitStore,
  type RateLimitPolicy,
  type RateLimitResult,
} from "@inspection/security";

export type BoundaryRateLimit = (
  policy: RateLimitPolicy,
  boundaryKey: string,
) => Promise<RateLimitResult>;

type RateLimitFetchResponse = Readonly<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

type RateLimitFetch = (
  input: string,
  init: RequestInit,
) => Promise<RateLimitFetchResponse>;

type SupabaseRateLimitOptions = Readonly<{
  supabaseUrl: string;
  serviceRoleKey: string;
  hashSecret: string;
  timeoutMilliseconds?: number;
  fetcher?: RateLimitFetch;
}>;

class SupabaseRateLimitStore implements DurableRateLimitStore {
  readonly #endpoint: string;
  readonly #serviceRoleKey: string;
  readonly #timeoutMilliseconds: number;
  readonly #fetcher: RateLimitFetch;

  constructor(input: SupabaseRateLimitOptions) {
    if (!/^https?:\/\//u.test(input.supabaseUrl)) {
      throw new Error("Durable rate-limit service URL is invalid");
    }
    if (input.serviceRoleKey.length < 16) {
      throw new Error("Durable rate-limit service credential is invalid");
    }
    const timeoutMilliseconds = input.timeoutMilliseconds ?? 2_000;
    if (
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds < 1 ||
      timeoutMilliseconds > 10_000
    ) {
      throw new Error(
        "Durable rate-limit HTTP timeout must be between 1 and 10000 milliseconds",
      );
    }
    this.#endpoint = `${input.supabaseUrl.replace(/\/+$/u, "")}/rest/v1/rpc/command_consume_rate_limit`;
    this.#serviceRoleKey = input.serviceRoleKey;
    this.#timeoutMilliseconds = timeoutMilliseconds;
    this.#fetcher = input.fetcher ?? fetch;
  }

  async consume(input: {
    readonly policy: RateLimitPolicy;
    readonly opaqueKey: string;
  }): Promise<RateLimitResult> {
    const response = await this.#fetcher(this.#endpoint, {
      body: JSON.stringify({
        target_opaque_key_sha256: input.opaqueKey,
        target_policy_name: input.policy,
      }),
      cache: "no-store",
      headers: {
        apikey: this.#serviceRoleKey,
        authorization: `Bearer ${this.#serviceRoleKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(this.#timeoutMilliseconds),
    });
    if (!response.ok) {
      throw new Error("Durable rate-limit service is unavailable");
    }
    const payload: unknown = await response.json();
    const row: unknown = Array.isArray(payload) ? payload[0] : null;
    if (typeof row !== "object" || row === null) {
      throw new Error("Durable rate-limit service returned invalid state");
    }
    const record = row as Record<string, unknown>;
    if (
      typeof record.allowed !== "boolean" ||
      typeof record.remaining !== "number" ||
      typeof record.retry_after_seconds !== "number"
    ) {
      throw new Error("Durable rate-limit service returned invalid state");
    }
    return {
      allowed: record.allowed,
      remaining: record.remaining,
      retryAfterSeconds: record.retry_after_seconds,
    };
  }
}

export function createSupabaseBoundaryRateLimit(
  input: SupabaseRateLimitOptions,
): BoundaryRateLimit {
  if (input.hashSecret.length < 32) {
    throw new Error(
      "RATE_LIMIT_HASH_SECRET must contain at least 32 characters",
    );
  }
  const limiter = new DurableRateLimiter(new SupabaseRateLimitStore(input));
  return (policy, boundaryKey) => {
    if (!/^[a-z][a-z0-9_-]{2,80}$/u.test(boundaryKey)) {
      return Promise.reject(new Error("Rate-limit boundary key is invalid"));
    }
    const opaqueKey = createHmac("sha256", input.hashSecret)
      .update(`${policy}:${boundaryKey}`, "utf8")
      .digest("hex");
    return limiter.consume({ policy, opaqueKey });
  };
}

let configuredBoundary: BoundaryRateLimit | undefined;

export function consumeBoundaryRateLimit(
  policy: RateLimitPolicy,
  boundaryKey: string,
): Promise<RateLimitResult> {
  configuredBoundary ??= createSupabaseBoundaryRateLimit({
    supabaseUrl:
      process.env.SUPABASE_API_URL?.trim() ||
      requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    hashSecret: requiredEnvironment("RATE_LIMIT_HASH_SECRET"),
    timeoutMilliseconds: optionalTimeoutEnvironment(
      "RATE_LIMIT_HTTP_TIMEOUT_MS",
      2_000,
    ),
  });
  return configuredBoundary(policy, boundaryKey);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`Missing required rate-limit environment: ${name}`);
  return value;
}

function optionalTimeoutEnvironment(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new Error(`${name} must be an integer from 1 to 10000`);
  }
  return parsed;
}
