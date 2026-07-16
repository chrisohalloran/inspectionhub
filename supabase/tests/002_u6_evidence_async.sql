\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(condition boolean, description text)
returns void
language plpgsql
as $function$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', description;
  end if;
  raise notice 'ok - %', description;
end;
$function$;

insert into public.organizations (id, slug, name) values
  ('caaaaaaa-0000-4000-8000-000000000001', 'u6-alpha', 'U6 Alpha'),
  ('cbbbbbbb-0000-4000-8000-000000000001', 'u6-beta', 'U6 Beta');

insert into public.jobs (id, organization_id, reference, property_label, state) values
  ('caaa0000-0000-4000-8000-000000000001', 'caaaaaaa-0000-4000-8000-000000000001', 'U6-A', 'Synthetic U6 Alpha', 'in_progress'),
  ('cbbb0000-0000-4000-8000-000000000001', 'cbbbbbbb-0000-4000-8000-000000000001', 'U6-B', 'Synthetic U6 Beta', 'in_progress');

do $test$
begin
  begin
    perform * from public.record_verified_artifact_durability(
      'caaaaaaa-0000-4000-8000-000000000001',
      'caaa0000-0000-4000-8000-000000000001',
      'ca110000-0000-4000-8000-000000000001',
      'ca120000-0000-4000-8000-000000000001',
      1, 'photo', repeat('a', 64), 100, 'image/jpeg',
      'quarantine/cbbbbbbb-0000-4000-8000-000000000001/wrong.jpg',
      statement_timestamp(), 'Main bathroom', null,
      repeat('a', 64), 100, 'object-v1', true, 'durability-wrong-path'
    );
    raise exception 'assertion failed: cross-tenant storage path was accepted';
  exception when check_violation then
    raise notice 'ok - cross-tenant storage path is rejected';
  end;
end;
$test$;

select pg_temp.assert_true(
  (select result_state = 'recorded' from public.record_verified_artifact_durability(
    'caaaaaaa-0000-4000-8000-000000000001',
    'caaa0000-0000-4000-8000-000000000001',
    'ca110000-0000-4000-8000-000000000001',
    'ca120000-0000-4000-8000-000000000001',
    1, 'photo', repeat('a', 64), 100, 'image/jpeg',
    'quarantine/caaaaaaa-0000-4000-8000-000000000001/caaa0000-0000-4000-8000-000000000001/ca120000-0000-4000-8000-000000000001/ca110000-0000-4000-8000-000000000001.jpg',
    statement_timestamp(), 'Main bathroom', null,
    repeat('a', 64), 100, 'object-v1', true, 'durability-artifact-one'
  )),
  'verified object metadata, receipt and durability event commit together'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.artifacts where id = 'ca110000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.artifact_durability_receipts where artifact_id = 'ca110000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.session_events where aggregate_id = 'ca110000-0000-4000-8000-000000000001' and event_type = 'artifact.durability_verified')
  and (select count(*) = 1 from public.async_tasks where aggregate_id = 'ca110000-0000-4000-8000-000000000001' and task_type = 'content.validate_and_proxy')
  and (select count(*) = 1 from public.session_events where aggregate_type = 'async_task' and event_type = 'system.task_enqueued')
  and (select count(*) = 1 from public.outbox_records where aggregate_id = 'ca110000-0000-4000-8000-000000000001' and provider_observation_ref = 'task_enqueued_atomically'),
  'artifact, receipt, event, content task and outbox record commit together'
);

select pg_temp.assert_true(
  (select result_state = 'duplicate_attempt' from public.record_verified_artifact_durability(
    'caaaaaaa-0000-4000-8000-000000000001',
    'caaa0000-0000-4000-8000-000000000001',
    'ca110000-0000-4000-8000-000000000099',
    'ca120000-0000-4000-8000-000000000001',
    1, 'photo', repeat('a', 64), 100, 'image/jpeg',
    'quarantine/caaaaaaa-0000-4000-8000-000000000001/caaa0000-0000-4000-8000-000000000001/ca120000-0000-4000-8000-000000000001/ca110000-0000-4000-8000-000000000099.jpg',
    statement_timestamp(), 'Main bathroom', null,
    repeat('a', 64), 100, 'object-v1-retry', true, 'durability-artifact-one-retry'
  )),
  'same capture and hash finalisation is an idempotent duplicate attempt'
);

