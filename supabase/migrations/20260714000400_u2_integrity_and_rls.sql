-- U2: database-enforced history, optimistic/fenced concurrency, package exactness,
-- and deny-by-default tenant/capability authorization.

create or replace function public.u2_validate_finding_current_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  candidate public.finding_versions%rowtype;
begin
  if new.current_version_id is null then
    return new;
  end if;

  select * into candidate
  from public.finding_versions fv
  where fv.id = new.current_version_id
    and fv.organization_id = new.organization_id
    and fv.finding_id = new.id;

  if not found then
    raise exception using errcode = '23514', message = 'current finding version must belong to the same finding and tenant';
  end if;

  if candidate.confirmed_at is null
     or candidate.confirmed_by_actor_id is null
     or candidate.verifier_state in ('pending', 'rejected', 'exhausted', 'stale') then
    raise exception using errcode = '23514', message = 'current finding version must be inspector-confirmed and publication-eligible';
  end if;

  return new;
end;
$function$;

drop trigger if exists findings_validate_current_version on public.findings;
create trigger findings_validate_current_version
before insert or update of current_version_id on public.findings
for each row execute function public.u2_validate_finding_current_version();

create or replace function public.u2_validate_module_current_pointers()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.current_snapshot_id is not null and not exists (
    select 1 from public.module_snapshots s
    where s.id = new.current_snapshot_id
      and s.organization_id = new.organization_id
      and s.module_id = new.id
      and s.module_type = new.module_type
  ) then
    raise exception using errcode = '23514', message = 'current snapshot must belong to the same module and tenant';
  end if;

  if new.current_report_version_id is not null and not exists (
    select 1 from public.report_versions r
    where r.id = new.current_report_version_id
      and r.organization_id = new.organization_id
      and r.module_id = new.id
      and r.module_type = new.module_type
  ) then
    raise exception using errcode = '23514', message = 'current report version must belong to the same module and tenant';
  end if;

  return new;
end;
$function$;

drop trigger if exists inspection_modules_validate_current_pointers on public.inspection_modules;
create trigger inspection_modules_validate_current_pointers
before insert or update of current_snapshot_id, current_report_version_id on public.inspection_modules
for each row execute function public.u2_validate_module_current_pointers();

create or replace function public.u2_validate_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  module_row public.inspection_modules%rowtype;
begin
  select * into module_row
  from public.inspection_modules m
  where m.id = new.module_id and m.organization_id = new.organization_id
  for key share;

  if not found
     or module_row.job_id <> new.job_id
     or module_row.module_type <> new.module_type then
    raise exception using errcode = '23514', message = 'snapshot tenant, job and module identity must agree';
  end if;
  if module_row.revision <> new.expected_module_revision then
    raise exception using errcode = '40001', message = 'stale module revision';
  end if;
  if module_row.assigned_inspector_actor_id <> new.inspector_actor_id then
    raise exception using errcode = '42501', message = 'only the assigned inspector may author a module snapshot';
  end if;
  return new;
end;
$function$;

drop trigger if exists module_snapshots_validate on public.module_snapshots;
create trigger module_snapshots_validate before insert on public.module_snapshots
for each row execute function public.u2_validate_snapshot();

create or replace function public.u2_validate_snapshot_finding()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if not exists (
    select 1
    from public.module_snapshots s
    join public.finding_versions fv
      on fv.id = new.finding_version_id
     and fv.organization_id = new.organization_id
    join public.findings f
      on f.id = fv.finding_id
     and f.organization_id = fv.organization_id
    where s.id = new.snapshot_id
      and s.organization_id = new.organization_id
      and f.module_id = s.module_id
      and fv.module_type = s.module_type
      and fv.confirmed_at is not null
      and fv.confirmed_by_actor_id is not null
      and fv.verifier_state not in ('pending', 'rejected', 'exhausted', 'stale')
  ) then
    raise exception using errcode = '23514', message = 'snapshot findings must be confirmed, current-module, publication-eligible versions';
  end if;
  return new;
end;
$function$;

drop trigger if exists module_snapshot_findings_validate on public.module_snapshot_findings;
create trigger module_snapshot_findings_validate before insert on public.module_snapshot_findings
for each row execute function public.u2_validate_snapshot_finding();

create or replace function public.u2_validate_approval()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  module_row public.inspection_modules%rowtype;
  snapshot_row public.module_snapshots%rowtype;
