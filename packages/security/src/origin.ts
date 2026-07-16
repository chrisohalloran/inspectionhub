export function requireTrustedMutationOrigin(input: {
  readonly origin: string | null;
  readonly configuredOrigins: readonly string[];
}): string {
  if (input.origin === null) {
    throw new Error(
      "State-changing cookie-authenticated requests require an Origin header",
    );
  }
  const origin = new URL(input.origin).origin;
  const allowed = new Set(
    input.configuredOrigins.map((configured) => new URL(configured).origin),
  );
  if (!allowed.has(origin)) {
    throw new Error("Request origin is not allowlisted");
  }
  return origin;
}