select pg_temp.assert_true(
  (select result_state = 'hash_divergence' from public.record_verified_artifact_durability(
    'caaaaaaa-0000-4000-8000-000000000001',
    'caaa0000-0000-4000-8000-000000000001',
    'ca110000-0000-4000-8000-000000000098',
    'ca120000-0000-4000-8000-000000000001',
    1, 'photo', repeat('b', 64), 101, 'image/jpeg',
    'quarantine/caaaaaaa-0000-4000-8000-000000000001/caaa0000-0000-4000-8000-000000000001/ca120000-0000-4000-8000-000000000001/ca110000-0000-4000-8000-000000000098.jpg',
    statement_timestamp(), 'Main bathroom', null,
    repeat('b', 64), 101, 'object-divergent', true, 'durability-artifact-divergent'
  )),
  'same capture identity with changed bytes is quarantined as divergence'
);

select pg_temp.assert_true(
  (select result_state = 'recorded' from public.record_verified_artifact_durability(
    'caaaaaaa-0000-4000-8000-000000000001',
    'caaa0000-0000-4000-8000-000000000001',
    'ca110000-0000-4000-8000-000000000002',
    'ca120000-0000-4000-8000-000000000002',
    2, 'photo', repeat('a', 64), 100, 'image/jpeg',
    'quarantine/caaaaaaa-0000-4000-8000-000000000001/caaa0000-0000-4000-8000-000000000001/ca120000-0000-4000-8000-000000000002/ca110000-0000-4000-8000-000000000002.jpg',
    statement_timestamp(), 'Main bathroom', null,
    repeat('a', 64), 100, 'object-v2', true, 'durability-artifact-two'
  )),
  'identical bytes from another genuine capture retain another artifact identity'
);

insert into public.artifacts (
  id, organization_id, job_id, capture_id, capture_sequence, artifact_kind,
  content_sha256, byte_size, media_type, storage_key, captured_at, quarantine_state
) values (
  'ca130000-0000-4000-8000-000000000001',
  'caaaaaaa-0000-4000-8000-000000000001',
  'caaa0000-0000-4000-8000-000000000001',
  'ca140000-0000-4000-8000-000000000001', 3, 'safe_proxy',
  repeat('c', 64), 90, 'image/jpeg',
  'safe/caaaaaaa-0000-4000-8000-000000000001/caaa0000-0000-4000-8000-000000000001/ca130000-0000-4000-8000-000000000001.jpg',
  statement_timestamp(), 'accepted'
);

insert into public.artifact_derivations (
  organization_id, parent_artifact_id, derived_artifact_id, transformation, parameters_sha256
) values (
  'caaaaaaa-0000-4000-8000-000000000001',
  'ca110000-0000-4000-8000-000000000001',
  'ca130000-0000-4000-8000-000000000001', 'safe_decode', repeat('d', 64)
);

do $test$
declare content_lease public.async_tasks%rowtype;
begin
  select * into content_lease from public.lease_async_task('u6-content-worker', interval '2 minutes');
  perform pg_temp.assert_true(
    content_lease.aggregate_id = 'ca110000-0000-4000-8000-000000000001',
    'atomic durability task is runnable without manual enqueue'
  );
  perform pg_temp.assert_true(
    not public.record_content_assessment_under_lease(
      content_lease.id, content_lease.lease_generation + 1, content_lease.lease_token,
      'ca110000-0000-4000-8000-000000000001', 'accepted', null, 'image/jpeg',
      640, 480, null, 'sandbox-v1', 'ca130000-0000-4000-8000-000000000001'
    ),
    'stale generation cannot confer safe-proxy trust'
  );
  perform pg_temp.assert_true(
    public.record_content_assessment_under_lease(
      content_lease.id, content_lease.lease_generation, content_lease.lease_token,
      'ca110000-0000-4000-8000-000000000001', 'accepted', null, 'image/jpeg',
      640, 480, null, 'sandbox-v1', 'ca130000-0000-4000-8000-000000000001'
    ),
    'accepted assessment and proxy provenance commit under the exact lease fence'
  );
  perform public.complete_async_task(
    content_lease.id, content_lease.lease_generation, content_lease.lease_token,
    'ca130000-0000-4000-8000-000000000001'
  );
