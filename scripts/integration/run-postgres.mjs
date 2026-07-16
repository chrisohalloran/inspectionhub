import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(
      `${command} ${arguments_.join(" ")} failed${result.status === null ? " to start" : ` with ${result.status}`}\n${detail}`,
      { cause: result.error },
    );
  }
  return result;
}

async function runRecipientConcurrency(connectionArguments, environment) {
  const setup = String.raw`
    insert into public.recipient_demo_invitation_claims (
      invitation_digest, challenge_id, intended_email, expires_at
    ) values (
      repeat('c', 43), 'f1000000-0000-4000-8000-000000000001',
      'recipient@example.com', '2099-01-01T00:00:00Z'
    );
    insert into public.recipient_demo_challenge_completions (challenge_id)
    values ('f1000000-0000-4000-8000-000000000001');
    insert into public.recipient_demo_grants (
      id, challenge_id, principal_id, verified_email, organization_id, job_id,
      report_version_id, permitted_modules, permitted_actions, expires_at
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000001',
      'principal_demo_recipient', 'recipient@example.com', 'org_demo',
      'job_demo_cracked_tile', 'report_demo_v2',
      array['building', 'timber_pest']::text[],
      array['read_report', 'contact_inspector', 'invite_recipient']::text[],
      '2099-01-01T00:00:00Z'
    );
  `;
  run(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      setup,
    ],
    { env: environment },
  );

  const withdrawal = String.raw`
    begin;
    select pg_advisory_xact_lock(hashtextextended('recipient-demo:report_demo_v2', 0));
    insert into public.recipient_demo_module_events (
      id, report_version_id, module_type, state
    ) values
      ('f3000000-0000-4000-8000-000000000001', 'report_demo_v2', 'building', 'withdrawn'),
      ('f3000000-0000-4000-8000-000000000002', 'report_demo_v2', 'timber_pest', 'withdrawn');
    select pg_sleep(0.75);
    commit;
  `;
  const holder = spawn(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      withdrawal,
    ],
    { env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  let holderOutput = "";
  let holderError = "";
  holder.stdout.setEncoding("utf8");
  holder.stderr.setEncoding("utf8");
  holder.stdout.on("data", (chunk) => {
    holderOutput += chunk;
  });
  holder.stderr.on("data", (chunk) => {
    holderError += chunk;
  });
  const holderExit = new Promise((resolve, reject) => {
    holder.once("error", reject);
    holder.once("exit", resolve);
  });
  let lockObserved = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const lockCount = run(
      "psql",
      [
        ...connectionArguments,
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--command",
        "select count(*) from pg_locks where locktype = 'advisory' and granted",
      ],
      { env: environment },
    );
    if (Number(lockCount.stdout.trim()) > 0) {
      lockObserved = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!lockObserved) {
    const code = await holderExit;
    throw new Error(
      `Recipient concurrency lock was not observed; holder exited ${String(code)}\n${holderOutput}\n${holderError}`,
    );
  }

  const contender = spawnSync(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      String.raw`
        select public.command_recipient_demo_record_share(
          'f2000000-0000-4000-8000-000000000001', 1,
          'principal_demo_recipient', 'recipient@example.com', 'org_demo',
          'job_demo_cracked_tile', 'report_demo_v2',
          'race@example.com',
          statement_timestamp() + interval '30 minutes'
        );
      `,
    ],
    { encoding: "utf8", env: environment, stdio: "pipe" },
  );
  const holderCode = await holderExit;
  if (holderCode !== 0) {
    throw new Error(
      `Recipient concurrency holder failed with ${String(holderCode)}\n${holderOutput}\n${holderError}`,
    );
  }
  if (
    contender.status === 0 ||
    !String(contender.stderr).includes("recipient share request is unavailable")
  ) {
    throw new Error(
      `Concurrent share did not fail after the committed withdrawal\n${String(contender.stdout)}\n${String(contender.stderr)}`,
    );
  }

  const verification = run(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command",
      "select count(*) from public.recipient_demo_share_requests where email = 'race@example.com'",
    ],
    { env: environment },
  );
  if (verification.stdout.trim() !== "0") {
    throw new Error("Concurrent share left a partial authority record");
  }

  run(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      String.raw`
        set session_replication_role = replica;
        delete from public.recipient_demo_module_events
          where id in (
            'f3000000-0000-4000-8000-000000000001',
            'f3000000-0000-4000-8000-000000000002'
          );
        delete from public.recipient_demo_grants
          where id = 'f2000000-0000-4000-8000-000000000001';
        delete from public.recipient_demo_challenge_completions
          where challenge_id = 'f1000000-0000-4000-8000-000000000001';
        delete from public.recipient_demo_invitation_claims
          where challenge_id = 'f1000000-0000-4000-8000-000000000001';
        set session_replication_role = origin;
      `,
    ],
    { env: environment },
  );
  process.stdout.write(
    "Recipient authority concurrency proof passed (withdrawal serialized before share, zero partial records).\n",
  );
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port)
    throw new Error("Could not reserve an integration-test Postgres port.");
  return port;
}

