export type SecurityHeader = {
  readonly key: string;
  readonly value: string;
};

export function buildSecurityHeaders(input: {
  readonly production: boolean;
  readonly connectOrigins?: readonly string[];
}): readonly SecurityHeader[] {
  const connectOrigins = (input.connectOrigins ?? []).map((origin) =>
    validateConnectOrigin(origin, input.production),
  );
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self'${connectOrigins.length === 0 ? "" : ` ${connectOrigins.join(" ")}`}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(input.production ? ["upgrade-insecure-requests"] : []),
  ];
  return Object.freeze([
    { key: "Content-Security-Policy", value: directives.join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ]);
}

function validateConnectOrigin(origin: string, production: boolean): string {
  const parsed = new URL(origin);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "CSP connect origins must contain only scheme, host and optional port",
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !(local && !production && parsed.protocol === "http:")
  ) {
    throw new Error("Production CSP connect origins must use HTTPS");
  }
  return parsed.origin;
}
