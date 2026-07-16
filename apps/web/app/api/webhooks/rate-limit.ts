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
  fetcher?: RateLimitFetch;
}>;

class SupabaseRateLimitStore implements DurableRateLimitStore {
  readonly #endpoint: string;
  readonly #serviceRoleKey: string;
  readonly #fetcher: RateLimitFetch;

  constructor(input: SupabaseRateLimitOptions) {
    if (!/^https?:\/\//u.test(input.supabaseUrl)) {
      throw new Error("Durable rate-limit service URL is invalid");
    }
    if (input.serviceRoleKey.length < 16) {
      throw new Error("Durable rate-limit service credential is invalid");
    }
    this.#endpoint = `${input.supabaseUrl.replace(/\/+$/u, "")}/rest/v1/rpc/command_consume_rate_limit`;
    this.#serviceRoleKey = input.serviceRoleKey;
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
  });
  return configuredBoundary(policy, boundaryKey);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`Missing required rate-limit environment: ${name}`);
  return value;
}