begin
  select * into module_row
  from public.inspection_modules m
  where m.id = new.module_id and m.organization_id = new.organization_id
  for update;

  select * into snapshot_row
  from public.module_snapshots s
  where s.id = new.snapshot_id and s.organization_id = new.organization_id;

  if not found
     or snapshot_row.module_id <> new.module_id
     or snapshot_row.module_type <> new.module_type
     or snapshot_row.canonical_sha256 <> new.snapshot_sha256 then
    raise exception using errcode = '23514', message = 'approval must bind the exact module snapshot hash';
  end if;
  if module_row.revision <> new.expected_module_revision then
    raise exception using errcode = '40001', message = 'stale module revision';
  end if;
  if module_row.current_snapshot_id is distinct from new.snapshot_id then
    raise exception using errcode = '23514', message = 'approval must bind the exact current module snapshot';
  end if;
  if module_row.assigned_inspector_actor_id <> new.approved_by_actor_id then
    raise exception using errcode = '42501', message = 'only the assigned inspector may approve this module';
  end if;
  if exists (
    select 1
    from public.module_snapshot_findings sf
    join public.finding_versions fv on fv.id = sf.finding_version_id
    where sf.snapshot_id = new.snapshot_id
      and (fv.confirmed_at is null or fv.verifier_state in ('pending', 'rejected', 'exhausted', 'stale'))
  ) then
    raise exception using errcode = '23514', message = 'snapshot includes an unapproved, rejected or stale finding';
  end if;
  return new;
end;
$function$;

drop trigger if exists module_approvals_validate on public.module_approvals;
create trigger module_approvals_validate before insert on public.module_approvals
for each row execute function public.u2_validate_approval();

create or replace function public.u2_validate_report_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  module_row public.inspection_modules%rowtype;
  prior public.report_versions%rowtype;
begin
  select * into module_row
  from public.inspection_modules m
  where m.id = new.module_id and m.organization_id = new.organization_id
  for key share;

  if module_row.job_id <> new.job_id
     or module_row.module_type <> new.module_type
     or module_row.current_snapshot_id is distinct from new.module_snapshot_id
     or module_row.revision <> new.expected_module_revision then
    raise exception using errcode = '40001', message = 'report version is stale or does not bind the current module snapshot';
  end if;
  if not exists (
    select 1 from public.module_approvals a
    where a.module_id = new.module_id
      and a.snapshot_id = new.module_snapshot_id
      and not exists (select 1 from public.module_withdrawals w where w.approval_id = a.id)
  ) then
    raise exception using errcode = '23514', message = 'report version requires a current, non-withdrawn approval';
  end if;

  if new.supersedes_report_version_id is not null then
    select * into prior from public.report_versions r
    where r.id = new.supersedes_report_version_id and r.organization_id = new.organization_id;
    if not found or prior.module_id <> new.module_id or prior.report_version <> new.report_version - 1 then
      raise exception using errcode = '23514', message = 'amendment must preserve a contiguous same-module version chain';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists report_versions_validate on public.report_versions;
create trigger report_versions_validate before insert on public.report_versions
for each row execute function public.u2_validate_report_version();

create or replace function public.u2_enforce_stream_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  stream_id uuid;
  supplied_version bigint;
  expected_version bigint;
begin
  stream_id := (to_jsonb(new) ->> tg_argv[0])::uuid;
  supplied_version := (to_jsonb(new) ->> tg_argv[1])::bigint;
  perform pg_advisory_xact_lock(hashtextextended(tg_table_schema || '.' || tg_table_name || ':' || stream_id::text, 0));
  execute format('select coalesce(max(%I), 0) + 1 from %I.%I where %I = $1', tg_argv[1], tg_table_schema, tg_table_name, tg_argv[0])
    into expected_version using stream_id;
  if supplied_version <> expected_version then
    raise exception using errcode = '23514', message = format('%s stream version gap or reorder: expected %s', tg_table_name, expected_version);
  end if;
  return new;
end;
$function$;

drop trigger if exists delivery_package_events_ordered on public.delivery_package_events;
create trigger delivery_package_events_ordered before insert on public.delivery_package_events
for each row execute function public.u2_enforce_stream_version('package_id', 'package_version');
drop trigger if exists delivery_events_ordered on public.delivery_events;
create trigger delivery_events_ordered before insert on public.delivery_events
for each row execute function public.u2_enforce_stream_version('delivery_id', 'delivery_version');

create or replace function public.u2_seed_package_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  insert into public.delivery_package_events (
    organization_id, package_id, package_version, state, actor_id
  ) values (new.organization_id, new.id, 1, 'confirmed', new.confirmed_by_actor_id);
  return new;
