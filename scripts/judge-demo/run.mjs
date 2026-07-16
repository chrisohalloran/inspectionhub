import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { rmSync } from "node:fs";

import {
  createJudgeDemoState,
  judgeDemoEnvironment,
  LOOPBACK_HOST,
  removeJudgeDemoState,
  requestedWebPort,
  SYNTHETIC_OTP,
} from "./config.mjs";

const children = new Set();
let state;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    removeStateSync();
    void shutdown(signal === "SIGINT" ? 0 : 143);
  });
}
if (process.stdin.isTTY) {
  process.stdin.resume();
  process.stdin.once("data", () => void shutdown(0));
}
process.once("exit", removeStateSync);

try {
  state = await createJudgeDemoState();
  const webPort = requestedWebPort() ?? (await availablePort());
  let rateLimitPort = await availablePort();
  while (rateLimitPort === webPort) rateLimitPort = await availablePort();
  const environment = judgeDemoEnvironment({
    rateLimitPort,
    recipientStateFile: state.recipientStateFile,
  });

  const rateLimit = start(
    "node",
    ["e2e/web/rate-limit-fixture-server.mjs"],
    environment,
  );
  await waitForHttp(
    `http://${LOOPBACK_HOST}:${rateLimitPort}/health`,
    rateLimit,
  );

  for (const packageName of [
    "@inspection/reporting",
    "@inspection/recipient-access",
    "@inspection/web",
  ]) {
    await run("pnpm", ["--filter", packageName, "build"], environment);
  }

  const web = start(
    "pnpm",
    [
      "--filter",
      "@inspection/web",
      "exec",
      "next",
      "start",
      "--hostname",
      LOOPBACK_HOST,
      "--port",
      String(webPort),
    ],
    environment,
  );
  const url = `http://${LOOPBACK_HOST}:${webPort}`;
  await waitForHttp(url, web, 30_000);

  process.stdout.write(
    `\nLOCAL SYNTHETIC JUDGE DEMO\n` +
      `URL: ${url}\n` +
      `Recipient demo: ${url}/auth/invitation\n` +
      `Invitation: demo-invite-<any-unique-value>\n` +
      `Email: recipient@example.com\n` +
      `Synthetic OTP: ${SYNTHETIC_OTP}\n` +
      `Boundary: loopback-only, APP_ENV=test, fake providers, isolated filesystem fixture.\n` +
      `This is not a public or production deployment. No live AI, payment, email, or delivery is performed.\n` +
      `Press Enter to stop cleanly and remove temporary state (Ctrl-C is also supported).\n\n`,
  );

  const [code, signal] = await once(web, "exit");
  if (!stopping) {
    throw new Error(
      `Local web process stopped unexpectedly (${signal ?? `exit ${code ?? 1}`})`,
    );
  }
} catch (error) {
  if (!stopping) {
    process.stderr.write(
      `Judge demo failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    await shutdown(1);
  }
}

function start(command, arguments_, environment) {
  const child = spawn(command, arguments_, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function run(command, arguments_, environment) {
  const child = start(command, arguments_, environment);
  const [code, signal] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} failed (${signal ?? `exit ${code ?? 1}`})`,
    );
  }
}

async function availablePort() {
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

async function waitForHttp(url, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`${url} process exited before ready`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok) return;
    } catch {
      // Startup races are expected; the bounded loop remains fail-closed.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${url} did not become ready within ${timeoutMs}ms`);
}

async function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  const exits = [...children].map((child) =>
    child.exitCode === null ? once(child, "exit") : Promise.resolve(),
  );
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    [...children].map(async (child, index) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      await exits[index].catch(() => undefined);
      clearTimeout(timer);
    }),
  );
  if (state) await removeJudgeDemoState(state.directory);
  process.exit(exitCode);
}

function removeStateSync() {
  if (state) rmSync(state.directory, { force: true, recursive: true });
}
