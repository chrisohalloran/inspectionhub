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

function spawnTrackedPsql(
  connectionArguments,
  environment,
  sql,
  applicationName,
) {
  if (!/^[a-z0-9-]{3,63}$/u.test(applicationName)) {
    throw new Error("Postgres proof application name is invalid");
  }
  const child = spawn(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      sql,
    ],
    {
      env: { ...environment, PGAPPNAME: applicationName },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ code, signal, stderr, stdout }),
    );
  });
  return { exit };
}

async function observeRecipientReportLock(
  connectionArguments,
  environment,
  applicationName,
  granted,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = run(
      "psql",
      [
        ...connectionArguments,
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--command",
        String.raw`
          select activity.pid
          from pg_catalog.pg_locks lock_record
          join pg_catalog.pg_stat_activity activity
            on activity.pid = lock_record.pid
          where lock_record.locktype = 'advisory'
            and lock_record.database = (
              select database_record.oid
              from pg_catalog.pg_database database_record
              where database_record.datname = current_database()
            )
            and lock_record.objsubid = 1
            and (
              (lock_record.classid::bigint << 32)
              | lock_record.objid::bigint
            ) = hashtextextended('recipient-demo:report_demo_v2', 0)
            and lock_record.granted = ${granted ? "true" : "false"}
            and activity.application_name = '${applicationName}'
          limit 1;
        `,
      ],
      { env: environment },
    );
    const pid = Number(result.stdout.trim());
    if (Number.isInteger(pid) && pid > 0) return pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Exact recipient report lock was not observed for ${applicationName} (granted=${String(granted)})`,
  );
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
    select pg_sleep(1.5);
    commit;
  `;
  const withdrawalHolderName = `recipient-withdrawal-holder-${process.pid}`;
  const withdrawalContenderName = `recipient-withdrawal-contender-${process.pid}`;
  const holder = spawnTrackedPsql(
    connectionArguments,
    environment,
    withdrawal,
    withdrawalHolderName,
  );
  const holderPid = await observeRecipientReportLock(
    connectionArguments,
    environment,
    withdrawalHolderName,
    true,
  );
  const contender = spawnTrackedPsql(
    connectionArguments,
    environment,
    String.raw`
      select public.command_recipient_demo_record_share(
        'f2000000-0000-4000-8000-000000000001', 1,
        'principal_demo_recipient', 'recipient@example.com', 'org_demo',
        'job_demo_cracked_tile', 'report_demo_v2',
        'race@example.com',
        statement_timestamp() + interval '30 minutes'
      );
    `,
    withdrawalContenderName,
  );
  const contenderPid = await observeRecipientReportLock(
    connectionArguments,
    environment,
    withdrawalContenderName,
    false,
  );
  if (holderPid === contenderPid) {
    throw new Error("Recipient withdrawal holder and waiter shared a PID");
  }
  const [holderResult, contenderResult] = await Promise.all([
    holder.exit,
    contender.exit,
  ]);
  if (holderResult.code !== 0) {
    throw new Error(
      `Recipient concurrency holder ${String(holderPid)} failed with ${String(holderResult.code)}\n${holderResult.stdout}\n${holderResult.stderr}`,
    );
  }
  if (
    contenderResult.code === 0 ||
    !contenderResult.stderr.includes("recipient share request is unavailable")
  ) {
    throw new Error(
      `Waiting share ${String(contenderPid)} did not fail after the committed withdrawal\n${contenderResult.stdout}\n${contenderResult.stderr}`,
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
        insert into public.recipient_demo_module_events (
          report_version_id, module_type, state
        ) values
          ('report_demo_v2', 'building', 'restored'),
          ('report_demo_v2', 'timber_pest', 'restored');
        do $quota$
        declare
          item integer;
        begin
          for item in 1..4 loop
            perform public.command_recipient_demo_record_share(
              'f2000000-0000-4000-8000-000000000001', 1,
              'principal_demo_recipient', 'recipient@example.com', 'org_demo',
              'job_demo_cracked_tile', 'report_demo_v2',
              format('quota-prefill-%s@example.com', item),
              statement_timestamp() + interval '30 minutes'
            );
          end loop;
        end;
        $quota$;
      `,
    ],
    { env: environment },
  );

  const quotaHolderName = `recipient-quota-holder-${process.pid}`;
  const quotaContenderName = `recipient-quota-contender-${process.pid}`;
  const quotaHolder = spawnTrackedPsql(
    connectionArguments,
    environment,
    String.raw`
      begin;
      select public.command_recipient_demo_record_share(
        'f2000000-0000-4000-8000-000000000001', 1,
        'principal_demo_recipient', 'recipient@example.com', 'org_demo',
        'job_demo_cracked_tile', 'report_demo_v2',
        'quota-holder@example.com',
        statement_timestamp() + interval '30 minutes'
      );
      select pg_sleep(1.5);
      commit;
    `,
    quotaHolderName,
  );
  const quotaHolderPid = await observeRecipientReportLock(
    connectionArguments,
    environment,
    quotaHolderName,
    true,
  );
  const quotaContender = spawnTrackedPsql(
    connectionArguments,
    environment,
    String.raw`
      select public.command_recipient_demo_record_share(
        'f2000000-0000-4000-8000-000000000001', 1,
        'principal_demo_recipient', 'recipient@example.com', 'org_demo',
        'job_demo_cracked_tile', 'report_demo_v2',
        'quota-contender@example.com',
        statement_timestamp() + interval '30 minutes'
      );
    `,
    quotaContenderName,
  );
  const quotaContenderPid = await observeRecipientReportLock(
    connectionArguments,
    environment,
    quotaContenderName,
    false,
  );
  if (quotaHolderPid === quotaContenderPid) {
    throw new Error("Recipient quota holder and waiter shared a PID");
  }
  const [quotaHolderResult, quotaContenderResult] = await Promise.all([
    quotaHolder.exit,
    quotaContender.exit,
  ]);
  if (quotaHolderResult.code !== 0) {
    throw new Error(
      `Recipient quota holder ${String(quotaHolderPid)} failed with ${String(quotaHolderResult.code)}\n${quotaHolderResult.stdout}\n${quotaHolderResult.stderr}`,
    );
  }
  if (
    quotaContenderResult.code === 0 ||
    !quotaContenderResult.stderr.includes("grant_mutation_limit_reached")
  ) {
    throw new Error(
      `Waiting sixth share ${String(quotaContenderPid)} bypassed the quota\n${quotaContenderResult.stdout}\n${quotaContenderResult.stderr}`,
    );
  }

  const quotaVerification = run(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command",
      String.raw`
        select
          count(*) = 5
          and count(*) filter (where email = 'quota-contender@example.com') = 0
        from public.recipient_demo_share_requests
        where grant_id = 'f2000000-0000-4000-8000-000000000001';
      `,
    ],
    { env: environment },
  );
  if (quotaVerification.stdout.trim() !== "t") {
    throw new Error(
      "Concurrent share quota did not preserve exactly five rows",
    );
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
          where report_version_id = 'report_demo_v2';
        delete from public.recipient_demo_share_requests
          where grant_id = 'f2000000-0000-4000-8000-000000000001';
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
    `Recipient authority concurrency proof passed (exact report advisory key, holder PIDs ${String(holderPid)}/${String(quotaHolderPid)}, waiting contender PIDs ${String(contenderPid)}/${String(quotaContenderPid)}, zero partial or sixth records).\n`,
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

function resetExternalTestDatabase(databaseUrl, environment) {
  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid Postgres URL");
  }
  if (!/(?:^|[_-])test(?:$|[_-])/u.test(databaseName)) {
    throw new Error(
      `Refusing to reset external database ${databaseName || "<missing>"}; its name must contain a distinct test segment`,
    );
  }
  resetPublicSchema(["--dbname", databaseUrl], environment);
}

function resetPublicSchema(connectionArguments, environment) {
  run(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      String.raw`
        drop schema if exists public cascade;
        create schema public;
        grant all on schema public to current_user;
        grant usage on schema public to public;
      `,
    ],
    { env: environment },
  );
}

function applyMigration(
  connectionArguments,
  environment,
  migration,
  { inherit = true } = {},
) {
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
    { env: environment, inherit },
  );
}

function runRecipientUpgradeProof(
  migrations,
  connectionArguments,
  environment,
) {
  const publicBoundsIndex = migrations.findIndex(
    (migration) =>
      path.basename(migration) ===
      "20260717001000_recipient_demo_public_bounds.sql",
  );
  if (publicBoundsIndex <= 0) {
    throw new Error(
      "Recipient public-bounds migration is missing its predecessor chain",
    );
  }
  for (const migration of migrations.slice(0, publicBoundsIndex)) {
    applyMigration(connectionArguments, environment, migration, {
      inherit: false,
    });
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
        insert into public.recipient_demo_invitation_claims (
          invitation_digest, challenge_id, intended_email, expires_at
        ) values (
          repeat('u', 43), 'fa100000-0000-4000-8000-000000000001',
          'recipient@example.com', '2099-01-01T00:00:00Z'
        );
        insert into public.recipient_demo_challenge_completions (challenge_id)
        values ('fa100000-0000-4000-8000-000000000001');
        insert into public.recipient_demo_grants (
          id, challenge_id, principal_id, verified_email, organization_id,
          job_id, report_version_id, permitted_modules, permitted_actions,
          expires_at
        ) values (
          'fa200000-0000-4000-8000-000000000001',
          'fa100000-0000-4000-8000-000000000001',
          'principal_demo_recipient', 'recipient@example.com', 'org_demo',
          'job_demo_cracked_tile', 'report_demo_v2',
          array['building', 'timber_pest']::text[],
          array['read_report', 'invite_recipient']::text[],
          '2099-01-01T00:00:00Z'
        );
        insert into public.recipient_demo_share_requests (
          id, grant_id, email, permitted_modules, expires_at
        ) values (
          'fa300000-0000-4000-8000-000000000001',
          'fa200000-0000-4000-8000-000000000001',
          'predecessor-valid@outside.test', array['building']::text[],
          '2099-01-01T00:00:00Z'
        );
      `,
    ],
    { env: environment },
  );

  applyMigration(
    connectionArguments,
    environment,
    migrations[publicBoundsIndex],
    { inherit: false },
  );

  run(
    "psql",
    [
      ...connectionArguments,
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      String.raw`
        do $upgrade$
        declare
          portal_state jsonb;
        begin
          if (
            select constraint_record.convalidated
            from pg_catalog.pg_constraint constraint_record
            where constraint_record.conrelid =
              'public.recipient_demo_share_requests'::regclass
              and constraint_record.conname =
                'recipient_demo_share_requests_reserved_email_check'
          ) then
            raise exception 'legacy-invalid constraint was incorrectly marked validated';
          end if;
          if not exists (
            select 1
            from public.recipient_demo_share_request_quarantines quarantine
            where quarantine.share_request_id =
                'fa300000-0000-4000-8000-000000000001'
              and quarantine.email_digest = encode(
                extensions.digest('predecessor-valid@outside.test', 'sha256'),
                'hex'
              )
              and quarantine.safe_reason = 'legacy_non_reserved_email'
          ) then
            raise exception 'legacy share was not quarantined by digest';
          end if;
          if exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'recipient_demo_share_request_quarantines'
              and column_name = 'email'
          ) then
            raise exception 'quarantine duplicated the raw recipient address';
          end if;
          begin
            update public.recipient_demo_share_requests
            set email = 'rewritten@example.com'
            where id = 'fa300000-0000-4000-8000-000000000001';
            raise exception 'legacy append-only share was rewritten';
          exception when sqlstate '55000' then
            null;
          end;
          begin
            insert into public.recipient_demo_share_requests (
              grant_id, email, permitted_modules, expires_at
            ) values (
              'fa200000-0000-4000-8000-000000000001',
              'new-real-address@outside.test', array['building']::text[],
              '2099-01-01T00:00:00Z'
            );
            raise exception 'new non-reserved share bypassed the constraint';
          exception when check_violation then
            null;
          end;
          portal_state := public.command_recipient_demo_portal_state(
            'fa200000-0000-4000-8000-000000000001', 1,
            'principal_demo_recipient', 'recipient@example.com', 'org_demo',
            'job_demo_cracked_tile', 'report_demo_v2'
          );
          if jsonb_array_length(portal_state -> 'shareInvitations') <> 0 then
            raise exception 'quarantined legacy share leaked into portal state';
          end if;
        end;
        $upgrade$;
      `,
    ],
    { env: environment },
  );
  process.stdout.write(
    "Recipient migration upgrade proof passed (legacy row preserved append-only, digest-quarantined, hidden, and new real addresses rejected).\n",
  );
}

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
      resetExternalTestDatabase(externalDatabaseUrl, localEnvironment);
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
    runRecipientUpgradeProof(migrations, connectionArguments, localEnvironment);
    resetPublicSchema(connectionArguments, localEnvironment);
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
    for (const migration of migrations) {
      process.stdout.write(`Applying ${migration}\n`);
      applyMigration(connectionArguments, localEnvironment, migration);
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