end;
$function$;

drop trigger if exists delivery_packages_seed_event on public.delivery_packages;
create trigger delivery_packages_seed_event after insert on public.delivery_packages
for each row execute function public.u2_seed_package_event();

create or replace function public.u2_seed_delivery_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  insert into public.delivery_events (
    organization_id, delivery_id, delivery_version, state
  ) values (new.organization_id, new.id, 1, 'requested');
  return new;
end;
$function$;

drop trigger if exists deliveries_seed_event on public.deliveries;
create trigger deliveries_seed_event after insert on public.deliveries
for each row execute function public.u2_seed_delivery_event();

create or replace function public.u2_validate_exact_package()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  target_package_id uuid;
  package_row public.delivery_packages%rowtype;
  expected_count integer;
  actual_count integer;
begin
  if tg_table_name = 'delivery_packages' then
    target_package_id := coalesce(
      (to_jsonb(new) ->> 'id')::uuid,
      (to_jsonb(old) ->> 'id')::uuid
    );
  else
    target_package_id := coalesce(
      (to_jsonb(new) ->> 'package_id')::uuid,
      (to_jsonb(old) ->> 'package_id')::uuid
    );
  end if;
  select * into package_row from public.delivery_packages p where p.id = target_package_id;
  if not found then return null; end if;

  select count(*) into expected_count
  from public.inspection_modules m
  where m.job_id = package_row.job_id and m.organization_id = package_row.organization_id;

  select count(*) into actual_count
  from public.delivery_package_modules pm
  join public.inspection_modules m
    on m.id = pm.module_id and m.organization_id = pm.organization_id
  join public.module_approvals a
    on a.id = pm.approval_id and a.organization_id = pm.organization_id
  join public.report_versions r
    on r.id = pm.report_version_id and r.organization_id = pm.organization_id
  where pm.package_id = target_package_id
    and m.job_id = package_row.job_id
    and m.current_snapshot_id = pm.module_snapshot_id
    and m.current_report_version_id = pm.report_version_id
    and a.module_id = m.id
    and a.snapshot_id = pm.module_snapshot_id
    and r.module_id = m.id
    and r.module_snapshot_id = pm.module_snapshot_id
    and not exists (select 1 from public.module_withdrawals w where w.approval_id = a.id);

  if package_row.expected_job_revision <> (select j.revision from public.jobs j where j.id = package_row.job_id) then
    raise exception using errcode = '40001', message = 'delivery package expected job revision is stale';
  end if;
  if expected_count = 0 or actual_count <> expected_count then
    raise exception using errcode = '23514', message = 'delivery package must bind the exact commissioned module snapshot set';
  end if;
  return null;
end;
$function$;

drop trigger if exists delivery_packages_exact_modules on public.delivery_packages;
create constraint trigger delivery_packages_exact_modules
after insert or update on public.delivery_packages
deferrable initially deferred
for each row execute function public.u2_validate_exact_package();
drop trigger if exists delivery_package_modules_exact_modules on public.delivery_package_modules;
create constraint trigger delivery_package_modules_exact_modules
after insert or update or delete on public.delivery_package_modules
deferrable initially deferred
for each row execute function public.u2_validate_exact_package();

create or replace function public.u2_cancel_packages_for_withdrawal()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  package_row record;
begin
  for package_row in
    select pm.package_id, pm.organization_id,
      coalesce((select max(e.package_version) from public.delivery_package_events e where e.package_id = pm.package_id), 0) + 1 as next_version
    from public.delivery_package_modules pm
    where pm.module_id = new.module_id and pm.module_snapshot_id = new.snapshot_id
  loop
    insert into public.delivery_package_events (
      organization_id, package_id, package_version, state, reason, actor_id
    ) values (
      package_row.organization_id, package_row.package_id, package_row.next_version,
      'withdrawn', 'Professional module withdrawn before delivery', new.withdrawn_by_actor_id
    );
  end loop;
  return new;
end;
$function$;

drop trigger if exists module_withdrawals_cancel_packages on public.module_withdrawals;
create trigger module_withdrawals_cancel_packages after insert on public.module_withdrawals
for each row execute function public.u2_cancel_packages_for_withdrawal();

