import assert from "node:assert/strict";
import test from "node:test";

import {
  RECIPIENT_AUTHORITY_CONTRACT_VERSION,
  verifyRecipientAuthorityContract,
} from "./verify-recipient-authority.mjs";

const input = {
  supabaseUrl: "https://project.supabase.co",
  serviceRoleKey: "service-role-key-long-enough",
};

test("recipient authority preflight binds the database contract version", async () => {
  let observedRequest;
  const result = await verifyRecipientAuthorityContract({
    ...input,
    fetcher: async (url, init) => {
      observedRequest = { url, init };
      return response(true, RECIPIENT_AUTHORITY_CONTRACT_VERSION);
    },
  });

  assert.deepEqual(result, {
    contractVersion: RECIPIENT_AUTHORITY_CONTRACT_VERSION,
    status: "passed",
  });
  assert.match(
    observedRequest.url,
    /\/rest\/v1\/rpc\/recipient_demo_contract_version$/u,
  );
  assert.equal(observedRequest.init.method, "POST");
  assert.equal(observedRequest.init.headers.apikey, input.serviceRoleKey);
});

test("recipient authority preflight fails closed on missing or stale database state", async () => {
  await assert.rejects(
    verifyRecipientAuthorityContract({
      ...input,
      fetcher: async () => response(false, { code: "PGRST202" }),
    }),
    /contract is unavailable/u,
  );
  await assert.rejects(
    verifyRecipientAuthorityContract({
      ...input,
      fetcher: async () => response(true, "recipient-demo-public-bounds-v1"),
    }),
    /contract mismatch/u,
  );
});

test("recipient authority preflight rejects unsafe configuration before fetch", async () => {
  let calls = 0;
  await assert.rejects(
    verifyRecipientAuthorityContract({
      supabaseUrl: "http://project.supabase.co",
      serviceRoleKey: input.serviceRoleKey,
      fetcher: async () => {
        calls += 1;
        return response(true, RECIPIENT_AUTHORITY_CONTRACT_VERSION);
      },
    }),
    /HTTPS URL/u,
  );
  assert.equal(calls, 0);
});

function response(ok, body) {
  return {
    ok,
    json: async () => body,
  };
}
