-- U6: staged evidence sync, quarantine assessments, reconciliation and durable tasks.

create table if not exists public.artifact_upload_intents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  job_id uuid not null,
  artifact_id uuid not null,
  capture_id uuid not null,
  storage_key text not null check (length(btrim(storage_key)) between 1 and 1024),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_byte_size bigint not null check (expected_byte_size > 0),
  expected_media_type text not null check (expected_media_type in ('image/jpeg', 'image/heic', 'audio/m4a', 'audio/wav')),
  upload_token_sha256 text not null check (upload_token_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'issued' check (state in ('issued', 'uploaded', 'finalized', 'expired', 'rejected')),
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  unique (organization_id, storage_key),
  unique (id, organization_id)
);

create index if not exists artifact_upload_intents_expiry_idx
  on public.artifact_upload_intents (state, expires_at);

create table if not exists public.artifact_content_assessments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  artifact_id uuid not null,
  assessment_state text not null check (assessment_state in ('accepted', 'rejected')),
  reason_code text,
  observed_media_type text,
  observed_width integer check (observed_width is null or observed_width > 0),
  observed_height integer check (observed_height is null or observed_height > 0),
  observed_duration_ms bigint check (observed_duration_ms is null or observed_duration_ms > 0),
  decoder_version text not null check (length(btrim(decoder_version)) between 1 and 120),
  safe_proxy_artifact_id uuid,
  assessed_at timestamptz not null default statement_timestamp(),
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  foreign key (safe_proxy_artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (organization_id, artifact_id),
  unique (id, organization_id),
  check (
    (assessment_state = 'accepted' and safe_proxy_artifact_id is not null and reason_code is null)
    or (assessment_state = 'rejected' and safe_proxy_artifact_id is null and reason_code is not null)
  )
);