create or replace function public.u2_prepare_session_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions
as $function$
declare
  previous_row public.session_events%rowtype;
  expected_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || new.aggregate_type || ':' || new.aggregate_id::text, 0));

  select * into previous_row
  from public.session_events e
  where e.organization_id = new.organization_id
    and e.aggregate_type = new.aggregate_type
    and e.aggregate_id = new.aggregate_id
  order by e.aggregate_version desc
  limit 1;

  expected_version := coalesce(previous_row.aggregate_version, 0) + 1;
  if new.aggregate_version <> expected_version then
    raise exception using errcode = '23514', message = format('event version gap or reorder: expected %s', expected_version);
  end if;
  if expected_version = 1 and new.previous_event_sha256 is not null then
    raise exception using errcode = '23514', message = 'first event cannot claim a previous event hash';
  end if;
  if expected_version > 1 and new.previous_event_sha256 is distinct from previous_row.event_sha256 then
    raise exception using errcode = '23514', message = 'previous event hash does not match aggregate head';
  end if;
  if new.checkpoint_event_id is not null and not exists (
    select 1 from public.session_events c
    where c.id = new.checkpoint_event_id
      and c.organization_id = new.organization_id
      and c.aggregate_type = new.aggregate_type
      and c.aggregate_id = new.aggregate_id
      and c.aggregate_version < new.aggregate_version
  ) then
    raise exception using errcode = '23514', message = 'checkpoint must reference an earlier event in the same aggregate';
  end if;

  new.recorded_at := statement_timestamp();
  new.event_sha256 := encode(extensions.digest(convert_to(concat_ws('|',
    new.id::text,
    new.organization_id::text,
    new.aggregate_type,
    new.aggregate_id::text,
    new.aggregate_version::text,
    new.event_type,
    coalesce(new.session_id::text, ''),
    coalesce(new.actor_id::text, ''),
    coalesce(new.client_occurred_at::text, ''),
    new.recorded_at::text,
    coalesce(new.idempotency_key, ''),
    new.safe_metadata::text,
    new.protected_artifact_refs::text,
    coalesce(new.checkpoint_event_id::text, ''),
    new.schema_version::text,
    new.payload_sha256,
    coalesce(new.previous_event_sha256, ''),
    coalesce(new.correlation_id::text, ''),
    coalesce(new.causation_id::text, '')
  ), 'UTF8'), 'sha256'), 'hex');
  return new;
end;
$function$;

drop trigger if exists session_events_prepare on public.session_events;
create trigger session_events_prepare before insert on public.session_events
for each row execute function public.u2_prepare_session_event();

create or replace function public.lease_async_task(worker_id text, lease_for interval default interval '2 minutes')
returns setof public.async_tasks
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
begin
  if length(btrim(worker_id)) = 0 or lease_for <= interval '0 seconds' or lease_for > interval '15 minutes' then
    raise exception using errcode = '22023', message = 'invalid worker lease request';
  end if;
  return query
  with candidate as (
    select t.id
    from public.async_tasks t
    where t.state in ('queued', 'retry_wait')
      and t.available_at <= statement_timestamp()
      and t.attempt_count < t.max_attempts
    order by t.available_at, t.created_at
    for update skip locked
    limit 1
  )
  update public.async_tasks t
  set state = 'running',
      attempt_count = t.attempt_count + 1,
      lease_generation = t.lease_generation + 1,
      lease_token = extensions.gen_random_uuid(),
      leased_by = worker_id,
      leased_until = statement_timestamp() + lease_for,
      heartbeat_at = statement_timestamp()
  from candidate c
  where t.id = c.id
  returning t.*;
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
    and t.leased_until >= statement_timestamp();
  get diagnostics changed = row_count;
  return changed = 1;
end;
$function$;

revoke all on function public.lease_async_task(text, interval) from public, anon, authenticated;
revoke all on function public.complete_async_task(uuid, bigint, uuid, uuid) from public, anon, authenticated;
grant execute on function public.lease_async_task(text, interval) to service_role;
grant execute on function public.complete_async_task(uuid, bigint, uuid, uuid) to service_role;

create or replace function public.has_recipient_capability(
  target_organization_id uuid,
  target_job_id uuid,
  target_report_version_id uuid,
  target_module text,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.recipient_grants g
    join public.report_versions r
      on r.id = g.delivered_report_version_id and r.organization_id = g.organization_id
    where g.organization_id = target_organization_id
      and g.job_id = target_job_id
      and g.delivered_report_version_id = target_report_version_id
      and g.principal_actor_id = public.request_actor_id()
      and target_module = any (g.permitted_modules)
      and target_action = any (g.permitted_actions)
      and g.expires_at > statement_timestamp()
      and not exists (select 1 from public.recipient_grant_revocations rv where rv.grant_id = g.id)
      and not exists (
        select 1 from public.module_withdrawals w
        where w.module_id = r.module_id and w.snapshot_id = r.module_snapshot_id
      )
  )