end;
$test$;

do $test$
begin
  begin
    update public.artifact_content_assessments set observed_width = 800
    where artifact_id = 'ca110000-0000-4000-8000-000000000001';
    raise exception 'assertion failed: content assessment mutation was accepted';
  exception when sqlstate '55000' then
    raise notice 'ok - quarantine assessments are append-only';
  end;
end;
$test$;

-- Isolate the following lease-order assertions from the content tasks whose
-- atomic creation was proven above.
update public.async_tasks
set state = 'cancelled'
where task_type = 'content.validate_and_proxy';

insert into public.async_tasks (
  id, organization_id, task_type, aggregate_type, aggregate_id,
  idempotency_key, request_fingerprint, state
) values
  ('ca210000-0000-4000-8000-000000000001', 'caaaaaaa-0000-4000-8000-000000000001', 'content.validate', 'artifact', 'ca110000-0000-4000-8000-000000000001', 'u6-parent', repeat('1', 64), 'queued'),
  ('ca210000-0000-4000-8000-000000000002', 'caaaaaaa-0000-4000-8000-000000000001', 'ai.draft', 'artifact', 'ca110000-0000-4000-8000-000000000001', 'u6-child', repeat('2', 64), 'queued');

insert into public.async_task_dependencies (organization_id, task_id, depends_on_task_id) values (
  'caaaaaaa-0000-4000-8000-000000000001',
  'ca210000-0000-4000-8000-000000000002',
  'ca210000-0000-4000-8000-000000000001'
);

do $test$
begin
  begin
    insert into public.async_task_dependencies (
      organization_id, task_id, depends_on_task_id
    ) values (
      'caaaaaaa-0000-4000-8000-000000000001',
      'ca210000-0000-4000-8000-000000000001',
      'ca210000-0000-4000-8000-000000000002'
    );
    raise exception 'assertion failed: task dependency cycle was accepted';
  exception when check_violation then
    raise notice 'ok - task dependency cycles are rejected';
  end;
end;
$test$;

do $test$
declare first_lease public.async_tasks%rowtype; second_lease public.async_tasks%rowtype;
begin
  select * into first_lease from public.lease_async_task('u6-worker', interval '2 minutes');
  perform pg_temp.assert_true(first_lease.id = 'ca210000-0000-4000-8000-000000000001', 'dependency blocks out-of-order child task leasing');
  perform pg_temp.assert_true(
    public.checkpoint_async_task(first_lease.id, first_lease.lease_generation, first_lease.lease_token, 'object.read_verified', '{}'::uuid[], array[repeat('a', 64)]),
    'worker checkpoint requires the active fencing token'
  );
  perform pg_temp.assert_true(
    public.complete_async_task(first_lease.id, first_lease.lease_generation, first_lease.lease_token, null),
    'parent task completes under its exact lease fence'
  );
  select * into second_lease from public.lease_async_task('u6-worker', interval '2 minutes');
  perform pg_temp.assert_true(second_lease.id = 'ca210000-0000-4000-8000-000000000002', 'child task leases after dependency completion');
  perform public.complete_async_task(second_lease.id, second_lease.lease_generation, second_lease.lease_token, null);
end;
$test$;

