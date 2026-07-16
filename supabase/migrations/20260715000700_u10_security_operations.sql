-- U10: durable privileged-session and device enforcement, command-only
-- approval boundaries, restore egress state, and bounded secret rotation.
-- No credential, report content, address, recipient detail, or artifact payload
-- belongs in these operational tables.

create table if not exists public.registered_devices (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references public.actors(id) on delete restrict,
  public_key_sha256 text not null check (public_key_sha256 ~ '^[0-9a-f]{64}$'),
  display_label text not null check (length(btrim(display_label)) between 1 and 80),
  registered_at timestamptz not null default statement_timestamp(),
  registered_by_actor_id uuid not null references public.actors(id) on delete restrict,
  unique (id, organization_id),
  unique (id, organization_id, actor_id),
  unique (organization_id, actor_id, public_key_sha256)
);

create index if not exists registered_devices_actor_idx
  on public.registered_devices (organization_id, actor_id, registered_at desc);

create table if not exists public.device_presence_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  device_id uuid not null,
  actor_id uuid not null references public.actors(id) on delete restrict,
  event_kind text not null check (event_kind in ('enrolled', 'authenticated', 'reauthenticated')),
  occurred_at timestamptz not null default statement_timestamp(),
  request_id_sha256 text not null check (request_id_sha256 ~ '^[0-9a-f]{64}$'),
  foreign key (device_id, organization_id, actor_id)
    references public.registered_devices(id, organization_id, actor_id) on delete restrict
);

create index if not exists device_presence_latest_idx
  on public.device_presence_events (organization_id, device_id, actor_id, occurred_at desc);

create table if not exists public.device_revocations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  device_id uuid not null,
  revoked_by_actor_id uuid not null references public.actors(id) on delete restrict,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  revoked_at timestamptz not null default statement_timestamp(),
  foreign key (device_id, organization_id)
    references public.registered_devices(id, organization_id) on delete restrict,
  unique (organization_id, device_id)
);

-- A session binding is created only by the trusted auth/device-verification
-- service after it verifies possession of the registered device key. JWT
-- refresh cannot change session_started_at or substitute another device.
create table if not exists public.privileged_session_bindings (
  session_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references public.actors(id) on delete restrict,
  device_id uuid not null,
  session_started_at timestamptz not null,
  bound_at timestamptz not null default statement_timestamp(),
  binding_request_sha256 text not null check (binding_request_sha256 ~ '^[0-9a-f]{64}$'),
  foreign key (device_id, organization_id, actor_id)
    references public.registered_devices(id, organization_id, actor_id) on delete restrict,
  unique (session_id, organization_id, actor_id, device_id),
  check (session_started_at <= bound_at + interval '30 seconds')
);

create index if not exists privileged_session_bindings_actor_idx
  on public.privileged_session_bindings (organization_id, actor_id, bound_at desc);

-- Privileged idle time is projected from activity for the exact bound session,
-- actor, organization and device, not from a caller-selected device heartbeat.
create table if not exists public.privileged_session_activity_events (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null,
  organization_id uuid not null,
  actor_id uuid not null,
  device_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  request_id_sha256 text not null check (request_id_sha256 ~ '^[0-9a-f]{64}$'),
  foreign key (session_id, organization_id, actor_id, device_id)
    references public.privileged_session_bindings(session_id, organization_id, actor_id, device_id)
    on delete restrict
);

create index if not exists privileged_session_activity_latest_idx
  on public.privileged_session_activity_events
    (session_id, organization_id, actor_id, device_id, occurred_at desc);

