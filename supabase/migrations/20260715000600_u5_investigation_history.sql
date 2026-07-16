-- U5 server persistence: append-only investigation capture history.

create unique index if not exists inspection_modules_id_org_job_type_uq
  on public.inspection_modules (id, organization_id, job_id, module_type);

create table if not exists public.inspection_areas (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  area_key text not null check (length(btrim(area_key)) between 1 and 120),
  label text not null check (length(btrim(label)) between 1 and 200),
  ordinal integer not null check (ordinal > 0),
  applicable_module_types text[] not null check (
    cardinality(applicable_module_types) > 0
    and applicable_module_types <@ array['building', 'timber_pest']::text[]
  ),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  unique (organization_id, job_id, area_key),
  unique (organization_id, job_id, ordinal),
  unique (id, organization_id),
  unique (id, organization_id, job_id)
);

create table if not exists public.investigations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  started_by_inspector_actor_id uuid not null references public.actors(id) on delete restrict,
  started_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  unique (id, organization_id),
  unique (id, organization_id, job_id)
);

create table if not exists public.investigation_modules (
  organization_id uuid not null,
  job_id uuid not null,
  investigation_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  linked_at timestamptz not null default statement_timestamp(),
  primary key (investigation_id, module_id),
  foreign key (investigation_id, organization_id, job_id)
    references public.investigations(id, organization_id, job_id) on delete restrict,
  foreign key (module_id, organization_id, job_id, module_type)
    references public.inspection_modules(id, organization_id, job_id, module_type) on delete restrict,
  unique (investigation_id, module_type)
);

create table if not exists public.investigation_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  investigation_id uuid not null,
  revision bigint not null check (revision >= 0),
  expected_previous_revision bigint check (expected_previous_revision is null or expected_previous_revision >= 0),
  status text not null check (status in (
    'active', 'paused', 'completed_findings', 'completed_no_reportable_finding'
  )),
  current_area_id uuid not null,
  completed_at timestamptz,
  completed_by_inspector_actor_id uuid references public.actors(id) on delete restrict,
  drafting_disposition text check (drafting_disposition in ('manual_only', 'queue_ai_asynchronously')),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (investigation_id, organization_id, job_id)
    references public.investigations(id, organization_id, job_id) on delete restrict,
  foreign key (current_area_id, organization_id, job_id)
    references public.inspection_areas(id, organization_id, job_id) on delete restrict,
  unique (investigation_id, revision),
  unique (id, organization_id),
  check (
    (revision = 0 and expected_previous_revision is null)
    or (revision > 0 and expected_previous_revision = revision - 1)
  ),
  check (
    (status in ('active', 'paused') and completed_at is null
      and completed_by_inspector_actor_id is null and drafting_disposition is null)
    or (status in ('completed_findings', 'completed_no_reportable_finding')
      and completed_at is not null and completed_by_inspector_actor_id is not null
      and drafting_disposition is not null)
  )
);

create or replace function public.u5_require_investigation_initial_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if not exists (
    select 1 from public.investigation_modules m where m.investigation_id = new.id
  ) or not exists (
    select 1 from public.investigation_revisions r
    where r.investigation_id = new.id and r.revision = 0 and r.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'investigation requires commissioned modules and active revision zero';
  end if;
  return null;
end;
$function$;

drop trigger if exists investigations_require_initial_state on public.investigations;
create constraint trigger investigations_require_initial_state
after insert on public.investigations
deferrable initially deferred
for each row execute function public.u5_require_investigation_initial_state();

create or replace function public.u5_validate_investigation_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare previous_revision public.investigation_revisions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    new.organization_id::text || ':investigation:' || new.investigation_id::text, 0
  ));
  select * into previous_revision
  from public.investigation_revisions r
  where r.investigation_id = new.investigation_id
    and r.organization_id = new.organization_id
  order by r.revision desc limit 1;
  if not found then
    if new.revision <> 0 or new.expected_previous_revision is not null or new.status <> 'active' then
      raise exception using errcode = '40001', message = 'investigation must begin at active revision zero';
    end if;
    return new;
  end if;
  if new.revision <> previous_revision.revision + 1
    or new.expected_previous_revision is distinct from previous_revision.revision
  then
    raise exception using errcode = '40001', message = 'stale or non-contiguous investigation revision';
  end if;
  if previous_revision.status in ('completed_findings', 'completed_no_reportable_finding') then
    raise exception using errcode = '55000', message = 'completed investigation is immutable';
  end if;
  if (previous_revision.status = 'paused' and new.status <> 'active')
    or (previous_revision.status = 'active' and new.status not in (
      'active', 'paused', 'completed_findings', 'completed_no_reportable_finding'
    ))
  then
    raise exception using errcode = '23514', message = 'invalid investigation status transition';
  end if;
  if new.current_area_id <> previous_revision.current_area_id
    and (previous_revision.status <> 'active' or new.status <> 'active')
  then
    raise exception using errcode = '23514', message = 'area may change only while investigation remains active';
  end if;
  return new;
