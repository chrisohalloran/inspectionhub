import { pathToFileURL } from "node:url";

export const RECIPIENT_AUTHORITY_CONTRACT_VERSION =
  "recipient-demo-public-bounds-v2";

export async function verifyRecipientAuthorityContract(input) {
  const endpoint = requiredUrl(input.supabaseUrl);
  const serviceRoleKey = requiredSecret(input.serviceRoleKey);
  const timeoutMilliseconds = timeout(input.timeoutMilliseconds ?? 5_000);
  let response;
  try {
    response = await (input.fetcher ?? fetch)(
      `${endpoint.replace(/\/+$/u, "")}/rest/v1/rpc/recipient_demo_contract_version`,
      {
        body: "{}",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(timeoutMilliseconds),
      },
    );
  } catch {
    throw new Error("Recipient authority deployment preflight is unavailable");
  }
  if (!response.ok) {
    throw new Error("Recipient authority deployment contract is unavailable");
  }
  let observed;
  try {
    observed = await response.json();
  } catch {
    throw new Error("Recipient authority deployment contract is unreadable");
  }
  if (observed !== RECIPIENT_AUTHORITY_CONTRACT_VERSION) {
    throw new Error(
      `Recipient authority contract mismatch; expected ${RECIPIENT_AUTHORITY_CONTRACT_VERSION}`,
    );
  }
  return Object.freeze({
    contractVersion: observed,
    status: "passed",
  });
}

function requiredUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed || !/^https:\/\//u.test(trimmed)) {
    throw new Error("SUPABASE_API_URL must be an HTTPS URL");
  }
  return trimmed;
}

function requiredSecret(value) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 16) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return trimmed;
}

function timeout(value) {
  if (!Number.isSafeInteger(value) || value < 250 || value > 10_000) {
    throw new Error("Recipient authority preflight timeout is invalid");
  }
  return value;
}

async function main() {
  const result = await verifyRecipientAuthorityContract({
    supabaseUrl:
      process.env.SUPABASE_API_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Recipient authority deployment preflight failed"}\n`,
    );
    process.exitCode = 1;
  });
}