create table if not exists public.artifact_reconciliation_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  artifact_id uuid,
  storage_key text not null,
  reconciliation_state text not null check (reconciliation_state in (
    'consistent', 'object_only', 'row_only', 'missing_object', 'divergent_checksum',
    'duplicate_attempt', 'unknown_provider', 'content_quarantine', 'deletion_suppression'
  )),
  safe_detail_code text not null check (safe_detail_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  observed_at timestamptz not null default statement_timestamp(),
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

drop trigger if exists artifact_content_assessments_reject_mutation on public.artifact_content_assessments;
create trigger artifact_content_assessments_reject_mutation
before update or delete on public.artifact_content_assessments
for each row execute function public.u2_reject_mutation();

create or replace function public.u6_validate_safe_proxy_assessment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.assessment_state = 'accepted' and not exists (
    select 1
    from public.artifacts proxy
    join public.artifact_derivations derivation
      on derivation.derived_artifact_id = proxy.id
     and derivation.organization_id = proxy.organization_id
    where proxy.id = new.safe_proxy_artifact_id
      and proxy.organization_id = new.organization_id
      and proxy.artifact_kind = 'safe_proxy'
      and proxy.quarantine_state = 'accepted'
      and proxy.storage_key like concat('safe/', new.organization_id::text, '/%')
      and derivation.parent_artifact_id = new.artifact_id
      and derivation.transformation in ('metadata_strip', 'safe_decode')
  ) then
    raise exception using errcode = '23514', message = 'accepted assessment requires a tenant-scoped safe proxy with provenance';
  end if;
  return new;
end;
$function$;

drop trigger if exists artifact_content_assessments_validate_proxy on public.artifact_content_assessments;
create trigger artifact_content_assessments_validate_proxy
before insert on public.artifact_content_assessments
for each row execute function public.u6_validate_safe_proxy_assessment();

drop trigger if exists artifact_reconciliation_observations_reject_mutation on public.artifact_reconciliation_observations;
create trigger artifact_reconciliation_observations_reject_mutation
before update or delete on public.artifact_reconciliation_observations
for each row execute function public.u2_reject_mutation();

alter table public.async_tasks
  add column if not exists packet_id uuid,
  add column if not exists packet_revision bigint check (packet_revision is null or packet_revision > 0),
  add column if not exists superseded_by_revision bigint check (superseded_by_revision is null or superseded_by_revision > 0),
  add column if not exists unknown_reconciliation_hash text check (unknown_reconciliation_hash is null or unknown_reconciliation_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists dead_lettered_at timestamptz;

do $block$
declare constraint_name text;
begin
  select c.conname into constraint_name
  from pg_constraint c
  where c.conrelid = 'public.async_tasks'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%state%queued%running%retry_wait%succeeded%';
  if constraint_name is not null then
    execute format('alter table public.async_tasks drop constraint %I', constraint_name);
  end if;
end;
$block$;

alter table public.async_tasks
  add constraint async_tasks_u6_state_check check (state in (
    'queued', 'running', 'retry_wait', 'succeeded', 'unknown', 'cancelled',
    'dead_letter', 'superseded'
  )),
  add constraint async_tasks_u6_packet_check check (
    (packet_id is null and packet_revision is null)
    or (packet_id is not null and packet_revision is not null)
  );

create table if not exists public.async_task_dependencies (
  organization_id uuid not null,
  task_id uuid not null,
  depends_on_task_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (task_id, depends_on_task_id),
  foreign key (task_id, organization_id) references public.async_tasks(id, organization_id) on delete restrict,
  foreign key (depends_on_task_id, organization_id) references public.async_tasks(id, organization_id) on delete restrict,
  check (task_id <> depends_on_task_id)
);

create or replace function public.u6_reject_task_dependency_cycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if exists (
    with recursive chain(task_id) as (
      select new.depends_on_task_id
      union
      select dependency.depends_on_task_id
      from public.async_task_dependencies dependency
      join chain on dependency.task_id = chain.task_id
      where dependency.organization_id = new.organization_id
    )
    select 1 from chain where task_id = new.task_id
  ) then
    raise exception using errcode = '23514', message = 'async task dependency cycle is not allowed';
  end if;
  return new;
end;
$function$;

drop trigger if exists async_task_dependencies_reject_cycle on public.async_task_dependencies;
create trigger async_task_dependencies_reject_cycle
before insert on public.async_task_dependencies
for each row execute function public.u6_reject_task_dependency_cycle();

create or replace function public.u6_sha256_array_is_valid(values_to_check text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select coalesce(bool_and(value ~ '^[0-9a-f]{64}$'), true)
  from unnest(values_to_check) as item(value)
$function$;

create table if not exists public.async_task_checkpoints (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null,
  lease_generation bigint not null check (lease_generation > 0),
  checkpoint_name text not null check (checkpoint_name ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  artifact_refs uuid[] not null default '{}'::uuid[],
  metadata_hashes text[] not null default '{}'::text[],
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (task_id, organization_id) references public.async_tasks(id, organization_id) on delete restrict,
  unique (organization_id, task_id, lease_generation, checkpoint_name),
  unique (id, organization_id),
  check (public.u6_sha256_array_is_valid(metadata_hashes))
);

drop trigger if exists async_task_checkpoints_reject_mutation on public.async_task_checkpoints;
create trigger async_task_checkpoints_reject_mutation
before update or delete on public.async_task_checkpoints
for each row execute function public.u2_reject_mutation();

drop trigger if exists artifact_upload_intents_touch_updated_at on public.artifact_upload_intents;
create trigger artifact_upload_intents_touch_updated_at
before update on public.artifact_upload_intents
for each row execute function public.u2_touch_updated_at();

create or replace function public.u6_append_task_event(
  target_task public.async_tasks,
  target_event_type text,
  target_safe_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  next_event_version bigint;
  previous_event_hash text;
  metadata_sha256 text;
begin
  if target_event_type !~ '^(tool|system)\.[a-z0-9_]+' or jsonb_typeof(target_safe_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid safe task event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    target_task.organization_id::text || ':async_task:' || target_task.id::text, 0
  ));
  select coalesce(max(e.aggregate_version), 0) + 1,
         (array_agg(e.event_sha256 order by e.aggregate_version desc))[1]
    into next_event_version, previous_event_hash
  from public.session_events e
  where e.organization_id = target_task.organization_id
    and e.aggregate_type = 'async_task'
    and e.aggregate_id = target_task.id;
  metadata_sha256 := encode(extensions.digest(
    convert_to(target_safe_metadata::text, 'UTF8'), 'sha256'
  ), 'hex');
  insert into public.session_events (
    organization_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, safe_metadata, payload_sha256, previous_event_sha256,
    event_sha256
  ) values (
    target_task.organization_id, 'async_task', target_task.id,
    next_event_version, target_event_type, target_safe_metadata,
    metadata_sha256, previous_event_hash, repeat('0', 64)
  );
end;
$function$;

create or replace function public.record_verified_artifact_durability(
  target_organization_id uuid,
  target_job_id uuid,
  target_artifact_id uuid,
  target_capture_id uuid,
  target_capture_sequence bigint,
  target_artifact_kind text,
  expected_sha256 text,
  expected_byte_size bigint,
  expected_media_type text,
  target_storage_key text,
  target_captured_at timestamptz,
  target_capture_area text,
  target_device_id uuid,
  observed_sha256 text,
  observed_byte_size bigint,
  observed_object_version text,
  object_is_readable boolean,
  durability_idempotency_key text
)
returns table (result_state text, result_artifact_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  existing_artifact public.artifacts%rowtype;
  expected_prefix text;
  next_event_version bigint;
  previous_event_hash text;
  content_task public.async_tasks%rowtype;
begin
  if not object_is_readable
    or expected_sha256 !~ '^[0-9a-f]{64}$'
    or observed_sha256 is distinct from expected_sha256
    or observed_byte_size is distinct from expected_byte_size
    or expected_byte_size <= 0
    or length(btrim(observed_object_version)) = 0
  then
    raise exception using errcode = '23514', message = 'independent durability observation does not match the upload descriptor';
  end if;

  expected_prefix := concat(
    'quarantine/', target_organization_id::text, '/', target_job_id::text, '/',
    target_capture_id::text, '/', target_artifact_id::text, '.'
  );
  if target_storage_key not like expected_prefix || '%' or position('..' in target_storage_key) > 0 then
    raise exception using errcode = '23514', message = 'storage key is outside the tenant/job/capture staging path';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_capture_id::text, 0));
  select * into existing_artifact
  from public.artifacts a
  where a.organization_id = target_organization_id
    and a.capture_id = target_capture_id;

  if found then
    if existing_artifact.content_sha256 is distinct from observed_sha256
      or existing_artifact.byte_size is distinct from observed_byte_size
    then
      insert into public.artifact_reconciliation_observations (
        organization_id, artifact_id, storage_key, reconciliation_state, safe_detail_code
      ) values (
        target_organization_id, existing_artifact.id, target_storage_key,
        'divergent_checksum', 'capture_hash_divergence'
      );
      return query select 'hash_divergence'::text, existing_artifact.id;
      return;
    end if;
    insert into public.artifact_reconciliation_observations (
      organization_id, artifact_id, storage_key, reconciliation_state, safe_detail_code
    ) values (
      target_organization_id, existing_artifact.id, target_storage_key,
      'duplicate_attempt', 'capture_finalize_replayed'
    );
    return query select 'duplicate_attempt'::text, existing_artifact.id;
    return;
  end if;

  insert into public.artifacts (
    id, organization_id, job_id, capture_id, capture_sequence, artifact_kind,
    content_sha256, byte_size, media_type, storage_key, capture_area, captured_at,
    device_id, quarantine_state
  ) values (
    target_artifact_id, target_organization_id, target_job_id, target_capture_id,
    target_capture_sequence, target_artifact_kind, observed_sha256, observed_byte_size,
    expected_media_type, target_storage_key, target_capture_area, target_captured_at,
    target_device_id, 'pending'
  );

  insert into public.artifact_durability_receipts (
    organization_id, artifact_id, object_version, observed_sha256, observed_byte_size
  ) values (
    target_organization_id, target_artifact_id, observed_object_version,
    observed_sha256, observed_byte_size
  );

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':artifact:' || target_artifact_id::text, 0));
  select coalesce(max(e.aggregate_version), 0) + 1,
         (array_agg(e.event_sha256 order by e.aggregate_version desc))[1]
    into next_event_version, previous_event_hash
  from public.session_events e
  where e.organization_id = target_organization_id
    and e.aggregate_type = 'artifact'
    and e.aggregate_id = target_artifact_id;

  insert into public.session_events (
    organization_id, aggregate_type, aggregate_id, aggregate_version, event_type,
    idempotency_key, safe_metadata, protected_artifact_refs, payload_sha256,
    previous_event_sha256, event_sha256
  ) values (
    target_organization_id, 'artifact', target_artifact_id, next_event_version,
    'artifact.durability_verified', durability_idempotency_key,
    jsonb_build_object(
      'byte_size', observed_byte_size,
      'object_version', observed_object_version,
      'sha256', observed_sha256,
      'storage_scope', 'tenant_quarantine'
    ), array[target_artifact_id], observed_sha256, previous_event_hash, repeat('0', 64)
  );

  insert into public.async_tasks (
    organization_id, task_type, aggregate_type, aggregate_id,
    idempotency_key, request_fingerprint, state, max_attempts
  ) values (
    target_organization_id, 'content.validate_and_proxy', 'artifact', target_artifact_id,
    concat('content:', target_artifact_id::text), observed_sha256, 'queued', 5
  )
  returning * into content_task;

  perform public.u6_append_task_event(
    content_task, 'system.task_enqueued',
    jsonb_build_object('task_type', 'content.validate_and_proxy')
  );

  insert into public.outbox_records (
    organization_id, async_task_id, destination, action, aggregate_type,
    aggregate_id, idempotency_key, request_fingerprint, state,
    provider_observation_ref
  ) values (
    target_organization_id, content_task.id, 'internal_task_queue',
    'content.validate_and_proxy', 'artifact', target_artifact_id,
    concat('outbox:content:', target_artifact_id::text), observed_sha256,
    'observed_success', 'task_enqueued_atomically'
  );

  return query select 'recorded'::text, target_artifact_id;
end;
$function$;

create or replace function public.lease_async_task(worker_id text, lease_for interval default interval '2 minutes')
returns setof public.async_tasks
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  candidate_id uuid;
  task_row public.async_tasks%rowtype;
begin
  if worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
    or lease_for <= interval '0 seconds' or lease_for > interval '15 minutes'
  then
    raise exception using errcode = '22023', message = 'invalid worker lease request';
  end if;

  for task_row in
    update public.async_tasks t
    set state = case when t.attempt_count < t.max_attempts then 'retry_wait' else 'dead_letter' end,
        last_error_code = 'lease_expired',
        dead_lettered_at = case when t.attempt_count < t.max_attempts then null else statement_timestamp() end,
        available_at = statement_timestamp(),
        lease_token = null,
        leased_by = null,
        leased_until = null,
        heartbeat_at = null
    where t.state = 'running' and t.leased_until < statement_timestamp()
    returning t.*
  loop
    perform public.u6_append_task_event(
      task_row,
      case when task_row.state = 'retry_wait' then 'system.task_retry' else 'system.task_dead_lettered' end,
      jsonb_build_object('error_code', 'lease_expired', 'attempt', task_row.attempt_count)
    );
  end loop;

  for task_row in
    update public.async_tasks t
    set state = 'cancelled', last_error_code = 'dependency_terminal'
    where t.state in ('queued', 'retry_wait')
      and exists (
        select 1
        from public.async_task_dependencies dependency
        join public.async_tasks required_task
          on required_task.id = dependency.depends_on_task_id
         and required_task.organization_id = dependency.organization_id
        where dependency.task_id = t.id
          and dependency.organization_id = t.organization_id
          and required_task.state in ('dead_letter', 'cancelled', 'superseded')
      )
    returning t.*
  loop
    perform public.u6_append_task_event(
      task_row, 'system.task_cancelled',
      jsonb_build_object('reason_code', 'dependency_terminal')
    );
  end loop;

  select t.id into candidate_id
    from public.async_tasks t
    where t.state in ('queued', 'retry_wait')
      and t.available_at <= statement_timestamp()
      and t.attempt_count < t.max_attempts
      and not exists (
        select 1
        from public.async_task_dependencies d
        left join public.async_tasks required_task
          on required_task.id = d.depends_on_task_id
         and required_task.organization_id = d.organization_id
        where d.task_id = t.id
          and d.organization_id = t.organization_id
          and required_task.state is distinct from 'succeeded'
      )
    order by t.available_at, t.created_at, t.id
    for update skip locked
    limit 1;
  if candidate_id is null then return; end if;

  update public.async_tasks t
  set state = 'running',
      attempt_count = t.attempt_count + 1,
      lease_generation = t.lease_generation + 1,
      lease_token = extensions.gen_random_uuid(),
      leased_by = worker_id,
      leased_until = statement_timestamp() + lease_for,
      heartbeat_at = statement_timestamp()
  where t.id = candidate_id
  returning t.* into task_row;
  perform public.u6_append_task_event(
    task_row, 'tool.task_lease_started',
    jsonb_build_object(
      'attempt', task_row.attempt_count,
      'generation', task_row.lease_generation,
      'worker_id', worker_id
    )
  );
  return next task_row;
  return;
end;
$function$;

create or replace function public.complete_async_task(
  task_id uuid,
  expected_generation bigint,
  expected_lease_token uuid,
  result_artifact uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  changed integer;
  task_row public.async_tasks%rowtype;
begin
  update public.async_tasks t
  set state = 'succeeded',
      result_artifact_id = result_artifact,
      lease_token = null,
      leased_by = null,
      leased_until = null,
      heartbeat_at = null
  where t.id = task_id
    and t.state = 'running'
    and t.lease_generation = expected_generation
    and t.lease_token = expected_lease_token
    and t.leased_until >= statement_timestamp()
  returning t.* into task_row;
  get diagnostics changed = row_count;
  if changed = 1 then
    perform public.u6_append_task_event(
      task_row, 'system.task_completed',
      jsonb_build_object(
        'generation', expected_generation,
        'result_recorded', result_artifact is not null
      )
    );
  end if;
  return changed = 1;
end;
$function$;

create or replace function public.heartbeat_async_task(
  task_id uuid,
  expected_generation bigint,
  expected_lease_token uuid,
  extend_for interval default interval '2 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare changed integer; task_row public.async_tasks%rowtype;
begin
  if extend_for <= interval '0 seconds' or extend_for > interval '15 minutes' then
    raise exception using errcode = '22023', message = 'invalid heartbeat extension';
  end if;
  update public.async_tasks t
  set heartbeat_at = statement_timestamp(), leased_until = statement_timestamp() + extend_for
  where t.id = task_id and t.state = 'running'
    and t.lease_generation = expected_generation
    and t.lease_token = expected_lease_token
    and t.leased_until >= statement_timestamp()
  returning t.* into task_row;
  get diagnostics changed = row_count;
  if changed = 1 then
    perform public.u6_append_task_event(
      task_row, 'tool.task_lease_heartbeat',
      jsonb_build_object('generation', expected_generation)
    );
  end if;
  return changed = 1;
end;
$function$;

create or replace function public.checkpoint_async_task(
  task_id uuid,
  expected_generation bigint,
  expected_lease_token uuid,
  checkpoint_name text,
  artifact_refs uuid[] default '{}'::uuid[],
  metadata_hashes text[] default '{}'::text[]
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare target_organization_id uuid;
begin
  select t.organization_id into target_organization_id
  from public.async_tasks t
  where t.id = task_id and t.state = 'running'
    and t.lease_generation = expected_generation
    and t.lease_token = expected_lease_token
    and t.leased_until >= statement_timestamp()
  for update;
  if not found then return false; end if;
  insert into public.async_task_checkpoints (
    organization_id, task_id, lease_generation, checkpoint_name, artifact_refs, metadata_hashes
  ) values (
    target_organization_id, task_id, expected_generation, checkpoint_name, artifact_refs, metadata_hashes
  );
  perform public.u6_append_task_event(
    (select t from public.async_tasks t where t.id = task_id),
    'tool.task_checkpoint',
    jsonb_build_object(
      'generation', expected_generation,
      'checkpoint_name', checkpoint_name,
      'artifact_ref_count', cardinality(artifact_refs),
      'metadata_hash_count', cardinality(metadata_hashes)
    )
  );
  return true;
end;
$function$;

create or replace function public.fail_async_task(
  task_id uuid,
  expected_generation bigint,
  expected_lease_token uuid,
  safe_error_code text,
  is_retryable boolean,
  retry_after interval default interval '1 second'
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare changed integer; resulting_state text; task_row public.async_tasks%rowtype;
begin
  if safe_error_code !~ '^[a-z][a-z0-9_.-]{0,79}$' or retry_after < interval '0 seconds' or retry_after > interval '1 day' then
    raise exception using errcode = '22023', message = 'invalid task failure metadata';
  end if;
  update public.async_tasks t
  set state = case when is_retryable and t.attempt_count < t.max_attempts then 'retry_wait' else 'dead_letter' end,
      available_at = statement_timestamp() + retry_after,
      last_error_code = safe_error_code,
      dead_lettered_at = case when is_retryable and t.attempt_count < t.max_attempts then null else statement_timestamp() end,
      lease_token = null, leased_by = null, leased_until = null, heartbeat_at = null
  where t.id = task_id and t.state = 'running'
    and t.lease_generation = expected_generation
    and t.lease_token = expected_lease_token
    and t.leased_until >= statement_timestamp()
  returning t.* into task_row;
  get diagnostics changed = row_count;
  if changed = 0 then return 'fenced'; end if;
  resulting_state := task_row.state;
  perform public.u6_append_task_event(
    task_row,
    case when resulting_state = 'retry_wait' then 'system.task_retry' else 'system.task_dead_lettered' end,
    jsonb_build_object('attempt', task_row.attempt_count, 'error_code', safe_error_code)
  );
  return resulting_state;
end;
$function$;

create or replace function public.mark_async_task_unknown(
  task_id uuid,
  expected_generation bigint,
  expected_lease_token uuid,
  reconciliation_key_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare changed integer; task_row public.async_tasks%rowtype;
begin
  if reconciliation_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid reconciliation key hash';
  end if;
  update public.async_tasks t
  set state = 'unknown', unknown_reconciliation_hash = reconciliation_key_hash,
      lease_token = null, leased_by = null, leased_until = null, heartbeat_at = null
  where t.id = task_id and t.state = 'running'
    and t.lease_generation = expected_generation
    and t.lease_token = expected_lease_token
    and t.leased_until >= statement_timestamp()
  returning t.* into task_row;
  get diagnostics changed = row_count;
  if changed = 1 then
    perform public.u6_append_task_event(
      task_row, 'system.task_unknown',
      jsonb_build_object('reconciliation_key_hash', reconciliation_key_hash)
    );
  end if;
  return changed = 1;
end;
$function$;

create or replace function public.record_async_task_unknown_observation(
  task_id uuid,
  expected_request_fingerprint text,
  reconciliation_key_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare task_row public.async_tasks%rowtype;
begin
  if expected_request_fingerprint !~ '^[0-9a-f]{64}$'
    or reconciliation_key_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid provider observation hash';
  end if;
  select * into task_row from public.async_tasks t where t.id = task_id for update;
  if not found or task_row.request_fingerprint is distinct from expected_request_fingerprint then
    return false;
  end if;
  if task_row.state = 'unknown' then
    if task_row.unknown_reconciliation_hash is distinct from reconciliation_key_hash then
      raise exception using errcode = '23514', message = 'provider unknown observation diverged';
    end if;
    return true;
  end if;
  if task_row.state in ('succeeded', 'dead_letter', 'cancelled', 'superseded') then
    return false;
  end if;
  update public.async_tasks t
  set state = 'unknown', unknown_reconciliation_hash = reconciliation_key_hash,
      lease_token = null, leased_by = null, leased_until = null, heartbeat_at = null
  where t.id = task_id
  returning t.* into task_row;
  perform public.u6_append_task_event(
    task_row, 'system.task_unknown',
    jsonb_build_object('reconciliation_key_hash', reconciliation_key_hash)
  );
  return true;
end;
$function$;

create or replace function public.reconcile_unknown_async_task(
  task_id uuid,
  expected_reconciliation_hash text,
  observed_state text,
  safe_result_code text,
  result_artifact uuid default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare task_row public.async_tasks%rowtype; resulting_state text;
begin
  if expected_reconciliation_hash !~ '^[0-9a-f]{64}$'
    or observed_state not in ('succeeded', 'retry', 'failed')
    or safe_result_code !~ '^[a-z][a-z0-9_.-]{0,79}$'
  then
    raise exception using errcode = '22023', message = 'invalid unknown reconciliation observation';
  end if;
  select * into task_row
  from public.async_tasks t
  where t.id = task_id
    and t.state = 'unknown'
    and t.unknown_reconciliation_hash = expected_reconciliation_hash
  for update;
  if not found then return 'fenced'; end if;
  resulting_state := case
    when observed_state = 'succeeded' then 'succeeded'
    when observed_state = 'retry' and task_row.attempt_count < task_row.max_attempts then 'retry_wait'
    else 'dead_letter'
  end;
  update public.async_tasks t
  set state = resulting_state,
      result_artifact_id = case when resulting_state = 'succeeded' then result_artifact else null end,
      available_at = statement_timestamp(),
      last_error_code = case when resulting_state = 'succeeded' then null else safe_result_code end,
      dead_lettered_at = case when resulting_state = 'dead_letter' then statement_timestamp() else null end
  where t.id = task_id
  returning t.* into task_row;
  perform public.u6_append_task_event(
    task_row,
    case
      when resulting_state = 'succeeded' then 'system.task_completed'
      when resulting_state = 'retry_wait' then 'system.task_retry'
      else 'system.task_dead_lettered'
    end,
    jsonb_build_object('reconciled', true, 'result_code', safe_result_code)
  );
  return resulting_state;
end;
$function$;

create or replace function public.record_content_assessment_under_lease(
  task_id uuid,
  expected_generation bigint,
  expected_lease_token uuid,
  target_artifact_id uuid,
  target_assessment_state text,
  target_reason_code text,
  target_observed_media_type text,
  target_observed_width integer,
  target_observed_height integer,
  target_observed_duration_ms bigint,
  target_decoder_version text,
  target_safe_proxy_artifact_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare task_row public.async_tasks%rowtype;
begin
  if target_assessment_state not in ('accepted', 'rejected')
    or (target_reason_code is not null and target_reason_code !~ '^[a-z][a-z0-9_.-]{0,79}$')
  then
    raise exception using errcode = '22023', message = 'invalid content assessment metadata';
  end if;
  select * into task_row
  from public.async_tasks t
  where t.id = task_id and t.state = 'running'
    and t.lease_generation = expected_generation
    and t.lease_token = expected_lease_token
    and t.leased_until >= statement_timestamp()
    and t.aggregate_type = 'artifact'
    and t.aggregate_id = target_artifact_id
  for update;
  if not found then return false; end if;
  insert into public.artifact_content_assessments (
    organization_id, artifact_id, assessment_state, reason_code,
    observed_media_type, observed_width, observed_height, observed_duration_ms,
    decoder_version, safe_proxy_artifact_id
  ) values (
    task_row.organization_id, target_artifact_id, target_assessment_state,
    target_reason_code, target_observed_media_type, target_observed_width,
    target_observed_height, target_observed_duration_ms, target_decoder_version,
    target_safe_proxy_artifact_id
  );
  perform public.u6_append_task_event(
    task_row, 'tool.content_assessment_committed',
    jsonb_build_object(
      'generation', expected_generation,
      'assessment_state', target_assessment_state,
      'reason_code', coalesce(target_reason_code, 'accepted')
    )
  );
  return true;
end;
$function$;

create or replace function public.u6_readable_safe_storage_organization(object_name text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare organization_segment text;
begin
  if split_part(object_name, '/', 1) <> 'safe' then return null; end if;
  organization_segment := split_part(object_name, '/', 2);
  if organization_segment !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return organization_segment::uuid;
end;
$function$;

-- Client uploads are service-mediated through tenant/job-scoped intents. Only
-- accepted safe derivatives are directly readable by authenticated staff.
do $block$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists inspection_evidence_staff_read on storage.objects';
    execute 'drop policy if exists inspection_evidence_staff_insert on storage.objects';
    execute $policy$
      create policy inspection_evidence_staff_read on storage.objects for select to authenticated
      using (
        bucket_id = 'inspection-evidence'
        and public.is_organization_member(public.u6_readable_safe_storage_organization(name))
      )
    $policy$;
  end if;
end;
$block$;

create or replace function public.supersede_packet_tasks(
  target_organization_id uuid,
  target_packet_id uuid,
  newer_packet_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare changed bigint := 0; task_row public.async_tasks%rowtype;
begin
  if newer_packet_revision < 1 then
    raise exception using errcode = '22023', message = 'invalid packet revision';
  end if;
  for task_row in
    update public.async_tasks t
    set state = 'superseded', superseded_by_revision = newer_packet_revision,
        lease_token = null, leased_by = null, leased_until = null, heartbeat_at = null
    where t.organization_id = target_organization_id
      and t.packet_id = target_packet_id
      and t.packet_revision < newer_packet_revision
      and t.state not in ('dead_letter', 'cancelled', 'superseded')
    returning t.*
  loop
    changed := changed + 1;
    perform public.u6_append_task_event(
      task_row, 'system.task_superseded',
      jsonb_build_object('newer_packet_revision', newer_packet_revision)
    );
  end loop;
  return changed;
end;
$function$;

revoke all on table public.artifact_upload_intents, public.artifact_content_assessments,
  public.artifact_reconciliation_observations, public.async_task_dependencies,
  public.async_task_checkpoints from anon, authenticated;
grant select, insert, update on table public.artifact_upload_intents to service_role;
grant select on table public.artifact_content_assessments to service_role;
grant select, insert on table public.artifact_reconciliation_observations, public.async_task_dependencies,
  public.async_task_checkpoints to service_role;

alter table public.artifact_upload_intents enable row level security;
alter table public.artifact_content_assessments enable row level security;
alter table public.artifact_reconciliation_observations enable row level security;
alter table public.async_task_dependencies enable row level security;
alter table public.async_task_checkpoints enable row level security;
alter table public.artifact_upload_intents force row level security;
alter table public.artifact_content_assessments force row level security;
alter table public.artifact_reconciliation_observations force row level security;
alter table public.async_task_dependencies force row level security;
alter table public.async_task_checkpoints force row level security;

revoke all on function public.u6_sha256_array_is_valid(text[]) from public, anon, authenticated;
revoke all on function public.u6_validate_safe_proxy_assessment() from public, anon, authenticated;
revoke all on function public.u6_reject_task_dependency_cycle() from public, anon, authenticated;
revoke all on function public.u6_append_task_event(public.async_tasks, text, jsonb) from public, anon, authenticated;
grant execute on function public.u6_sha256_array_is_valid(text[]) to service_role;

revoke all on function public.record_verified_artifact_durability(
  uuid, uuid, uuid, uuid, bigint, text, text, bigint, text, text,
  timestamptz, text, uuid, text, bigint, text, boolean, text
) from public, anon, authenticated;
revoke all on function public.heartbeat_async_task(uuid, bigint, uuid, interval) from public, anon, authenticated;
revoke all on function public.checkpoint_async_task(uuid, bigint, uuid, text, uuid[], text[]) from public, anon, authenticated;
revoke all on function public.fail_async_task(uuid, bigint, uuid, text, boolean, interval) from public, anon, authenticated;
revoke all on function public.mark_async_task_unknown(uuid, bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.record_async_task_unknown_observation(uuid, text, text) from public, anon, authenticated;
revoke all on function public.reconcile_unknown_async_task(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_content_assessment_under_lease(uuid, bigint, uuid, uuid, text, text, text, integer, integer, bigint, text, uuid) from public, anon, authenticated;
revoke all on function public.supersede_packet_tasks(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.u6_readable_safe_storage_organization(text) from public, anon;
grant execute on function public.record_verified_artifact_durability(
  uuid, uuid, uuid, uuid, bigint, text, text, bigint, text, text,
  timestamptz, text, uuid, text, bigint, text, boolean, text
) to service_role;
grant execute on function public.heartbeat_async_task(uuid, bigint, uuid, interval) to service_role;
grant execute on function public.checkpoint_async_task(uuid, bigint, uuid, text, uuid[], text[]) to service_role;
grant execute on function public.fail_async_task(uuid, bigint, uuid, text, boolean, interval) to service_role;
grant execute on function public.mark_async_task_unknown(uuid, bigint, uuid, text) to service_role;
grant execute on function public.record_async_task_unknown_observation(uuid, text, text) to service_role;
grant execute on function public.reconcile_unknown_async_task(uuid, text, text, text, uuid) to service_role;
grant execute on function public.record_content_assessment_under_lease(uuid, bigint, uuid, uuid, text, text, text, integer, integer, bigint, text, uuid) to service_role;
grant execute on function public.supersede_packet_tasks(uuid, uuid, bigint) to service_role;
grant execute on function public.u6_readable_safe_storage_organization(text) to authenticated, service_role;