select pg_temp.assert_true(
  (select count(*) = 3 from public.session_events
    where aggregate_id = 'ca210000-0000-4000-8000-000000000001'
      and event_type in ('tool.task_lease_started', 'tool.task_checkpoint', 'system.task_completed')),
  'lease, checkpoint and completion append safe task events'
);

insert into public.async_tasks (
  id, organization_id, task_type, aggregate_type, aggregate_id,
  idempotency_key, request_fingerprint, state, max_attempts
) values (
  'ca210000-0000-4000-8000-000000000003', 'caaaaaaa-0000-4000-8000-000000000001',
  'proxy.create', 'artifact', 'ca110000-0000-4000-8000-000000000002',
  'u6-stale', repeat('3', 64), 'queued', 3
);

do $test$
declare stale_lease public.async_tasks%rowtype; replacement_lease public.async_tasks%rowtype;
begin
  select * into stale_lease from public.lease_async_task('u6-worker-old', interval '2 minutes');
  update public.async_tasks set leased_until = statement_timestamp() - interval '1 second'
  where id = stale_lease.id;
  select * into replacement_lease from public.lease_async_task('u6-worker-new', interval '2 minutes');
  perform pg_temp.assert_true(replacement_lease.lease_generation = stale_lease.lease_generation + 1, 'lost lease is recovered with a higher fencing generation');
  perform pg_temp.assert_true(
    not public.complete_async_task(stale_lease.id, stale_lease.lease_generation, stale_lease.lease_token, null),
    'stale worker completion is rejected'
  );
  perform public.complete_async_task(replacement_lease.id, replacement_lease.lease_generation, replacement_lease.lease_token, null);
end;
$test$;

insert into public.async_tasks (
  id, organization_id, task_type, aggregate_type, aggregate_id,
  idempotency_key, request_fingerprint, state, max_attempts
) values (
  'ca210000-0000-4000-8000-000000000004', 'caaaaaaa-0000-4000-8000-000000000001',
  'proxy.create', 'artifact', 'ca110000-0000-4000-8000-000000000002',
  'u6-dead-letter', repeat('4', 64), 'queued', 1
);

do $test$
declare task_lease public.async_tasks%rowtype;
begin
  select * into task_lease from public.lease_async_task('u6-worker', interval '2 minutes');
  perform pg_temp.assert_true(
    public.fail_async_task(task_lease.id, task_lease.lease_generation, task_lease.lease_token, 'decoder_failed', true, interval '0 seconds') = 'dead_letter',
    'bounded retries terminate visibly in dead-letter state'
  );
end;
$test$;

select pg_temp.assert_true(
  (select count(*) = 1 from public.session_events
    where aggregate_id = 'ca210000-0000-4000-8000-000000000004'
      and event_type = 'system.task_dead_lettered'),
  'dead-letter transition appends a safe terminal event'
);

insert into public.async_tasks (
  id, organization_id, task_type, aggregate_type, aggregate_id,
  idempotency_key, request_fingerprint, state
) values (
  'ca210000-0000-4000-8000-000000000006', 'caaaaaaa-0000-4000-8000-000000000001',
  'ai.draft', 'artifact', 'ca110000-0000-4000-8000-000000000002',
  'u6-terminal-dependent', repeat('6', 64), 'queued'
);
insert into public.async_task_dependencies (organization_id, task_id, depends_on_task_id) values (
  'caaaaaaa-0000-4000-8000-000000000001',
  'ca210000-0000-4000-8000-000000000006',
  'ca210000-0000-4000-8000-000000000004'
);
select count(*) from public.lease_async_task('u6-worker', interval '2 minutes');
select pg_temp.assert_true(
  (select state = 'cancelled' and last_error_code = 'dependency_terminal'
    from public.async_tasks where id = 'ca210000-0000-4000-8000-000000000006')
  and (select count(*) = 1 from public.session_events
    where aggregate_id = 'ca210000-0000-4000-8000-000000000006'
      and event_type = 'system.task_cancelled'),
  'terminal prerequisite cancels dependant with a safe event'
);

