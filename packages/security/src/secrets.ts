export type EnvironmentName = "development" | "test" | "preview" | "production";

export type SecretKeyReference = {
  readonly keyId: string;
  readonly environment: EnvironmentName;
  readonly purpose: string;
  readonly status: "active" | "decrypt_only" | "retired" | "revoked";
  readonly activatedAt: string;
  readonly decryptOnlyStartedAt: string | null;
  readonly decryptOnlyUntil: string | null;
};

export type SecurityClock = () => string;

export const MAX_DECRYPT_ONLY_OVERLAP_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export class DualKeyRing {
  readonly #keys: readonly SecretKeyReference[];
  readonly #environment: EnvironmentName;
  readonly #purpose: string;
  readonly #constructedAt: number;
  readonly #clock: SecurityClock;

  constructor(input: {
    readonly keys: readonly SecretKeyReference[];
    readonly environment: EnvironmentName;
    readonly purpose: string;
    readonly clock: SecurityClock;
  }) {
    this.#keys = Object.freeze([...input.keys]);
    this.#environment = input.environment;
    this.#purpose = input.purpose;
    this.#clock = input.clock;
    this.#constructedAt = timestamp(this.#clock(), "key-ring time");
    for (const key of this.#keys) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u.test(key.keyId)) {
        throw new Error("Secret key identifiers must be opaque bounded codes");
      }
      const activatedAt = timestamp(key.activatedAt, "key activation");
      if (key.status === "active" && activatedAt > this.#constructedAt) {
        throw new Error("An active key cannot activate in the future");
      }
      if (key.status === "decrypt_only") {
        if (
          key.decryptOnlyStartedAt === null ||
          key.decryptOnlyUntil === null
        ) {
          throw new Error(
            "Decrypt-only keys require a transition time and bounded expiry",
          );
        }
        const startedAt = timestamp(
          key.decryptOnlyStartedAt,
          "decrypt-only transition",
        );
        const expiresAt = timestamp(
          key.decryptOnlyUntil,
          "decrypt-only expiry",
        );
        if (
          startedAt < activatedAt ||
          startedAt > this.#constructedAt ||
          expiresAt <= this.#constructedAt ||
          expiresAt <= startedAt ||
          expiresAt - startedAt > MAX_DECRYPT_ONLY_OVERLAP_MILLISECONDS
        ) {
          throw new Error(
            "Decrypt-only overlap must be current and no longer than thirty days",
          );
        }
      } else if (
        key.decryptOnlyStartedAt !== null ||
        key.decryptOnlyUntil !== null
      ) {
        throw new Error(
          "Only decrypt-only keys may declare a decrypt-only expiry",
        );
      }
    }
    const applicable = this.#keys.filter(
      (key) =>
        key.environment === input.environment && key.purpose === input.purpose,
    );
    if (applicable.filter((key) => key.status === "active").length !== 1) {
      throw new Error(
        "A key ring requires exactly one environment-bound active key",
      );
    }
    if (applicable.filter((key) => key.status === "decrypt_only").length > 1) {
      throw new Error(
        "A key ring supports at most one bounded decrypt-only rotation key",
      );
    }
  }

  encryptionKey(): SecretKeyReference {
    return this.#keys.find(
      (key) =>
        key.environment === this.#environment &&
        key.purpose === this.#purpose &&
        key.status === "active",
    )!;
  }

  canDecrypt(keyId: string): boolean {
    const at = timestamp(this.#clock(), "decryption time");
    if (at < this.#constructedAt) return false;
    return this.#keys.some(
      (key) =>
        key.keyId === keyId &&
        key.environment === this.#environment &&
        key.purpose === this.#purpose &&
        timestamp(key.activatedAt, "key activation") <= at &&
        (key.status === "active" ||
          (key.status === "decrypt_only" &&
            key.decryptOnlyUntil !== null &&
            key.decryptOnlyStartedAt !== null &&
            timestamp(key.decryptOnlyStartedAt, "decrypt-only transition") <=
              at &&
            timestamp(key.decryptOnlyUntil, "decrypt-only expiry") > at)),
    );
  }
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid date-time`);
  }
  return parsed;
}
