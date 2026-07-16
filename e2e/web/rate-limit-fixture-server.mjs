import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 54329;
const credential = "playwright-service-role-key";
const limits = Object.freeze({
  booking_quote: 20,
  privileged_action: 10,
  provider_callback: 120,
  recipient_access: 30,
});
const counts = new Map();

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return sendJson(response, 200, { status: "ready" });
  }
  if (
    request.method !== "POST" ||
    request.url !== "/rest/v1/rpc/command_consume_rate_limit"
  ) {
    return sendJson(response, 404, { error: "not_found" });
  }
  if (
    request.headers.apikey !== credential ||
    request.headers.authorization !== `Bearer ${credential}`
  ) {
    return sendJson(response, 401, { error: "unauthorized" });
  }

  const body = await readJson(request);
  const policy = body?.target_policy_name;
  const opaqueKey = body?.target_opaque_key_sha256;
  const limit = typeof policy === "string" ? limits[policy] : undefined;
  if (
    typeof limit !== "number" ||
    typeof opaqueKey !== "string" ||
    !/^[a-f0-9]{64}$/u.test(opaqueKey)
  ) {
    return sendJson(response, 400, { error: "invalid_rate_limit_command" });
  }

  const counterKey = `${policy}:${opaqueKey}`;
  const count = (counts.get(counterKey) ?? 0) + 1;
  counts.set(counterKey, count);
  const allowed = count <= limit;
  return sendJson(response, 200, [
    {
      allowed,
      remaining: allowed ? limit - count : 0,
      retry_after_seconds: allowed ? 0 : 60,
    },
  ]);
});

server.listen(port, host);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}