insert into public.async_tasks (
  id, organization_id, task_type, aggregate_type, aggregate_id,
  idempotency_key, request_fingerprint, state, packet_id, packet_revision
) values (
  'ca210000-0000-4000-8000-000000000005', 'caaaaaaa-0000-4000-8000-000000000001',
  'ai.draft', 'investigation_packet', 'ca310000-0000-4000-8000-000000000001',
  'u6-packet-one', repeat('5', 64), 'succeeded',
  'ca310000-0000-4000-8000-000000000001', 1
);

do $test$
declare changed_count bigint; observed_state text; observed_revision bigint;
begin
  changed_count := public.supersede_packet_tasks(
    'caaaaaaa-0000-4000-8000-000000000001',
    'ca310000-0000-4000-8000-000000000001', 2
  );
  select state, superseded_by_revision into observed_state, observed_revision
  from public.async_tasks where id = 'ca210000-0000-4000-8000-000000000005';
  perform pg_temp.assert_true(
    changed_count = 1 and observed_state = 'superseded' and observed_revision = 2,
    'packet changes supersede older completed AI work'
  );
end;
$test$;

select pg_temp.assert_true(
  (select count(*) = 1 from public.session_events
    where aggregate_id = 'ca210000-0000-4000-8000-000000000005'
      and event_type = 'system.task_superseded'),
  'packet supersession appends a safe task event'
);

insert into public.async_tasks (
  id, organization_id, task_type, aggregate_type, aggregate_id,
  idempotency_key, request_fingerprint, state
) values (
  'ca210000-0000-4000-8000-000000000007', 'caaaaaaa-0000-4000-8000-000000000001',
  'ai.draft', 'artifact', 'ca110000-0000-4000-8000-000000000002',
  'u6-unknown-reconcile', repeat('7', 64), 'queued'
);

do $test$
declare task_lease public.async_tasks%rowtype; replacement_lease public.async_tasks%rowtype;
begin
  select * into task_lease from public.lease_async_task('u6-unknown-worker', interval '2 minutes');
  update public.async_tasks set leased_until = statement_timestamp() - interval '1 second'
  where id = task_lease.id;
  perform pg_temp.assert_true(
    public.record_async_task_unknown_observation(task_lease.id, repeat('7', 64), repeat('8', 64)),
    'provider unknown observation persists even after the worker lease expires'
  );
  perform pg_temp.assert_true(
    public.reconcile_unknown_async_task(task_lease.id, repeat('9', 64), 'retry', 'provider_unobserved', null) = 'fenced',
    'unknown reconciliation fails closed for the wrong observation hash'
  );
  perform pg_temp.assert_true(
    public.reconcile_unknown_async_task(task_lease.id, repeat('8', 64), 'retry', 'provider_unobserved', null) = 'retry_wait',
    'observed unknown outcome can be reconciled to bounded retry'
  );
  select * into replacement_lease from public.lease_async_task('u6-unknown-replacement', interval '2 minutes');
  perform pg_temp.assert_true(replacement_lease.id = task_lease.id, 'reconciled retry becomes runnable');
  perform public.complete_async_task(
    replacement_lease.id, replacement_lease.lease_generation,
    replacement_lease.lease_token, null
  );
end;
$test$;

select pg_temp.assert_true(
  public.u6_readable_safe_storage_organization(
    'safe/caaaaaaa-0000-4000-8000-000000000001/caaa0000-0000-4000-8000-000000000001/proxy.jpg'
  ) = 'caaaaaaa-0000-4000-8000-000000000001'::uuid
  and public.u6_readable_safe_storage_organization(
    'quarantine/caaaaaaa-0000-4000-8000-000000000001/caaa0000-0000-4000-8000-000000000001/original.jpg'
  ) is null
  and public.u6_readable_safe_storage_organization('safe/not-a-uuid/proxy.jpg') is null,
  'storage policy resolves only tenant-scoped safe-derivative paths'
);

rollback;