end;
$function$;

create or replace function public.u5_append_investigation_revision_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare previous_status text; selected_event_type text; previous_event_hash text;
begin
  select r.status into previous_status
  from public.investigation_revisions r
  where r.investigation_id = new.investigation_id and r.revision = new.revision - 1;
  select e.event_sha256 into previous_event_hash
  from public.session_events e
  where e.organization_id = new.organization_id
    and e.aggregate_type = 'investigation'
    and e.aggregate_id = new.investigation_id
    and e.aggregate_version = new.revision;
  selected_event_type := case
    when new.revision = 0 then 'investigation.started'
    when new.status = 'paused' then 'investigation.paused'
    when previous_status = 'paused' and new.status = 'active' then 'investigation.resumed'
    when new.status in ('completed_findings', 'completed_no_reportable_finding') then 'investigation.completed'
    else 'investigation.revised'
  end;
  insert into public.session_events (
    organization_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, actor_id, idempotency_key, safe_metadata, payload_sha256,
    previous_event_sha256, event_sha256
  ) values (
    new.organization_id, 'investigation', new.investigation_id, new.revision + 1,
    selected_event_type,
    coalesce(new.completed_by_inspector_actor_id,
      (select i.started_by_inspector_actor_id from public.investigations i where i.id = new.investigation_id)),
    concat('investigation:', new.investigation_id::text, ':revision:', new.revision::text),
    jsonb_build_object(
      'revision', new.revision,
      'status', new.status,
      'current_area_id', new.current_area_id
    ),
    new.content_sha256, previous_event_hash, repeat('0', 64)
  );
  return new;
end;
$function$;

drop trigger if exists investigation_revisions_validate on public.investigation_revisions;
create trigger investigation_revisions_validate
before insert on public.investigation_revisions
for each row execute function public.u5_validate_investigation_revision();
drop trigger if exists investigation_revisions_append_event on public.investigation_revisions;
create trigger investigation_revisions_append_event
after insert on public.investigation_revisions
for each row execute function public.u5_append_investigation_revision_event();

create table if not exists public.investigation_areas (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  investigation_id uuid not null,
  area_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  entered_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (investigation_id, organization_id, job_id)
    references public.investigations(id, organization_id, job_id) on delete restrict,
  foreign key (area_id, organization_id, job_id)
    references public.inspection_areas(id, organization_id, job_id) on delete restrict,
  unique (investigation_id, ordinal)
);

create table if not exists public.investigation_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  investigation_id uuid not null,
  artifact_id uuid not null,
  capture_area_id uuid not null,
  link_ordinal integer not null check (link_ordinal > 0),
  source text not null check (source in ('attached_recent', 'captured_during_investigation')),
  attached_by_inspector_actor_id uuid not null references public.actors(id) on delete restrict,
  attached_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (investigation_id, organization_id, job_id)
    references public.investigations(id, organization_id, job_id) on delete restrict,
  foreign key (artifact_id, organization_id, job_id)
    references public.artifacts(id, organization_id, job_id) on delete restrict,
  foreign key (capture_area_id, organization_id, job_id)
    references public.inspection_areas(id, organization_id, job_id) on delete restrict,
  unique (investigation_id, artifact_id),
  unique (investigation_id, link_ordinal),
  unique (id, organization_id, investigation_id)
);

create table if not exists public.investigation_artifact_area_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  investigation_id uuid not null,
  investigation_artifact_id uuid not null,
  area_id uuid not null,
  assignment_ordinal integer not null check (assignment_ordinal > 0),
  reason text not null check (reason in ('capture_context', 'inspector_correction')),
  assigned_by_inspector_actor_id uuid not null references public.actors(id) on delete restrict,
  assigned_at timestamptz not null,
  foreign key (investigation_artifact_id, organization_id, investigation_id)
    references public.investigation_artifacts(id, organization_id, investigation_id) on delete restrict,
  foreign key (area_id, organization_id) references public.inspection_areas(id, organization_id) on delete restrict,
  unique (investigation_artifact_id, assignment_ordinal)
);