$function$;

revoke all on function public.has_recipient_capability(uuid, uuid, uuid, text, text) from public;
grant execute on function public.has_recipient_capability(uuid, uuid, uuid, text, text) to authenticated, service_role;

create or replace function public.is_assigned_module_inspector(target_organization_id uuid, target_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.inspection_modules m
    join public.organization_members om
      on om.organization_id = m.organization_id
     and om.actor_id = m.assigned_inspector_actor_id
    where m.organization_id = target_organization_id
      and m.id = target_module_id
      and m.assigned_inspector_actor_id = public.request_actor_id()
      and om.member_role = 'inspector'
      and om.status = 'active'
  )
$function$;

create or replace function public.is_assigned_job_inspector(target_organization_id uuid, target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1 from public.inspection_modules m
    where m.organization_id = target_organization_id
      and m.job_id = target_job_id
      and public.is_assigned_module_inspector(m.organization_id, m.id)
  )
$function$;

revoke all on function public.is_assigned_module_inspector(uuid, uuid) from public;
revoke all on function public.is_assigned_job_inspector(uuid, uuid) from public;
grant execute on function public.is_assigned_module_inspector(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_assigned_job_inspector(uuid, uuid) to authenticated, service_role;

create or replace function public.u2_validate_artifact_relationships()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  row_data jsonb := to_jsonb(new);
begin
  if tg_table_name = 'artifact_links' and row_data ->> 'module_id' is not null and not exists (
    select 1 from public.inspection_modules m
    where m.id = (row_data ->> 'module_id')::uuid
      and m.organization_id = (row_data ->> 'organization_id')::uuid
      and m.job_id = (row_data ->> 'job_id')::uuid
  ) then
    raise exception using errcode = '23514', message = 'artifact link module must belong to the same job';
  end if;

  if tg_table_name = 'finding_evidence' and not exists (
    select 1
    from public.finding_versions fv
    join public.findings f on f.id = fv.finding_id and f.organization_id = fv.organization_id
    join public.inspection_modules m on m.id = f.module_id and m.organization_id = f.organization_id
    join public.artifacts a on a.id = (row_data ->> 'artifact_id')::uuid
      and a.organization_id = (row_data ->> 'organization_id')::uuid
    where fv.id = (row_data ->> 'finding_version_id')::uuid
      and fv.organization_id = (row_data ->> 'organization_id')::uuid
      and a.job_id = m.job_id
  ) then
    raise exception using errcode = '23514', message = 'finding evidence artifact must belong to the same job';
  end if;

  if tg_table_name = 'module_snapshot_artifacts' and not exists (
    select 1
    from public.module_snapshots s
    join public.artifacts a on a.id = (row_data ->> 'artifact_id')::uuid
      and a.organization_id = (row_data ->> 'organization_id')::uuid
    where s.id = (row_data ->> 'snapshot_id')::uuid
      and s.organization_id = (row_data ->> 'organization_id')::uuid
      and a.job_id = s.job_id
      and a.content_sha256 = row_data ->> 'artifact_sha256'
  ) then
    raise exception using errcode = '23514', message = 'snapshot artifact must belong to the same job and bind its exact checksum';
  end if;

  if tg_table_name = 'report_artifacts' and not exists (
    select 1
    from public.report_versions r
    join public.artifacts a on a.id = (row_data ->> 'artifact_id')::uuid
      and a.organization_id = (row_data ->> 'organization_id')::uuid
    where r.id = (row_data ->> 'report_version_id')::uuid
      and r.organization_id = (row_data ->> 'organization_id')::uuid
      and a.job_id = r.job_id
  ) then
    raise exception using errcode = '23514', message = 'report artifact must belong to the same job';
  end if;

  return new;
end;
$function$;

drop trigger if exists artifact_links_validate_relationship on public.artifact_links;
create trigger artifact_links_validate_relationship before insert on public.artifact_links
for each row execute function public.u2_validate_artifact_relationships();
drop trigger if exists finding_evidence_validate_relationship on public.finding_evidence;
create trigger finding_evidence_validate_relationship before insert on public.finding_evidence
for each row execute function public.u2_validate_artifact_relationships();
drop trigger if exists module_snapshot_artifacts_validate_relationship on public.module_snapshot_artifacts;
create trigger module_snapshot_artifacts_validate_relationship before insert on public.module_snapshot_artifacts
for each row execute function public.u2_validate_artifact_relationships();
drop trigger if exists report_artifacts_validate_relationship on public.report_artifacts;
create trigger report_artifacts_validate_relationship before insert on public.report_artifacts
for each row execute function public.u2_validate_artifact_relationships();

create or replace function public.u2_validate_recipient_grant()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  report_row public.report_versions%rowtype;
begin
  select * into report_row
  from public.report_versions r
  where r.id = new.delivered_report_version_id and r.organization_id = new.organization_id;
  if not found
     or report_row.job_id <> new.job_id
     or not report_row.module_type = any (new.permitted_modules) then
    raise exception using errcode = '23514', message = 'recipient grant must bind its exact job, delivered report version and module';
  end if;
  return new;
end;
$function$;

drop trigger if exists recipient_grants_validate on public.recipient_grants;
create trigger recipient_grants_validate before insert on public.recipient_grants
for each row execute function public.u2_validate_recipient_grant();

create or replace function public.u2_validate_lifecycle_hold()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if exists (
    select 1
    from public.lifecycle_holds h
    where h.organization_id = new.organization_id
      and h.target_class = new.target_class
      and h.target_id = new.target_id
      and h.hold_kind = new.hold_kind
      and not exists (select 1 from public.lifecycle_hold_releases r where r.hold_id = h.id)
  ) then
    raise exception using errcode = '23505', message = 'an active lifecycle hold already exists for this target and kind';
  end if;
  return new;
end;
$function$;

drop trigger if exists lifecycle_holds_only_one_active on public.lifecycle_holds;
create trigger lifecycle_holds_only_one_active before insert on public.lifecycle_holds
for each row execute function public.u2_validate_lifecycle_hold();

-- History rows are structurally immutable even for privileged application roles.
do $block$
declare
  table_name text;
begin
  foreach table_name in array array[
    'artifacts', 'artifact_durability_receipts', 'artifact_derivations', 'artifact_links', 'artifact_tombstones',
    'finding_versions', 'finding_evidence', 'coverage_entries', 'module_limitations', 'module_conclusions',
    'module_snapshots', 'module_snapshot_findings', 'module_snapshot_artifacts', 'module_approvals', 'module_withdrawals',
    'report_versions', 'report_artifacts', 'delivery_packages', 'delivery_package_modules',
    'delivery_package_events', 'deliveries', 'delivery_events', 'recipient_grants', 'recipient_grant_revocations',
    'session_events', 'lifecycle_holds', 'lifecycle_hold_releases', 'lifecycle_suppressions', 'data_lifecycle_policies'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_reject_mutation', table_name);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.u2_reject_mutation()', table_name || '_reject_mutation', table_name);
  end loop;
end;
$block$;

-- RLS is enabled on every tenant/capability surface. Service-role code remains a
-- trusted server boundary; authenticated users receive only explicit policies.
do $block$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'actors', 'organization_members', 'jobs', 'job_participants', 'inspection_modules',
    'artifacts', 'artifact_durability_receipts', 'artifact_derivations', 'artifact_links', 'artifact_tombstones',
    'findings', 'finding_versions', 'finding_evidence', 'coverage_entries', 'module_limitations', 'module_conclusions',
    'module_snapshots', 'module_snapshot_findings', 'module_snapshot_artifacts', 'module_approvals', 'module_withdrawals',
    'report_versions', 'report_artifacts', 'delivery_packages', 'delivery_package_modules',
    'delivery_package_events', 'deliveries', 'delivery_events', 'recipient_grants', 'recipient_grant_revocations',
    'sessions', 'session_events', 'webhook_inbox', 'async_tasks', 'outbox_records',
    'lifecycle_holds', 'lifecycle_hold_releases', 'lifecycle_suppressions', 'data_lifecycle_policies'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end;
$block$;

drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations for select to authenticated
using (public.is_organization_member(id));

drop policy if exists actors_self_or_tenant_select on public.actors;
create policy actors_self_or_tenant_select on public.actors for select to authenticated
using (
  id = public.request_actor_id()
  or exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.actor_id = public.request_actor_id() and mine.status = 'active' and theirs.actor_id = actors.id
  )
);