create table if not exists public.privileged_action_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references public.actors(id) on delete restrict,
  device_id uuid,
  action_name text not null check (action_name in (
    'approve_module', 'deliver_report', 'share_report', 'revoke_access',
    'withdraw_report', 'create_amendment', 'export_protected_data',
    'place_lifecycle_hold', 'revoke_device', 'rotate_secret',
    'enable_restore_egress', 'disable_restore_egress'
  )),
  assurance_level text not null check (assurance_level in ('aal1', 'aal2', 'unknown')),
  outcome text not null check (outcome in ('allowed', 'denied', 'failed', 'completed')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  target_sha256 text check (target_sha256 is null or target_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key_sha256 text not null check (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  request_fingerprint_sha256 text not null check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  result_record_id uuid,
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (device_id, organization_id)
    references public.registered_devices(id, organization_id) on delete restrict,
  check (outcome <> 'completed' or result_record_id is not null)
);

create index if not exists privileged_action_audit_operations_idx
  on public.privileged_action_audit (organization_id, outcome, recorded_at desc);

-- Denials are independently append-only attempts. Only a completed side effect
-- owns an idempotency identity, so a later authorised retry can complete while
-- every earlier denied decision remains visible.
create unique index if not exists privileged_action_completed_idempotency_idx
  on public.privileged_action_audit (organization_id, idempotency_key_sha256)
  where outcome = 'completed';

-- Rate-limit identity is a keyed one-way digest computed by a trusted server
-- boundary. The database owns the clock, fixed policies, limits and atomic
-- consumption so horizontally scaled processes cannot each grant a full
-- independent allowance.
create table if not exists public.rate_limit_buckets (
  policy_name text not null check (policy_name in (
    'recipient_access', 'privileged_action', 'provider_callback', 'booking_quote'
  )),
  opaque_key_sha256 text not null check (opaque_key_sha256 ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  consumed_count integer not null check (consumed_count > 0),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (policy_name, opaque_key_sha256, window_started_at),
  check (
    window_started_at = date_trunc('minute', window_started_at)
    and updated_at >= window_started_at
    and updated_at < window_started_at + interval '1 minute'
  )
);

create index if not exists rate_limit_buckets_retention_idx
  on public.rate_limit_buckets (
    window_started_at, policy_name, opaque_key_sha256
  );

-- Every restore creates a monotonically newer generation. Merely starting the
-- next generation invalidates all enablement from older backups for the same
-- tenant/environment; callers cannot nominate an older still-enabled session.
create table if not exists public.restore_generations (
  restore_session_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  environment_name text not null check (environment_name in ('development', 'test', 'preview', 'production')),
  generation bigint not null check (generation > 0),
  source_manifest_sha256 text not null check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  initiated_by_actor_id uuid references public.actors(id) on delete restrict,
  initiated_at timestamptz not null default statement_timestamp(),
  unique (organization_id, environment_name, generation),
  unique (restore_session_id, organization_id, environment_name, generation)
);

create index if not exists restore_generations_current_idx
  on public.restore_generations (organization_id, environment_name, generation desc);

create table if not exists public.restore_reconciliation_checks (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  restore_session_id uuid not null,
  environment_name text not null check (environment_name in ('development', 'test', 'preview', 'production')),
  restore_generation bigint not null check (restore_generation > 0),
  verification_run bigint not null check (verification_run > 0),
  check_name text not null check (check_name in (
    'artifact_checksums', 'event_replay', 'recipient_grants', 'deletion_suppressions',
    'session_revocations', 'package_pointers', 'provider_truth', 'secret_environment'
  )),
  verdict text not null check (verdict in ('passed', 'failed')),
  violation_count bigint not null check (violation_count >= 0),
  verifier_version text not null check (verifier_version ~ '^restore_sql_v[0-9]+$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  checked_by_actor_id uuid not null references public.actors(id) on delete restrict,
  checked_at timestamptz not null default statement_timestamp(),
  foreign key (restore_session_id, organization_id, environment_name, restore_generation)
    references public.restore_generations(
      restore_session_id, organization_id, environment_name, generation
    ) on delete restrict,
  unique (
    organization_id, restore_session_id, environment_name,
    verification_run, check_name
  ),
  check (
    (verdict = 'passed' and violation_count = 0)
    or (verdict = 'failed' and violation_count > 0)
  )
);

create index if not exists restore_reconciliation_session_idx
  on public.restore_reconciliation_checks (
    organization_id, restore_session_id, environment_name,
    verification_run desc, checked_at
  );

-- Absence of an enabled event is authoritative blocked state. Only the audited
-- enable command below may append enabled events.
create table if not exists public.restore_egress_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  restore_session_id uuid not null,
  environment_name text not null check (environment_name in ('development', 'test', 'preview', 'production')),
  restore_generation bigint not null check (restore_generation > 0),
  event_version bigint not null check (event_version > 0),
  event_kind text not null check (event_kind in ('enabled', 'disabled')),
  recorded_by_actor_id uuid not null references public.actors(id) on delete restrict,
  evidence_projection_sha256 text not null check (evidence_projection_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (restore_session_id, organization_id, environment_name, restore_generation)
    references public.restore_generations(
      restore_session_id, organization_id, environment_name, generation
    ) on delete restrict,
  unique (
    organization_id, restore_session_id, environment_name,
    restore_generation, event_version
  )
);

create index if not exists restore_egress_latest_idx
  on public.restore_egress_events
    (organization_id, environment_name, restore_generation desc, event_version desc);

create table if not exists public.secret_key_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  environment_name text not null check (environment_name in ('development', 'test', 'preview', 'production')),
  purpose text not null check (purpose in ('session_signing', 'capability_signing', 'artifact_encryption', 'webhook_verification')),
  key_id_sha256 text not null check (key_id_sha256 ~ '^[0-9a-f]{64}$'),
  event_kind text not null check (event_kind in ('created', 'activated', 'decrypt_only', 'retired', 'revoked')),
  decrypt_only_until timestamptz,
  recorded_by_actor_id uuid references public.actors(id) on delete restrict,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (environment_name, purpose, key_id_sha256, event_kind),
  check (
    (event_kind = 'decrypt_only'
      and decrypt_only_until is not null
      and decrypt_only_until > recorded_at
      and decrypt_only_until <= recorded_at + interval '30 days')
    or (event_kind <> 'decrypt_only' and decrypt_only_until is null)
  )
);

create or replace function public.request_session_id()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  value text;
begin
  value := auth.jwt() ->> 'session_id';
  if value is null or value = '' then
    return null;
  end if;
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$function$;

create or replace function public.request_assurance_level()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select case auth.jwt() ->> 'aal'
    when 'aal1' then 'aal1'
    when 'aal2' then 'aal2'
    else 'unknown'
  end
$function$;

create or replace function public.request_has_recent_mfa(max_age interval default interval '15 minutes')
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select max_age > interval '0 seconds'
    and max_age <= interval '1 hour'
    and exists (
      select 1
      from jsonb_array_elements(
        case jsonb_typeof(auth.jwt() -> 'amr')
          when 'array' then auth.jwt() -> 'amr'
          else '[]'::jsonb
        end
      ) as method
      where method ->> 'method' in ('totp', 'webauthn', 'mfa')
        and coalesce(method ->> 'timestamp', '') ~ '^[0-9]{9,12}$'
        and to_timestamp((method ->> 'timestamp')::double precision)
          between statement_timestamp() - max_age and statement_timestamp() + interval '30 seconds'
    )
$function$;

create or replace function public.request_bound_device_id(target_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select binding.device_id
  from public.privileged_session_bindings binding
  where binding.session_id = public.request_session_id()
    and binding.organization_id = target_organization_id
    and binding.actor_id = public.request_actor_id()
$function$;

create or replace function public.request_session_is_current(
  target_organization_id uuid,
  max_absolute_age interval default interval '12 hours'
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  jwt jsonb := auth.jwt();
  jwt_iat numeric;
  jwt_exp numeric;
  target_session_id uuid := public.request_session_id();
  target_user_id uuid := auth.uid();
  target_actor_id uuid := public.request_actor_id();
  exists_in_auth boolean := false;
begin
  if max_absolute_age <= interval '0 seconds'
     or max_absolute_age > interval '24 hours'
     or target_session_id is null
     or target_user_id is null
     or target_actor_id is null
     or to_regclass('auth.sessions') is null
     or coalesce(jwt ->> 'iat', '') !~ '^[0-9]{9,12}$'
     or coalesce(jwt ->> 'exp', '') !~ '^[0-9]{9,12}$' then
    return false;
  end if;

  jwt_iat := (jwt ->> 'iat')::numeric;
  jwt_exp := (jwt ->> 'exp')::numeric;
  if to_timestamp(jwt_iat::double precision) > statement_timestamp() + interval '30 seconds'
     or to_timestamp(jwt_exp::double precision) <= statement_timestamp() then
    return false;
  end if;

  execute 'select exists (select 1 from auth.sessions where id = $1 and user_id = $2)'
    into exists_in_auth using target_session_id, target_user_id;

  return coalesce(exists_in_auth, false) and exists (
    select 1
    from public.privileged_session_bindings binding
    where binding.session_id = target_session_id
      and binding.organization_id = target_organization_id
      and binding.actor_id = target_actor_id
      and binding.session_started_at
        between statement_timestamp() - max_absolute_age and statement_timestamp() + interval '30 seconds'
  );
exception when others then
  return false;
end;
$function$;

create or replace function public.request_device_is_active(
  target_organization_id uuid,
  max_idle_age interval default interval '30 minutes'
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select max_idle_age > interval '0 seconds'
    and max_idle_age <= interval '1 hour'
    and exists (
      select 1
      from public.privileged_session_bindings binding
      join public.registered_devices device
        on device.id = binding.device_id
       and device.organization_id = binding.organization_id
       and device.actor_id = binding.actor_id
      where binding.session_id = public.request_session_id()
        and binding.organization_id = target_organization_id
        and binding.actor_id = public.request_actor_id()
        and not exists (
          select 1 from public.device_revocations revocation
          where revocation.organization_id = binding.organization_id
            and revocation.device_id = binding.device_id
        )
        and exists (
          select 1 from public.privileged_session_activity_events activity
          where activity.session_id = binding.session_id
            and activity.organization_id = binding.organization_id
            and activity.actor_id = binding.actor_id
            and activity.device_id = binding.device_id
            and activity.occurred_at
              between statement_timestamp() - max_idle_age and statement_timestamp() + interval '30 seconds'
        )
    )
$function$;

create or replace function public.is_privileged_request_allowed(
  target_organization_id uuid,
  target_action text,
  mfa_max_age interval default interval '15 minutes'
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select target_action in (
      'approve_module', 'deliver_report', 'share_report', 'revoke_access',
      'withdraw_report', 'create_amendment', 'export_protected_data',
      'place_lifecycle_hold', 'revoke_device', 'rotate_secret',
      'enable_restore_egress', 'disable_restore_egress'
    )
    and public.request_assurance_level() = 'aal2'
    and public.request_has_recent_mfa(mfa_max_age)
    and public.request_session_is_current(target_organization_id, interval '12 hours')
    and public.request_device_is_active(target_organization_id, interval '30 minutes')
    and case
      when target_action in ('approve_module', 'create_amendment', 'withdraw_report')
        then public.has_organization_role(target_organization_id, array['inspector'])
      when target_action in ('deliver_report', 'share_report')
        then public.has_organization_role(target_organization_id, array['inspector', 'administrator'])
      when target_action = 'revoke_access'
        then public.has_organization_role(target_organization_id, array['inspector', 'administrator', 'support'])
      when target_action = 'revoke_device'
        then public.has_organization_role(target_organization_id, array['administrator', 'support'])
      when target_action in (
        'export_protected_data', 'place_lifecycle_hold', 'rotate_secret',
        'enable_restore_egress', 'disable_restore_egress'
      )
        then public.has_organization_role(target_organization_id, array['administrator'])
      else false
    end
$function$;

create or replace function public.is_module_privileged_request_allowed(
  target_organization_id uuid,
  target_module_id uuid,
  target_action text,
  mfa_max_age interval default interval '15 minutes'
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select public.is_privileged_request_allowed(
      target_organization_id, target_action, mfa_max_age
    )
    and case
      when target_action in ('approve_module', 'create_amendment', 'withdraw_report')
        then public.is_assigned_module_inspector(target_organization_id, target_module_id)
      else exists (
        select 1 from public.inspection_modules module
        where module.organization_id = target_organization_id and module.id = target_module_id
      )
    end
$function$;

create or replace function public.command_consume_rate_limit(
  target_policy_name text,
  target_opaque_key_sha256 text
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  policy_limit integer;
  current_count integer;
  attempt_time timestamptz := statement_timestamp();
  window_start timestamptz := date_trunc('minute', statement_timestamp());
  retry_seconds integer;
begin
  policy_limit := case target_policy_name
    when 'recipient_access' then 30
    when 'privileged_action' then 10
    when 'provider_callback' then 120
    when 'booking_quote' then 20
    else null
  end;
  if policy_limit is null
     or target_opaque_key_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'invalid rate-limit policy or opaque identity digest';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(
    ':', target_policy_name, target_opaque_key_sha256, window_start::text
  ), 0));
  select coalesce(bucket.consumed_count, 0) into current_count
  from public.rate_limit_buckets bucket
  where bucket.policy_name = target_policy_name
    and bucket.opaque_key_sha256 = target_opaque_key_sha256
    and bucket.window_started_at = window_start;
  current_count := coalesce(current_count, 0);

  if current_count >= policy_limit then
    retry_seconds := greatest(
      1,
      ceil(extract(epoch from window_start + interval '1 minute' - attempt_time))::integer
    );
    return query select false, 0, retry_seconds;
    return;
  end if;

  insert into public.rate_limit_buckets (
    policy_name, opaque_key_sha256, window_started_at, consumed_count, updated_at
  ) values (
    target_policy_name, target_opaque_key_sha256, window_start,
    current_count + 1, attempt_time
  )
  on conflict (policy_name, opaque_key_sha256, window_started_at)
  do update set
    consumed_count = excluded.consumed_count,
    updated_at = excluded.updated_at;
  return query select true, policy_limit - current_count - 1, 0;
end;
$function$;

create or replace function public.command_prune_rate_limit_buckets()
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  deleted_count bigint;
begin
  delete from public.rate_limit_buckets bucket
  where bucket.window_started_at
    < date_trunc('minute', statement_timestamp()) - interval '24 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

create or replace function public.restore_generation_is_current(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select target_environment_name in ('development', 'test', 'preview', 'production')
    and exists (
      select 1
      from public.restore_generations generation
      where generation.restore_session_id = target_restore_session_id
        and generation.organization_id = target_organization_id
        and generation.environment_name = target_environment_name
        and generation.generation = (
          select max(candidate.generation)
          from public.restore_generations candidate
          where candidate.organization_id = target_organization_id
            and candidate.environment_name = target_environment_name
        )
    )
$function$;

-- Starts a new default-off generation. The trusted restore coordinator supplies
-- only the immutable source manifest; it cannot supply a verdict or enable bit.
create or replace function public.command_begin_restore_generation(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text,
  target_source_manifest_sha256 text,
  target_initiated_by_actor_id uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  next_generation bigint;
begin
  if target_environment_name not in ('development', 'test', 'preview', 'production')
     or target_source_manifest_sha256 !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1 from public.organization_members member
       where member.organization_id = target_organization_id
         and member.actor_id = target_initiated_by_actor_id
         and member.member_role = 'administrator'
         and member.status = 'active'
     ) then
    raise exception using errcode = '22023', message = 'invalid restore generation request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || target_environment_name, 0
  ));
  select coalesce(max(generation.generation), 0) + 1 into next_generation
  from public.restore_generations generation
  where generation.organization_id = target_organization_id
    and generation.environment_name = target_environment_name;

  insert into public.restore_generations (
    restore_session_id, organization_id, environment_name, generation,
    source_manifest_sha256, initiated_by_actor_id
  ) values (
    target_restore_session_id, target_organization_id, target_environment_name,
    next_generation, target_source_manifest_sha256, target_initiated_by_actor_id
  );
  return next_generation;
end;
$function$;

-- Canonical SQL verifier. Each verdict and evidence digest is derived from the
-- restored read model inside this transaction; no caller-provided boolean,
-- violation count or evidence hash crosses the trust boundary.
create or replace function public.restore_check_projection(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text,
  target_check_name text
)
returns table (violation_count bigint, evidence_sha256 text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  violations bigint := 0;
  observed_rows bigint := 0;
  generation_value bigint;
  manifest_sha text;
  projection jsonb;
begin
  select generation.generation, generation.source_manifest_sha256
    into strict generation_value, manifest_sha
  from public.restore_generations generation
  where generation.restore_session_id = target_restore_session_id
    and generation.organization_id = target_organization_id
    and generation.environment_name = target_environment_name;

  if target_check_name = 'artifact_checksums' then
    select count(*) into observed_rows from public.artifacts artifact
    where artifact.organization_id = target_organization_id;
    select count(*) into violations
    from public.artifacts artifact
    where artifact.organization_id = target_organization_id
      and not exists (
        select 1 from public.artifact_durability_receipts receipt
        where receipt.organization_id = artifact.organization_id
          and receipt.artifact_id = artifact.id
          and receipt.observed_sha256 = artifact.content_sha256
          and receipt.observed_byte_size = artifact.byte_size
      );
  elsif target_check_name = 'event_replay' then
    select count(*) into observed_rows from public.session_events event
    where event.organization_id = target_organization_id;
    select count(*) into violations
    from public.session_events event
    left join public.session_events previous
      on previous.organization_id = event.organization_id
     and previous.aggregate_type = event.aggregate_type
     and previous.aggregate_id = event.aggregate_id
     and previous.aggregate_version = event.aggregate_version - 1
    where event.organization_id = target_organization_id
      and (
        (event.aggregate_version = 1 and event.previous_event_sha256 is not null)
        or (event.aggregate_version > 1 and (
          previous.id is null
          or event.previous_event_sha256 is distinct from previous.event_sha256
        ))
      );
  elsif target_check_name = 'recipient_grants' then
    select count(*) into observed_rows from public.recipient_grants grant_row
    where grant_row.organization_id = target_organization_id;
    select count(*) into violations
    from public.lifecycle_suppressions suppression
    join public.recipient_grants grant_row
      on grant_row.id = suppression.target_id
     and grant_row.organization_id = suppression.organization_id
    where suppression.organization_id = target_organization_id
      and suppression.target_class = 'recipient_grant'
      and not exists (
        select 1 from public.recipient_grant_revocations revocation
        where revocation.organization_id = grant_row.organization_id
          and revocation.grant_id = grant_row.id
      );
  elsif target_check_name = 'deletion_suppressions' then
    select count(*) into observed_rows from public.lifecycle_suppressions suppression
    where suppression.organization_id = target_organization_id;
    select count(*) into violations
    from public.lifecycle_suppressions suppression
    where suppression.organization_id = target_organization_id
      and (
        (suppression.target_class = 'artifact' and not exists (
          select 1 from public.artifact_tombstones tombstone
          where tombstone.organization_id = suppression.organization_id
            and tombstone.artifact_id = suppression.target_id
        ))
        or (suppression.target_class = 'recipient_grant' and not exists (
          select 1 from public.recipient_grant_revocations revocation
          where revocation.organization_id = suppression.organization_id
            and revocation.grant_id = suppression.target_id
        ))
        or (suppression.target_class = 'session' and not exists (
          select 1 from public.sessions session_row
          where session_row.organization_id = suppression.organization_id
            and session_row.id = suppression.target_id
            and session_row.status = 'revoked'
        ))
      );
  elsif target_check_name = 'session_revocations' then
    select count(*) into observed_rows
    from public.privileged_session_bindings binding
    where binding.organization_id = target_organization_id;
    select count(*) into violations
    from public.privileged_session_bindings binding
    join public.device_revocations revocation
      on revocation.organization_id = binding.organization_id
     and revocation.device_id = binding.device_id
    where binding.organization_id = target_organization_id
      and exists (
        select 1 from auth.sessions auth_session
        where auth_session.id = binding.session_id
      );
  elsif target_check_name = 'package_pointers' then
    select count(*) into observed_rows from public.delivery_package_modules package_module
    where package_module.organization_id = target_organization_id;
    select count(*) into violations
    from public.delivery_package_modules package_module
    join public.inspection_modules module on module.id = package_module.module_id
    join public.module_approvals approval on approval.id = package_module.approval_id
    join public.report_versions report on report.id = package_module.report_version_id
    where package_module.organization_id = target_organization_id
      and (
        module.organization_id <> package_module.organization_id
        or module.module_type <> package_module.module_type
        or approval.module_id <> package_module.module_id
        or approval.snapshot_id <> package_module.module_snapshot_id
        or approval.module_type <> package_module.module_type
        or report.module_id <> package_module.module_id
        or report.module_snapshot_id <> package_module.module_snapshot_id
        or report.module_type <> package_module.module_type
      );
  elsif target_check_name = 'provider_truth' then
    select count(*) into observed_rows from public.outbox_records outbox
    where outbox.organization_id = target_organization_id;
    select
      (select count(*) from public.outbox_records outbox
       where outbox.organization_id = target_organization_id
         and outbox.state in ('leased', 'unknown'))
      + (select count(*) from public.delivery_current_state delivery
         where delivery.organization_id = target_organization_id
           and delivery.state = 'unknown')
      + (select count(*) from public.webhook_inbox webhook
         where webhook.organization_id = target_organization_id
           and webhook.state in ('processing', 'unknown'))
      into violations;
  elsif target_check_name = 'secret_environment' then
    select count(*) into observed_rows from public.secret_key_events key_event
    where key_event.organization_id = target_organization_id
      and key_event.environment_name = target_environment_name;
    with latest as (
      select distinct on (key_event.purpose, key_event.key_id_sha256)
        key_event.purpose, key_event.key_id_sha256, key_event.event_kind
      from public.secret_key_events key_event
      where key_event.organization_id = target_organization_id
        and key_event.environment_name = target_environment_name
      order by key_event.purpose, key_event.key_id_sha256, key_event.recorded_at desc
    ), conflicts as (
      select latest.purpose
      from latest
      where latest.event_kind = 'activated'
      group by latest.purpose
      having count(*) > 1
    )
    select count(*) into violations from conflicts;
  else
    raise exception using errcode = '22023', message = 'unknown canonical restore check';
  end if;

  projection := jsonb_build_object(
    'verifier', 'restore_sql_v1',
    'organizationId', target_organization_id,
    'restoreSessionId', target_restore_session_id,
    'environment', target_environment_name,
    'generation', generation_value,
    'sourceManifestHash', manifest_sha,
    'check', target_check_name,
    'observedRows', observed_rows,
    'violationCount', violations
  );
  return query select violations, encode(
    extensions.digest(convert_to(projection::text, 'UTF8'), 'sha256'), 'hex'
  );
end;
$function$;

create or replace function public.command_verify_restore_generation(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text,
  target_checked_by_actor_id uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  check_name_value text;
  check_result record;
  generation_value bigint;
  next_run bigint;
begin
  if not public.restore_generation_is_current(
    target_organization_id, target_restore_session_id, target_environment_name
  ) or not exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id
      and member.actor_id = target_checked_by_actor_id
      and member.member_role = 'administrator'
      and member.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'restore verification denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || target_restore_session_id::text || ':verify', 0
  ));
  select generation.generation into strict generation_value
  from public.restore_generations generation
  where generation.restore_session_id = target_restore_session_id
    and generation.organization_id = target_organization_id
    and generation.environment_name = target_environment_name;
  select coalesce(max(checks.verification_run), 0) + 1 into next_run
  from public.restore_reconciliation_checks checks
  where checks.organization_id = target_organization_id
    and checks.restore_session_id = target_restore_session_id
    and checks.environment_name = target_environment_name;

  foreach check_name_value in array array[
    'artifact_checksums', 'event_replay', 'recipient_grants', 'deletion_suppressions',
    'session_revocations', 'package_pointers', 'provider_truth', 'secret_environment'
  ] loop
    select * into strict check_result from public.restore_check_projection(
      target_organization_id, target_restore_session_id,
      target_environment_name, check_name_value
    );
    insert into public.restore_reconciliation_checks (
      organization_id, restore_session_id, environment_name, restore_generation,
      verification_run, check_name, verdict, violation_count, verifier_version,
      evidence_sha256, checked_by_actor_id
    ) values (
      target_organization_id, target_restore_session_id, target_environment_name,
      generation_value, next_run, check_name_value,
      case when check_result.violation_count = 0 then 'passed' else 'failed' end,
      check_result.violation_count, 'restore_sql_v1', check_result.evidence_sha256,
      target_checked_by_actor_id
    );
  end loop;
  return next_run;
end;
$function$;

create or replace function public.restore_is_reconciled(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with latest_run as (
    select max(checks.verification_run) as value
    from public.restore_reconciliation_checks checks
    where checks.organization_id = target_organization_id
      and checks.restore_session_id = target_restore_session_id
      and checks.environment_name = target_environment_name
  )
  select public.restore_generation_is_current(
      target_organization_id, target_restore_session_id, target_environment_name
    )
    and count(*) = 8
    and bool_and(checks.verdict = 'passed' and checks.violation_count = 0)
  from public.restore_reconciliation_checks checks, latest_run
  where checks.organization_id = target_organization_id
    and checks.restore_session_id = target_restore_session_id
    and checks.environment_name = target_environment_name
    and checks.verification_run = latest_run.value
$function$;

create or replace function public.restore_egress_is_enabled(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select public.restore_generation_is_current(
      target_organization_id, target_restore_session_id, target_environment_name
    )
    and public.restore_is_reconciled(
      target_organization_id, target_restore_session_id, target_environment_name
    )
    and coalesce((
      select event.event_kind = 'enabled'
      from public.restore_egress_events event
      where event.organization_id = target_organization_id
        and event.restore_session_id = target_restore_session_id
        and event.environment_name = target_environment_name
      order by event.event_version desc
      limit 1
    ), false)
$function$;

create or replace function public.require_restore_egress_enabled(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not public.restore_egress_is_enabled(
    target_organization_id, target_restore_session_id, target_environment_name
  ) then
    raise exception using
      errcode = '42501',
      message = 'restore egress remains disabled until canonical reconciliation and audited enablement complete';
  end if;
end;
$function$;

-- Approval is command-only: actor and device come from the bound session, the
-- domain row and its completed audit record commit or roll back together, and
-- idempotency replays must have the same request fingerprint.
create or replace function public.command_approve_module(
  target_organization_id uuid,
  target_module_id uuid,
  target_snapshot_id uuid,
  target_snapshot_sha256 text,
  target_expected_module_revision bigint,
  raw_idempotency_key text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  actor_id uuid := public.request_actor_id();
  device_id uuid := public.request_bound_device_id(target_organization_id);
  idempotency_sha text;
  fingerprint_sha text;
  module_type_value text;
  approval_id uuid := extensions.gen_random_uuid();
  prior public.privileged_action_audit%rowtype;
begin
  if length(raw_idempotency_key) not between 16 and 160 then
    raise exception using errcode = '22023', message = 'invalid idempotency key';
  end if;
  if target_snapshot_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid snapshot digest';
  end if;
  idempotency_sha := encode(extensions.digest(raw_idempotency_key, 'sha256'), 'hex');
  fingerprint_sha := encode(extensions.digest(
    concat_ws('|', 'approve_module', target_organization_id, target_module_id,
      target_snapshot_id, target_snapshot_sha256, target_expected_module_revision),
    'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || idempotency_sha, 0
  ));

  if exists (
    select 1 from public.privileged_action_audit audit
    where audit.organization_id = target_organization_id
      and audit.idempotency_key_sha256 = idempotency_sha
      and (
        audit.action_name <> 'approve_module'
        or audit.request_fingerprint_sha256 <> fingerprint_sha
      )
  ) then
    raise exception using errcode = '23505', message = 'idempotency key was already used for another request';
  end if;

  if not public.is_module_privileged_request_allowed(
    target_organization_id, target_module_id, 'approve_module'
  ) then
    insert into public.privileged_action_audit (
      organization_id, actor_id, device_id, action_name, assurance_level, outcome,
      reason_code, target_sha256, idempotency_key_sha256, request_fingerprint_sha256
    ) values (
      target_organization_id, actor_id, device_id, 'approve_module',
      public.request_assurance_level(), 'denied', 'privileged_guard_denied',
      target_snapshot_sha256, idempotency_sha, fingerprint_sha
    );
    return null;
  end if;

  select * into prior
  from public.privileged_action_audit audit
  where audit.organization_id = target_organization_id
    and audit.idempotency_key_sha256 = idempotency_sha
    and audit.outcome = 'completed';
  if found then
    return prior.result_record_id;
  end if;

  select module.module_type into strict module_type_value
  from public.inspection_modules module
  where module.id = target_module_id
    and module.organization_id = target_organization_id;

  insert into public.module_approvals (
    id, organization_id, module_id, module_type, snapshot_id, snapshot_sha256,
    expected_module_revision, approved_by_actor_id
  ) values (
    approval_id, target_organization_id, target_module_id, module_type_value,
    target_snapshot_id, target_snapshot_sha256, target_expected_module_revision, actor_id
  );

  insert into public.privileged_action_audit (
    organization_id, actor_id, device_id, action_name, assurance_level, outcome,
    reason_code, target_sha256, idempotency_key_sha256,
    request_fingerprint_sha256, result_record_id
  ) values (
    target_organization_id, actor_id, device_id, 'approve_module',
    public.request_assurance_level(), 'completed', 'module_approved',
    target_snapshot_sha256, idempotency_sha, fingerprint_sha, approval_id
  );
  return approval_id;
end;
$function$;

create or replace function public.command_withdraw_module(
  target_organization_id uuid,
  target_module_id uuid,
  target_snapshot_id uuid,
  target_approval_id uuid,
  target_expected_module_revision bigint,
  withdrawal_reason text,
  raw_idempotency_key text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  actor_id uuid := public.request_actor_id();
  device_id uuid := public.request_bound_device_id(target_organization_id);
  idempotency_sha text;
  fingerprint_sha text;
  module_type_value text;
  approval_snapshot_sha text;
  approval_target_sha text;
  withdrawal_id uuid := extensions.gen_random_uuid();
  prior public.privileged_action_audit%rowtype;
begin
  if length(raw_idempotency_key) not between 16 and 160
     or length(btrim(withdrawal_reason)) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'invalid withdrawal request';
  end if;
  idempotency_sha := encode(extensions.digest(raw_idempotency_key, 'sha256'), 'hex');
  approval_target_sha := encode(extensions.digest(target_approval_id::text, 'sha256'), 'hex');
  fingerprint_sha := encode(extensions.digest(
    concat_ws('|', 'withdraw_report', target_organization_id, target_module_id,
      target_snapshot_id, target_approval_id, target_expected_module_revision,
      btrim(withdrawal_reason)),
    'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || idempotency_sha, 0
  ));

  if exists (
    select 1 from public.privileged_action_audit audit
    where audit.organization_id = target_organization_id
      and audit.idempotency_key_sha256 = idempotency_sha
      and (
        audit.action_name <> 'withdraw_report'
        or audit.request_fingerprint_sha256 <> fingerprint_sha
      )
  ) then
    raise exception using errcode = '23505', message = 'idempotency key was already used for another request';
  end if;

  if not public.is_module_privileged_request_allowed(
    target_organization_id, target_module_id, 'withdraw_report'
  ) then
    insert into public.privileged_action_audit (
      organization_id, actor_id, device_id, action_name, assurance_level, outcome,
      reason_code, target_sha256, idempotency_key_sha256, request_fingerprint_sha256
    ) values (
      target_organization_id, actor_id, device_id, 'withdraw_report',
      public.request_assurance_level(), 'denied', 'privileged_guard_denied',
      approval_target_sha, idempotency_sha, fingerprint_sha
    );
    return null;
  end if;

  select * into prior
  from public.privileged_action_audit audit
  where audit.organization_id = target_organization_id
    and audit.idempotency_key_sha256 = idempotency_sha
    and audit.outcome = 'completed';
  if found then
    return prior.result_record_id;
  end if;

  select module.module_type, approval.snapshot_sha256
    into module_type_value, approval_snapshot_sha
  from public.inspection_modules module
  join public.module_approvals approval
    on approval.organization_id = module.organization_id
   and approval.module_id = module.id
   and approval.module_type = module.module_type
   and approval.snapshot_id = target_snapshot_id
  where module.id = target_module_id
    and module.organization_id = target_organization_id
    and approval.id = target_approval_id
    and approval.expected_module_revision = target_expected_module_revision;
  if not found then
    insert into public.privileged_action_audit (
      organization_id, actor_id, device_id, action_name, assurance_level, outcome,
      reason_code, target_sha256, idempotency_key_sha256, request_fingerprint_sha256
    ) values (
      target_organization_id, actor_id, device_id, 'withdraw_report',
      public.request_assurance_level(), 'denied', 'approval_binding_mismatch',
      approval_target_sha, idempotency_sha, fingerprint_sha
    );
    return null;
  end if;

  insert into public.module_withdrawals (
    id, organization_id, module_id, module_type, snapshot_id, approval_id,
    expected_module_revision, reason, withdrawn_by_actor_id
  ) values (
    withdrawal_id, target_organization_id, target_module_id, module_type_value,
    target_snapshot_id, target_approval_id, target_expected_module_revision,
    btrim(withdrawal_reason), actor_id
  );

  insert into public.privileged_action_audit (
    organization_id, actor_id, device_id, action_name, assurance_level, outcome,
    reason_code, target_sha256, idempotency_key_sha256,
    request_fingerprint_sha256, result_record_id
  ) values (
    target_organization_id, actor_id, device_id, 'withdraw_report',
    public.request_assurance_level(), 'completed', 'module_withdrawn',
    approval_snapshot_sha, idempotency_sha, fingerprint_sha, withdrawal_id
  );
  return withdrawal_id;
end;
$function$;

create or replace function public.command_enable_restore_egress(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text,
  raw_idempotency_key text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  actor_id uuid := public.request_actor_id();
  device_id uuid := public.request_bound_device_id(target_organization_id);
  idempotency_sha text;
  fingerprint_sha text;
  projection_sha text;
  target_sha text;
  generation_value bigint;
  verification_run_value bigint;
  next_version bigint;
  event_id uuid := extensions.gen_random_uuid();
  prior public.privileged_action_audit%rowtype;
begin
  if length(raw_idempotency_key) not between 16 and 160
     or target_environment_name not in ('development', 'test', 'preview', 'production') then
    raise exception using errcode = '22023', message = 'invalid restore egress request';
  end if;
  idempotency_sha := encode(extensions.digest(raw_idempotency_key, 'sha256'), 'hex');
  target_sha := encode(extensions.digest(concat_ws('|',
    target_restore_session_id, target_environment_name
  ), 'sha256'), 'hex');
  fingerprint_sha := encode(extensions.digest(
    concat_ws('|', 'enable_restore_egress', target_organization_id,
    target_restore_session_id, target_environment_name), 'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || idempotency_sha, 0
  ));

  if exists (
    select 1 from public.privileged_action_audit audit
    where audit.organization_id = target_organization_id
      and audit.idempotency_key_sha256 = idempotency_sha
      and (
        audit.action_name <> 'enable_restore_egress'
        or audit.request_fingerprint_sha256 <> fingerprint_sha
      )
  ) then
    raise exception using errcode = '23505', message = 'idempotency key was already used for another request';
  end if;

  if not public.is_privileged_request_allowed(
    target_organization_id, 'enable_restore_egress'
  ) then
    insert into public.privileged_action_audit (
      organization_id, actor_id, device_id, action_name, assurance_level, outcome,
      reason_code, target_sha256, idempotency_key_sha256, request_fingerprint_sha256
    ) values (
      target_organization_id, actor_id, device_id, 'enable_restore_egress',
      public.request_assurance_level(), 'denied', 'privileged_guard_denied',
      target_sha, idempotency_sha, fingerprint_sha
    );
    return null;
  end if;

  select * into prior
  from public.privileged_action_audit audit
  where audit.organization_id = target_organization_id
    and audit.idempotency_key_sha256 = idempotency_sha
    and audit.outcome = 'completed';
  if found then
    return prior.result_record_id;
  end if;

  if not public.restore_is_reconciled(
    target_organization_id, target_restore_session_id, target_environment_name
  ) then
    insert into public.privileged_action_audit (
      organization_id, actor_id, device_id, action_name, assurance_level, outcome,
      reason_code, target_sha256, idempotency_key_sha256, request_fingerprint_sha256
    ) values (
      target_organization_id, actor_id, device_id, 'enable_restore_egress',
      public.request_assurance_level(), 'denied', 'restore_reconciliation_incomplete',
      target_sha, idempotency_sha, fingerprint_sha
    );
    return null;
  end if;

  select generation.generation into strict generation_value
  from public.restore_generations generation
  where generation.restore_session_id = target_restore_session_id
    and generation.organization_id = target_organization_id
    and generation.environment_name = target_environment_name;
  select max(checks.verification_run) into strict verification_run_value
  from public.restore_reconciliation_checks checks
  where checks.organization_id = target_organization_id
    and checks.restore_session_id = target_restore_session_id
    and checks.environment_name = target_environment_name;
  select encode(extensions.digest(convert_to(concat_ws('|',
    generation_value, verification_run_value,
    string_agg(check_name || ':' || evidence_sha256, '|' order by check_name)
  ), 'UTF8'), 'sha256'), 'hex') into projection_sha
  from public.restore_reconciliation_checks checks
  where checks.organization_id = target_organization_id
    and checks.restore_session_id = target_restore_session_id
    and checks.environment_name = target_environment_name
    and checks.verification_run = verification_run_value
    and checks.verdict = 'passed';

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || target_restore_session_id::text || target_environment_name, 0
  ));
  select coalesce(max(event.event_version), 0) + 1 into next_version
  from public.restore_egress_events event
  where event.organization_id = target_organization_id
    and event.restore_session_id = target_restore_session_id
    and event.environment_name = target_environment_name;

  insert into public.restore_egress_events (
    id, organization_id, restore_session_id, environment_name, restore_generation,
    event_version, event_kind, recorded_by_actor_id, evidence_projection_sha256
  ) values (
    event_id, target_organization_id, target_restore_session_id,
    target_environment_name, generation_value, next_version,
    'enabled', actor_id, projection_sha
  );

  insert into public.privileged_action_audit (
    organization_id, actor_id, device_id, action_name, assurance_level, outcome,
    reason_code, target_sha256, idempotency_key_sha256,
    request_fingerprint_sha256, result_record_id
  ) values (
    target_organization_id, actor_id, device_id, 'enable_restore_egress',
    public.request_assurance_level(), 'completed', 'restore_egress_enabled',
    projection_sha, idempotency_sha, fingerprint_sha, event_id
  );
  return event_id;
end;
$function$;

-- Emergency disable never depends on successful reconciliation. It still
-- requires the exact active generation, AAL2/current-device authorization,
-- idempotency and an atomic completed audit record.
create or replace function public.command_disable_restore_egress(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text,
  raw_idempotency_key text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  actor_id uuid := public.request_actor_id();
  device_id uuid := public.request_bound_device_id(target_organization_id);
  idempotency_sha text;
  fingerprint_sha text;
  target_sha text;
  projection_sha text;
  generation_value bigint;
  next_version bigint;
  event_id uuid := extensions.gen_random_uuid();
  prior public.privileged_action_audit%rowtype;
begin
  if length(raw_idempotency_key) not between 16 and 160
     or target_environment_name not in ('development', 'test', 'preview', 'production') then
    raise exception using errcode = '22023', message = 'invalid restore egress request';
  end if;
  idempotency_sha := encode(extensions.digest(raw_idempotency_key, 'sha256'), 'hex');
  target_sha := encode(extensions.digest(concat_ws('|',
    target_restore_session_id, target_environment_name
  ), 'sha256'), 'hex');
  fingerprint_sha := encode(extensions.digest(concat_ws('|',
    'disable_restore_egress', target_organization_id,
    target_restore_session_id, target_environment_name
  ), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || idempotency_sha, 0
  ));

  if exists (
    select 1 from public.privileged_action_audit audit
    where audit.organization_id = target_organization_id
      and audit.idempotency_key_sha256 = idempotency_sha
      and (
        audit.action_name <> 'disable_restore_egress'
        or audit.request_fingerprint_sha256 <> fingerprint_sha
      )
  ) then
    raise exception using errcode = '23505', message = 'idempotency key was already used for another request';
  end if;

  if not public.is_privileged_request_allowed(
    target_organization_id, 'disable_restore_egress'
  ) then
    insert into public.privileged_action_audit (
      organization_id, actor_id, device_id, action_name, assurance_level, outcome,
      reason_code, target_sha256, idempotency_key_sha256, request_fingerprint_sha256
    ) values (
      target_organization_id, actor_id, device_id, 'disable_restore_egress',
      public.request_assurance_level(), 'denied', 'privileged_guard_denied',
      target_sha, idempotency_sha, fingerprint_sha
    );
    return null;
  end if;

  select * into prior from public.privileged_action_audit audit
  where audit.organization_id = target_organization_id
    and audit.idempotency_key_sha256 = idempotency_sha
    and audit.outcome = 'completed';
  if found then
    return prior.result_record_id;
  end if;

  if not public.restore_generation_is_current(
    target_organization_id, target_restore_session_id, target_environment_name
  ) then
    insert into public.privileged_action_audit (
      organization_id, actor_id, device_id, action_name, assurance_level, outcome,
      reason_code, target_sha256, idempotency_key_sha256, request_fingerprint_sha256
    ) values (
      target_organization_id, actor_id, device_id, 'disable_restore_egress',
      public.request_assurance_level(), 'denied', 'restore_generation_not_current',
      target_sha, idempotency_sha, fingerprint_sha
    );
    return null;
  end if;

  select generation.generation into strict generation_value
  from public.restore_generations generation
  where generation.restore_session_id = target_restore_session_id
    and generation.organization_id = target_organization_id
    and generation.environment_name = target_environment_name;
  projection_sha := encode(extensions.digest(convert_to(concat_ws('|',
    'disabled', target_organization_id, target_restore_session_id,
    target_environment_name, generation_value
  ), 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || target_restore_session_id::text || target_environment_name, 0
  ));
  select coalesce(max(event.event_version), 0) + 1 into next_version
  from public.restore_egress_events event
  where event.organization_id = target_organization_id
    and event.restore_session_id = target_restore_session_id
    and event.environment_name = target_environment_name;

  insert into public.restore_egress_events (
    id, organization_id, restore_session_id, environment_name, restore_generation,
    event_version, event_kind, recorded_by_actor_id, evidence_projection_sha256
  ) values (
    event_id, target_organization_id, target_restore_session_id,
    target_environment_name, generation_value, next_version,
    'disabled', actor_id, projection_sha
  );
  insert into public.privileged_action_audit (
    organization_id, actor_id, device_id, action_name, assurance_level, outcome,
    reason_code, target_sha256, idempotency_key_sha256,
    request_fingerprint_sha256, result_record_id
  ) values (
    target_organization_id, actor_id, device_id, 'disable_restore_egress',
    public.request_assurance_level(), 'completed', 'restore_egress_disabled',
    projection_sha, idempotency_sha, fingerprint_sha, event_id
  );
  return event_id;
end;
$function$;

create or replace function public.restore_egress_projection(
  target_organization_id uuid,
  target_restore_session_id uuid,
  target_environment_name text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $function$
  with generation as (
    select restore.generation
    from public.restore_generations restore
    where restore.organization_id = target_organization_id
      and restore.restore_session_id = target_restore_session_id
      and restore.environment_name = target_environment_name
  ), latest_run as (
    select max(checks.verification_run) as value
    from public.restore_reconciliation_checks checks
    where checks.organization_id = target_organization_id
      and checks.restore_session_id = target_restore_session_id
      and checks.environment_name = target_environment_name
  ), latest_event as (
    select event.*
    from public.restore_egress_events event
    where event.organization_id = target_organization_id
      and event.restore_session_id = target_restore_session_id
      and event.environment_name = target_environment_name
    order by event.event_version desc
    limit 1
  ), evidence as (
    select coalesce(jsonb_agg(
      jsonb_build_object('name', checks.check_name, 'evidenceHash', checks.evidence_sha256)
      order by checks.check_name
    ), '[]'::jsonb) as items
    from public.restore_reconciliation_checks checks
    where checks.organization_id = target_organization_id
      and checks.restore_session_id = target_restore_session_id
      and checks.environment_name = target_environment_name
      and checks.verification_run = (select value from latest_run)
      and checks.verdict = 'passed'
  )
  select jsonb_build_object(
    'source', 'postgres_restore_egress_state_v2',
    'organizationId', target_organization_id,
    'restoreSessionId', target_restore_session_id,
    'environment', target_environment_name,
    'restoreGeneration', coalesce((select generation from generation), 0),
    'verificationRun', coalesce((select value from latest_run), 0),
    'state', case when public.restore_egress_is_enabled(
      target_organization_id, target_restore_session_id, target_environment_name
    ) then 'enabled' else 'blocked' end,
    'eventVersion', coalesce((select event_version from latest_event), 0),
    'eventId', (select id from latest_event),
    'checkedEvidence', evidence.items,
    'projectionHash', encode(extensions.digest(
      concat_ws('|', target_organization_id, target_restore_session_id,
        target_environment_name, coalesce((select generation::text from generation), '0'),
        coalesce((select value::text from latest_run), '0'),
        coalesce((select id::text from latest_event), 'blocked'),
        evidence.items::text), 'sha256'
    ), 'hex')
  )
  from evidence
$function$;

-- These event tables are append-only, RLS-forced, and writable only by trusted
-- service/command boundaries. Authenticated users cannot self-bind sessions,
-- forge activity, write audit rows, or enable restored egress.
do $block$
declare
  table_name text;
begin
  foreach table_name in array array[
    'registered_devices', 'device_presence_events', 'device_revocations',
    'privileged_session_bindings', 'privileged_session_activity_events',
    'privileged_action_audit', 'restore_generations',
    'restore_reconciliation_checks', 'restore_egress_events', 'secret_key_events'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_reject_mutation', table_name);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.u2_reject_mutation()',
      table_name || '_reject_mutation', table_name
    );
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end;
$block$;

alter table public.rate_limit_buckets enable row level security;
alter table public.rate_limit_buckets force row level security;
revoke all on public.rate_limit_buckets from public, anon, authenticated, service_role;

-- U2 originally allowed assigned inspectors to insert these rows directly.
-- U10 closes that path; only the audited security-definer commands may write.
drop policy if exists tenant_professional_insert on public.module_approvals;
drop policy if exists tenant_professional_insert on public.module_withdrawals;
revoke insert on public.module_approvals, public.module_withdrawals from authenticated, service_role;
revoke insert, update, delete on
  public.restore_generations,
  public.restore_reconciliation_checks,
  public.restore_egress_events
from authenticated, service_role;

revoke all on function public.request_session_id() from public, anon;
revoke all on function public.request_assurance_level() from public, anon;
revoke all on function public.request_has_recent_mfa(interval) from public, anon;
revoke all on function public.request_bound_device_id(uuid) from public, anon;
revoke all on function public.request_session_is_current(uuid, interval) from public, anon;
revoke all on function public.request_device_is_active(uuid, interval) from public, anon;
revoke all on function public.is_privileged_request_allowed(uuid, text, interval) from public, anon;
revoke all on function public.is_module_privileged_request_allowed(uuid, uuid, text, interval) from public, anon;
revoke all on function public.command_consume_rate_limit(text, text) from public, anon, authenticated;
revoke all on function public.command_prune_rate_limit_buckets() from public, anon, authenticated;
revoke all on function public.restore_generation_is_current(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.command_begin_restore_generation(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.restore_check_projection(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.command_verify_restore_generation(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.restore_is_reconciled(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.restore_egress_is_enabled(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.require_restore_egress_enabled(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.restore_egress_projection(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.command_approve_module(uuid, uuid, uuid, text, bigint, text) from public, anon;
revoke all on function public.command_withdraw_module(uuid, uuid, uuid, uuid, bigint, text, text) from public, anon;
revoke all on function public.command_enable_restore_egress(uuid, uuid, text, text) from public, anon;
revoke all on function public.command_disable_restore_egress(uuid, uuid, text, text) from public, anon;

grant execute on function public.request_session_id() to authenticated, service_role;
grant execute on function public.request_assurance_level() to authenticated, service_role;
grant execute on function public.request_has_recent_mfa(interval) to authenticated, service_role;
grant execute on function public.request_bound_device_id(uuid) to authenticated, service_role;
grant execute on function public.request_session_is_current(uuid, interval) to authenticated, service_role;
grant execute on function public.request_device_is_active(uuid, interval) to authenticated, service_role;
grant execute on function public.is_privileged_request_allowed(uuid, text, interval) to authenticated, service_role;
grant execute on function public.is_module_privileged_request_allowed(uuid, uuid, text, interval) to authenticated, service_role;
grant execute on function public.command_consume_rate_limit(text, text) to service_role;
grant execute on function public.command_prune_rate_limit_buckets() to service_role;
grant execute on function public.command_approve_module(uuid, uuid, uuid, text, bigint, text) to authenticated, service_role;
grant execute on function public.command_withdraw_module(uuid, uuid, uuid, uuid, bigint, text, text) to authenticated, service_role;
grant execute on function public.command_enable_restore_egress(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.command_disable_restore_egress(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.command_begin_restore_generation(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.command_verify_restore_generation(uuid, uuid, text, uuid) to service_role;
grant execute on function public.restore_generation_is_current(uuid, uuid, text) to service_role;
grant execute on function public.restore_is_reconciled(uuid, uuid, text) to service_role;
grant execute on function public.restore_egress_is_enabled(uuid, uuid, text) to service_role;
grant execute on function public.require_restore_egress_enabled(uuid, uuid, text) to service_role;
grant execute on function public.restore_egress_projection(uuid, uuid, text) to service_role;