create table if not exists public.investigation_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  investigation_id uuid not null,
  area_id uuid not null,
  note_kind text not null check (note_kind in ('observation', 'manual_note')),
  protected_artifact_id uuid not null,
  recorded_by_inspector_actor_id uuid not null references public.actors(id) on delete restrict,
  recorded_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (investigation_id, organization_id, job_id)
    references public.investigations(id, organization_id, job_id) on delete restrict,
  foreign key (area_id, organization_id, job_id)
    references public.inspection_areas(id, organization_id, job_id) on delete restrict,
  foreign key (protected_artifact_id, organization_id, job_id)
    references public.artifacts(id, organization_id, job_id) on delete restrict,
  unique (investigation_id, protected_artifact_id)
);

create table if not exists public.measurements (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  investigation_id uuid not null,
  area_id uuid not null,
  measurement_kind text not null check (measurement_kind in (
    'crack_width', 'length', 'level_variation', 'moisture_reading', 'other'
  )),
  measured_value numeric not null check (
    measured_value not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  ),
  measurement_unit text not null check (measurement_unit in (
    'millimetres', 'percent', 'relative_scale', 'metres', 'other'
  )),
  protected_note_artifact_id uuid,
  measured_by_inspector_actor_id uuid not null references public.actors(id) on delete restrict,
  measured_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (investigation_id, organization_id, job_id)
    references public.investigations(id, organization_id, job_id) on delete restrict,
  foreign key (area_id, organization_id, job_id)
    references public.inspection_areas(id, organization_id, job_id) on delete restrict,
  foreign key (protected_note_artifact_id, organization_id, job_id)
    references public.artifacts(id, organization_id, job_id) on delete restrict,
  unique (id, organization_id, investigation_id)
);

create or replace function public.u5_require_active_investigation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if not exists (
    select 1 from public.investigation_revisions r
    where r.investigation_id = new.investigation_id
      and r.organization_id = new.organization_id
      and r.status = 'active'
      and not exists (
        select 1 from public.investigation_revisions later
        where later.investigation_id = r.investigation_id and later.revision > r.revision
      )
  ) then
    raise exception using errcode = '55000', message = 'investigation is not active';
  end if;
  return new;
end;
$function$;