drop policy if exists organization_members_tenant_select on public.organization_members;
create policy organization_members_tenant_select on public.organization_members for select to authenticated
using (public.is_organization_member(organization_id));

do $block$
declare
  table_name text;
begin
  foreach table_name in array array[
    'jobs', 'job_participants', 'inspection_modules', 'artifact_durability_receipts', 'artifact_derivations',
    'artifact_links', 'artifact_tombstones', 'findings', 'finding_versions', 'finding_evidence', 'coverage_entries',
    'module_limitations', 'module_conclusions', 'module_snapshots', 'module_snapshot_findings',
    'module_snapshot_artifacts', 'module_approvals', 'module_withdrawals', 'delivery_packages',
    'delivery_package_modules', 'delivery_package_events', 'deliveries', 'delivery_events',
    'recipient_grants', 'recipient_grant_revocations', 'sessions', 'session_events', 'webhook_inbox',
    'async_tasks', 'outbox_records', 'lifecycle_holds', 'lifecycle_hold_releases', 'lifecycle_suppressions', 'data_lifecycle_policies'
  ] loop
    execute format('drop policy if exists tenant_member_select on public.%I', table_name);
    execute format('create policy tenant_member_select on public.%I for select to authenticated using (public.is_organization_member(organization_id))', table_name);
  end loop;