async function sqlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

const bootstrapSql = String.raw`
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant usage on schema auth to anon, authenticated, service_role;
`;

async function main() {
  const externalDatabaseUrl = process.env.TEST_DATABASE_URL;
  let temporaryRoot;
  let localEnvironment;
  let startedLocalPostgres = false;
  let connectionArguments;

  try {
    if (externalDatabaseUrl) {
      connectionArguments = ["--dbname", externalDatabaseUrl];
      localEnvironment = process.env;
    } else {
      temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "inspection-postgres-"),
      );
      const dataDirectory = path.join(temporaryRoot, "data");
      const socketDirectory = path.join(temporaryRoot, "socket");
      await mkdir(socketDirectory);
      const port = await getFreePort();
      run("initdb", [
        "--pgdata",
        dataDirectory,
        "--auth=trust",
        "--username=postgres",
        "--no-locale",
        "--encoding=UTF8",
      ]);
      run("pg_ctl", [
        "--pgdata",
        dataDirectory,
        "--log",
        path.join(temporaryRoot, "postgres.log"),
        "--options",
        `-F -p ${port} -k ${socketDirectory}`,
        "--wait",
        "start",
      ]);
      startedLocalPostgres = true;
      localEnvironment = {
        ...process.env,
        PGHOST: socketDirectory,
        PGPORT: String(port),
        PGUSER: "postgres",
      };
      run("createdb", ["inspection_test"], { env: localEnvironment });
      connectionArguments = ["--dbname", "inspection_test"];
    }

    run(
      "psql",
      [
        ...connectionArguments,
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        bootstrapSql,
      ],
      { env: localEnvironment },
    );

    const migrations = await sqlFiles("supabase/migrations");
    if (migrations.length === 0)
      throw new Error("No Supabase migrations were found for U2.");
    for (const migration of migrations) {
      process.stdout.write(`Applying ${migration}\n`);
      run(
        "psql",
        [
          ...connectionArguments,
          "--no-psqlrc",
          "--set",
          "ON_ERROR_STOP=1",
          "--file",
          migration,
        ],
        { env: localEnvironment, inherit: true },
      );
    }

    const tests = await sqlFiles("supabase/tests");
    if (tests.length === 0)
      throw new Error("No Supabase SQL tests were found for U2.");
    for (const testFile of tests) {
      process.stdout.write(`Running ${testFile}\n`);
      run(
        "psql",
        [
          ...connectionArguments,
          "--no-psqlrc",
          "--set",
          "ON_ERROR_STOP=1",
          "--file",
          testFile,
        ],
        { env: localEnvironment, inherit: true },
      );
    }
    await runRecipientConcurrency(connectionArguments, localEnvironment);
    process.stdout.write(
      `Postgres integration gate passed (${migrations.length} migrations, ${tests.length} SQL tests).\n`,
    );
  } finally {
    if (startedLocalPostgres && temporaryRoot) {
      const dataDirectory = path.join(temporaryRoot, "data");
      run("pg_ctl", [
        "--pgdata",
        dataDirectory,
        "--mode=immediate",
        "--wait",
        "stop",
      ]);
    }
    if (temporaryRoot)
      await rm(temporaryRoot, { force: true, recursive: true });
  }
}

await main();
