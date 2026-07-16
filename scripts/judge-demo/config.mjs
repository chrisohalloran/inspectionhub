import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LOOPBACK_HOST = "127.0.0.1";
export const SYNTHETIC_OTP = "482913";

export function requestedWebPort(environment = process.env) {
  const raw = environment.JUDGE_DEMO_PORT?.trim();
  if (!raw) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("JUDGE_DEMO_PORT must be an integer from 1024 to 65535");
  }
  return port;
}

export async function availableLoopbackPort() {
  const server = createServer();
  server.unref();
  server.listen(0, LOOPBACK_HOST);
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error("Could not allocate a loopback port");
  return port;
}

export async function createJudgeDemoState(root = tmpdir()) {
  const directory = await mkdtemp(join(root, "inspectionhub-judge-demo-"));
  return {
    directory,
    recipientStateFile: join(directory, "recipient-state.jsonl"),
  };
}

export function judgeDemoEnvironment({
  baseEnvironment = process.env,
  rateLimitPort,
  recipientStateFile,
}) {
  const serviceCredential = `judge-fixture-${randomBytes(24).toString("hex")}`;
  return {
    ...baseEnvironment,
    APP_ENV: "test",
    BUILD_WEEK_FIXTURES_ENABLED: "true",
    DATABASE_URL: "",
    GOOGLE_CALENDAR_CREDENTIALS_JSON: "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NODE_ENV: "production",
    OPENAI_API_KEY: "",
    OPENAI_STORE: "false",
    PROVIDER_MODE: "fake",
    RATE_LIMIT_FIXTURE_CREDENTIAL: serviceCredential,
    RATE_LIMIT_FIXTURE_HOST: LOOPBACK_HOST,
    RATE_LIMIT_FIXTURE_PORT: String(rateLimitPort),
    RATE_LIMIT_HASH_SECRET: randomBytes(32).toString("hex"),
    RECIPIENT_AUTHORITY_ADAPTER: "fixture",
    RECIPIENT_DEMO_ACCESS_ENABLED: "true",
    RECIPIENT_DEMO_OTP: SYNTHETIC_OTP,
    RECIPIENT_DEMO_STATE_FILE: recipientStateFile,
    RECIPIENT_SESSION_SECRET: randomBytes(32).toString("hex"),
    RESEND_API_KEY: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    SUPABASE_API_URL: `http://${LOOPBACK_HOST}:${rateLimitPort}`,
    SUPABASE_SERVICE_ROLE_KEY: serviceCredential,
  };
}

export async function removeJudgeDemoState(directory) {
  await rm(directory, { force: true, recursive: true });
}