end;
$block$;

drop policy if exists artifacts_staff_or_recipient_select on public.artifacts;
create policy artifacts_staff_or_recipient_select on public.artifacts for select to authenticated
using (
  public.is_organization_member(organization_id)
  or exists (
    select 1
    from public.report_artifacts ra
    join public.report_versions rv on rv.id = ra.report_version_id and rv.organization_id = ra.organization_id
    where ra.artifact_id = artifacts.id
      and public.has_recipient_capability(rv.organization_id, rv.job_id, rv.id, rv.module_type, 'view_media')
  )
);

drop policy if exists report_versions_staff_or_recipient_select on public.report_versions;
create policy report_versions_staff_or_recipient_select on public.report_versions for select to authenticated
using (
  public.is_organization_member(organization_id)
  or public.has_recipient_capability(organization_id, job_id, id, module_type, 'read')
);

drop policy if exists report_artifacts_staff_or_recipient_select on public.report_artifacts;
create policy report_artifacts_staff_or_recipient_select on public.report_artifacts for select to authenticated
using (
  public.is_organization_member(organization_id)
  or exists (
    select 1 from public.report_versions rv
    where rv.id = report_artifacts.report_version_id
      and public.has_recipient_capability(rv.organization_id, rv.job_id, rv.id, rv.module_type, 'view_media')
  )
);

-- Direct authenticated writes are intentionally narrow; trusted business
-- transitions run through the server boundary. Inspectors may append evidence
-- and professional history only inside a tenant where they are active.
do $block$
declare
  table_name text;
begin
  foreach table_name in array array[
    'artifacts', 'artifact_durability_receipts', 'artifact_derivations', 'artifact_links', 'artifact_tombstones',
    'findings', 'finding_versions', 'finding_evidence', 'coverage_entries', 'module_limitations', 'module_conclusions',
    'module_snapshots', 'module_snapshot_findings', 'module_snapshot_artifacts', 'module_approvals', 'module_withdrawals',
    'session_events'
  ] loop
    execute format('grant insert on public.%I to authenticated', table_name);
    execute format('drop policy if exists tenant_professional_insert on public.%I', table_name);
  end loop;
end;
$block$;