create or replace function public.u5_validate_tenant_inspector_actor()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare target_actor_id uuid;
begin
  target_actor_id := coalesce(
    nullif(to_jsonb(new) ->> 'started_by_inspector_actor_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'completed_by_inspector_actor_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'attached_by_inspector_actor_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'assigned_by_inspector_actor_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'recorded_by_inspector_actor_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'measured_by_inspector_actor_id', '')::uuid
  );
  if target_actor_id is not null and not exists (
    select 1 from public.organization_members member
    join public.actors actor on actor.id = member.actor_id
    where member.organization_id = new.organization_id
      and member.actor_id = target_actor_id
      and member.member_role in ('inspector', 'administrator')
      and member.status = 'active' and actor.disabled_at is null
  ) then
    raise exception using errcode = '23514', message = 'inspector actor is outside the active tenant';
  end if;
  return new;
end;
$function$;

create or replace function public.u5_validate_investigation_artifact()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if not exists (
    select 1 from public.artifacts a
    join public.artifact_durability_receipts receipt
      on receipt.artifact_id = a.id and receipt.organization_id = a.organization_id
    where a.id = new.artifact_id and a.organization_id = new.organization_id
      and a.job_id = new.job_id and a.artifact_kind in ('photo', 'audio', 'structured_json')
  ) then
    raise exception using errcode = '23514', message = 'investigation evidence requires a durable original artifact';
  end if;
  return new;
end;
$function$;

create or replace function public.u5_validate_protected_note_artifact()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare target_artifact_id uuid;
begin
  target_artifact_id := coalesce(
    nullif(to_jsonb(new) ->> 'protected_note_artifact_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'protected_artifact_id', '')::uuid
  );
  if target_artifact_id is not null and not exists (
    select 1 from public.artifacts a
    join public.artifact_durability_receipts receipt
      on receipt.artifact_id = a.id and receipt.organization_id = a.organization_id
    where a.id = target_artifact_id and a.organization_id = new.organization_id
      and a.job_id = new.job_id and a.artifact_kind = 'structured_json'
      and a.evidence_visibility = 'protected'
  ) then
    raise exception using errcode = '23514', message = 'note content must be a durable protected artifact';
  end if;
  return new;
end;
$function$;

create trigger investigation_artifacts_validate_original
before insert on public.investigation_artifacts
for each row execute function public.u5_validate_investigation_artifact();
create trigger investigation_notes_validate_artifact
before insert on public.investigation_notes
for each row execute function public.u5_validate_protected_note_artifact();
create trigger measurements_validate_note_artifact
before insert on public.measurements
for each row execute function public.u5_validate_protected_note_artifact();

create trigger investigations_validate_actor
before insert on public.investigations
for each row execute function public.u5_validate_tenant_inspector_actor();
create trigger investigation_revisions_validate_actor
before insert on public.investigation_revisions
for each row execute function public.u5_validate_tenant_inspector_actor();
create trigger investigation_artifacts_validate_actor
before insert on public.investigation_artifacts
for each row execute function public.u5_validate_tenant_inspector_actor();
create trigger investigation_assignments_validate_actor
before insert on public.investigation_artifact_area_assignments
for each row execute function public.u5_validate_tenant_inspector_actor();
create trigger investigation_notes_validate_actor
before insert on public.investigation_notes
for each row execute function public.u5_validate_tenant_inspector_actor();
create trigger measurements_validate_actor
before insert on public.measurements
for each row execute function public.u5_validate_tenant_inspector_actor();

do $block$
declare table_name text;
begin
  foreach table_name in array array[
    'inspection_areas', 'investigations', 'investigation_modules',
    'investigation_revisions', 'investigation_areas', 'investigation_artifacts',
    'investigation_artifact_area_assignments', 'investigation_notes', 'measurements'
  ] loop
    execute format('drop trigger if exists %I_reject_mutation on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_reject_mutation before update or delete on public.%I for each row execute function public.u2_reject_mutation()',
      table_name, table_name
    );
  end loop;
  foreach table_name in array array[
    'investigation_modules', 'investigation_areas', 'investigation_artifacts',
    'investigation_artifact_area_assignments', 'investigation_notes', 'measurements'
  ] loop
    execute format(
      'create trigger %I_require_active before insert on public.%I for each row execute function public.u5_require_active_investigation()',
      table_name, table_name
    );
  end loop;
end;
$block$;

create or replace view public.investigation_current_state as
select distinct on (r.investigation_id)
  r.id as revision_id, r.organization_id, r.job_id, r.investigation_id,
  r.revision, r.status, r.current_area_id, r.completed_at,
  r.completed_by_inspector_actor_id, r.drafting_disposition, r.content_sha256,
  r.recorded_at
from public.investigation_revisions r
order by r.investigation_id, r.revision desc;

do $block$
declare table_name text;
begin
  foreach table_name in array array[
    'inspection_areas', 'investigations', 'investigation_modules',
    'investigation_revisions', 'investigation_areas', 'investigation_artifacts',
    'investigation_artifact_area_assignments', 'investigation_notes', 'measurements'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('drop policy if exists tenant_member_select on public.%I', table_name);
    execute format(
      'create policy tenant_member_select on public.%I for select to authenticated using (public.is_organization_member(organization_id))',
      table_name
    );
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated, service_role', table_name);
    execute format('grant insert on table public.%I to service_role', table_name);
  end loop;
end;
$block$;

grant select on public.investigation_current_state to service_role;
do $block$
begin
  if current_setting('server_version_num')::integer >= 150000 then
    execute 'alter view public.investigation_current_state set (security_invoker = true)';
    grant select on public.investigation_current_state to authenticated;
  else
    revoke all on public.investigation_current_state from authenticated;
  end if;
end;
$block$;
revoke all on function public.u5_validate_investigation_revision() from public, anon, authenticated;
revoke all on function public.u5_require_investigation_initial_state() from public, anon, authenticated;
revoke all on function public.u5_append_investigation_revision_event() from public, anon, authenticated;
revoke all on function public.u5_require_active_investigation() from public, anon, authenticated;
revoke all on function public.u5_validate_tenant_inspector_actor() from public, anon, authenticated;
revoke all on function public.u5_validate_investigation_artifact() from public, anon, authenticated;
revoke all on function public.u5_validate_protected_note_artifact() from public, anon, authenticated;
