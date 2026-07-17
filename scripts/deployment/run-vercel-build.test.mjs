import assert from "node:assert/strict";
import test from "node:test";

import { runProtectedVercelBuild } from "./run-vercel-build.mjs";

test("production Vercel builds preflight before building", async () => {
  const calls = [];

  await runProtectedVercelBuild({
    environment: { VERCEL: "1", VERCEL_ENV: "production" },
    preflight: async () => {
      calls.push("preflight");
    },
    build: () => {
      calls.push("build");
    },
  });

  assert.deepEqual(calls, ["preflight", "build"]);
});

test("production Vercel builds stop when the contract preflight fails", async () => {
  let built = false;

  await assert.rejects(
    runProtectedVercelBuild({
      environment: { VERCEL: "1", VERCEL_ENV: "production" },
      preflight: () => Promise.reject(new Error("contract mismatch")),
      build: () => {
        built = true;
      },
    }),
    /contract mismatch/u,
  );
  assert.equal(built, false);
});

test("production Vercel builds fail closed without contract credentials", async () => {
  let built = false;

  await assert.rejects(
    runProtectedVercelBuild({
      environment: { VERCEL: "1", VERCEL_ENV: "production" },
      build: () => {
        built = true;
      },
    }),
    /SUPABASE_API_URL/u,
  );
  assert.equal(built, false);
});

test("preview and development builds remain credential-independent", async () => {
  for (const environment of [
    { VERCEL: "1", VERCEL_ENV: "preview" },
    { VERCEL_ENV: "development" },
  ]) {
    const calls = [];
    await runProtectedVercelBuild({
      environment,
      preflight: async () => {
        calls.push("preflight");
      },
      build: () => {
        calls.push("build");
      },
    });
    assert.deepEqual(calls, ["build"]);
  }
});

test("Vercel builds fail closed when the deployment environment is missing", async () => {
  await assert.rejects(
    runProtectedVercelBuild({
      environment: {},
      preflight: async () => undefined,
      build: () => undefined,
    }),
    /VERCEL_ENV/u,
  );
});