create policy tenant_professional_insert on public.artifacts for insert to authenticated
with check (public.is_assigned_job_inspector(organization_id, job_id));
create policy tenant_professional_insert on public.artifact_durability_receipts for insert to authenticated
with check (exists (select 1 from public.artifacts a where a.id = artifact_id and public.is_assigned_job_inspector(a.organization_id, a.job_id)));
create policy tenant_professional_insert on public.artifact_derivations for insert to authenticated
with check (exists (select 1 from public.artifacts a where a.id = parent_artifact_id and public.is_assigned_job_inspector(a.organization_id, a.job_id)));
create policy tenant_professional_insert on public.artifact_links for insert to authenticated
with check (
  public.is_assigned_job_inspector(organization_id, job_id)
  and (module_id is null or public.is_assigned_module_inspector(organization_id, module_id))
);
create policy tenant_professional_insert on public.artifact_tombstones for insert to authenticated
with check (exists (select 1 from public.artifacts a where a.id = artifact_id and public.is_assigned_job_inspector(a.organization_id, a.job_id)));
create policy tenant_professional_insert on public.findings for insert to authenticated
with check (public.is_assigned_module_inspector(organization_id, module_id));
create policy tenant_professional_insert on public.finding_versions for insert to authenticated
with check (exists (
  select 1 from public.findings f
  where f.id = finding_id and public.is_assigned_module_inspector(f.organization_id, f.module_id)
));
create policy tenant_professional_insert on public.finding_evidence for insert to authenticated
with check (exists (
  select 1 from public.finding_versions fv
  join public.findings f on f.id = fv.finding_id and f.organization_id = fv.organization_id
  where fv.id = finding_version_id and public.is_assigned_module_inspector(f.organization_id, f.module_id)
));
create policy tenant_professional_insert on public.coverage_entries for insert to authenticated
with check (public.is_assigned_module_inspector(organization_id, module_id));
create policy tenant_professional_insert on public.module_limitations for insert to authenticated
with check (public.is_assigned_module_inspector(organization_id, module_id));
create policy tenant_professional_insert on public.module_conclusions for insert to authenticated
with check (public.is_assigned_module_inspector(organization_id, module_id));
create policy tenant_professional_insert on public.module_snapshots for insert to authenticated
with check (public.is_assigned_module_inspector(organization_id, module_id));
create policy tenant_professional_insert on public.module_snapshot_findings for insert to authenticated
with check (exists (
  select 1 from public.module_snapshots s
  where s.id = snapshot_id and public.is_assigned_module_inspector(s.organization_id, s.module_id)
));
create policy tenant_professional_insert on public.module_snapshot_artifacts for insert to authenticated
with check (exists (
  select 1 from public.module_snapshots s
  where s.id = snapshot_id and public.is_assigned_module_inspector(s.organization_id, s.module_id)
));
create policy tenant_professional_insert on public.module_approvals for insert to authenticated
with check (public.is_assigned_module_inspector(organization_id, module_id));
create policy tenant_professional_insert on public.module_withdrawals for insert to authenticated
with check (public.is_assigned_module_inspector(organization_id, module_id));
create policy tenant_professional_insert on public.session_events for insert to authenticated
with check (public.has_organization_role(organization_id, array['inspector', 'administrator']));

grant update on public.jobs, public.inspection_modules, public.findings, public.sessions to authenticated;
drop policy if exists jobs_tenant_update on public.jobs;
create policy jobs_tenant_update on public.jobs for update to authenticated
using (public.has_organization_role(organization_id, array['administrator', 'inspector']))
with check (public.has_organization_role(organization_id, array['administrator', 'inspector']));
drop policy if exists inspection_modules_tenant_update on public.inspection_modules;
create policy inspection_modules_tenant_update on public.inspection_modules for update to authenticated
using (public.is_assigned_module_inspector(organization_id, id))
with check (public.is_assigned_module_inspector(organization_id, id));
drop policy if exists findings_tenant_update on public.findings;
create policy findings_tenant_update on public.findings for update to authenticated
using (public.is_assigned_module_inspector(organization_id, module_id))
with check (public.is_assigned_module_inspector(organization_id, module_id));
drop policy if exists sessions_tenant_update on public.sessions;
create policy sessions_tenant_update on public.sessions for update to authenticated
using (actor_id = public.request_actor_id() or public.has_organization_role(organization_id, array['administrator']))
with check (actor_id = public.request_actor_id() or public.has_organization_role(organization_id, array['administrator']));

grant select on public.delivery_package_current_state, public.delivery_current_state to service_role;
do $block$
begin
  if current_setting('server_version_num')::integer >= 150000 then
    grant select on public.delivery_package_current_state, public.delivery_current_state to authenticated;
  else
    revoke all on public.delivery_package_current_state, public.delivery_current_state from authenticated;
  end if;
end;
$block$;

-- Private object paths are rooted by organization UUID. Recipient media is
-- mediated by short-lived server checks rather than permanent Storage URLs.
do $block$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public)
    values ('inspection-evidence', 'inspection-evidence', false)
    on conflict (id) do update set public = false;

    execute 'drop policy if exists inspection_evidence_staff_read on storage.objects';
    execute $policy$
      create policy inspection_evidence_staff_read on storage.objects for select to authenticated
      using (
        bucket_id = 'inspection-evidence'
        and public.is_organization_member(((storage.foldername(name))[1])::uuid)
      )
    $policy$;
    execute 'drop policy if exists inspection_evidence_staff_insert on storage.objects';
    execute $policy$
      create policy inspection_evidence_staff_insert on storage.objects for insert to authenticated
      with check (
        bucket_id = 'inspection-evidence'
        and public.has_organization_role(((storage.foldername(name))[1])::uuid, array['inspector', 'administrator'])
      )
    $policy$;
  end if;
end;
$block$;
