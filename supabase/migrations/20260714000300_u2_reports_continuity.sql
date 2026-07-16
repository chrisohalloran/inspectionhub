-- U2: formal report history, delivery/access capabilities, append-only continuity,
-- fenced work, provider inbox/outbox, and lifecycle ledgers.

create table if not exists public.report_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  module_snapshot_id uuid not null,
  report_version bigint not null check (report_version > 0),
  expected_module_revision bigint not null check (expected_module_revision >= 0),
  structured_snapshot jsonb not null check (jsonb_typeof(structured_snapshot) = 'object'),
  canonical_sha256 text not null check (canonical_sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_report_version_id uuid,
  amendment_reason text,
  change_notice text,
  issued_by_actor_id uuid not null references public.actors(id) on delete restrict,
  issued_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  foreign key (module_id, organization_id, module_type) references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  foreign key (module_snapshot_id, organization_id, module_type) references public.module_snapshots(id, organization_id, module_type) on delete restrict,
  foreign key (supersedes_report_version_id, organization_id) references public.report_versions(id, organization_id) on delete restrict,
  unique (module_id, report_version),
  unique (id, organization_id),
  unique (id, organization_id, module_type),
  check (
    (supersedes_report_version_id is null and report_version = 1 and amendment_reason is null and change_notice is null)
    or
    (supersedes_report_version_id is not null and report_version > 1 and length(btrim(amendment_reason)) > 0 and length(btrim(change_notice)) > 0)
  )
);

create table if not exists public.report_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  report_version_id uuid not null,
  artifact_id uuid not null,
  presentation_role text not null check (presentation_role in ('primary', 'annotation', 'context', 'pdf', 'agreement', 'invoice', 'combined_bundle')),
  ordinal integer not null check (ordinal > 0),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (report_version_id, organization_id) references public.report_versions(id, organization_id) on delete restrict,
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (report_version_id, artifact_id, presentation_role),
  unique (report_version_id, ordinal)
);

alter table public.inspection_modules
  drop constraint if exists inspection_modules_current_report_version_fk;
alter table public.inspection_modules
  add constraint inspection_modules_current_report_version_fk
  foreign key (current_report_version_id, organization_id) references public.report_versions(id, organization_id) deferrable initially deferred;

create table if not exists public.delivery_packages (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  expected_job_revision bigint not null check (expected_job_revision >= 0),
  durability_manifest_sha256 text not null check (durability_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 240),
  confirmed_by_actor_id uuid not null references public.actors(id) on delete restrict,
  confirmed_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  unique (organization_id, idempotency_key),
  unique (id, organization_id)
);

create table if not exists public.delivery_package_modules (
  package_id uuid not null,
  organization_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  module_snapshot_id uuid not null,
  approval_id uuid not null,
  report_version_id uuid not null,
  primary key (package_id, module_type),
  foreign key (package_id, organization_id) references public.delivery_packages(id, organization_id) on delete restrict,
  foreign key (module_id, organization_id, module_type) references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  foreign key (module_snapshot_id, organization_id, module_type) references public.module_snapshots(id, organization_id, module_type) on delete restrict,
  foreign key (approval_id, organization_id) references public.module_approvals(id, organization_id) on delete restrict,
  foreign key (report_version_id, organization_id, module_type) references public.report_versions(id, organization_id, module_type) on delete restrict,
  unique (package_id, module_id),
  unique (package_id, report_version_id)
);

create table if not exists public.delivery_package_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  package_id uuid not null,
  package_version bigint not null check (package_version > 0),
  state text not null check (state in ('confirmed', 'queued', 'cancelled', 'withdrawn', 'ready', 'send_requested', 'terminal_failure')),
  reason text,
  actor_id uuid references public.actors(id) on delete restrict,
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (package_id, organization_id) references public.delivery_packages(id, organization_id) on delete restrict,
  unique (package_id, package_version)
);

create table if not exists public.deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  package_id uuid not null,
  recipient_actor_id uuid not null references public.actors(id) on delete restrict,
  provider text not null,
  provider_destination_ref text not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 240),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (package_id, organization_id) references public.delivery_packages(id, organization_id) on delete restrict,
  unique (organization_id, idempotency_key),
  unique (id, organization_id)
);

create table if not exists public.delivery_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  delivery_id uuid not null,
  delivery_version bigint not null check (delivery_version > 0),
  state text not null
    check (state in ('requested', 'provider_accepted', 'sent', 'delivered', 'bounced', 'failed', 'unknown', 'cancelled')),
  provider_observation_ref text,
  detail_code text,
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (delivery_id, organization_id) references public.deliveries(id, organization_id) on delete restrict,
  unique (delivery_id, delivery_version)
);

create table if not exists public.recipient_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  principal_actor_id uuid not null references public.actors(id) on delete restrict,
  job_id uuid not null,
  delivered_report_version_id uuid not null,
  permitted_modules text[] not null,
  permitted_actions text[] not null,
  expires_at timestamptz not null,
  issued_by_actor_id uuid not null references public.actors(id) on delete restrict,
  issued_at timestamptz not null default statement_timestamp(),
  invitation_id uuid not null unique,
  redeemed_at timestamptz not null,
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  foreign key (delivered_report_version_id, organization_id) references public.report_versions(id, organization_id) on delete restrict,
  unique (id, organization_id),
  check (expires_at > issued_at),
  check (cardinality(permitted_modules) between 1 and 2),
  check (permitted_modules <@ array['building', 'timber_pest']::text[]),
  check (cardinality(permitted_actions) > 0),
  check (permitted_actions <@ array['read', 'download_pdf', 'view_media', 'share']::text[])
);

create table if not exists public.recipient_grant_revocations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  grant_id uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  revoked_by_actor_id uuid not null references public.actors(id) on delete restrict,
  revoked_at timestamptz not null default statement_timestamp(),
  foreign key (grant_id, organization_id) references public.recipient_grants(id, organization_id) on delete restrict,
  unique (organization_id, grant_id)
);

create table if not exists public.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references public.actors(id) on delete restrict,
  session_kind text not null check (session_kind in ('user', 'agent', 'worker', 'provider_reconciliation', 'restore')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'failed', 'revoked', 'compacted')),
  parent_session_id uuid,
  started_at timestamptz not null default statement_timestamp(),
  ended_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  foreign key (parent_session_id, organization_id) references public.sessions(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

create table if not exists public.session_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  aggregate_type text not null check (length(btrim(aggregate_type)) between 1 and 120),
  aggregate_id uuid not null,
  aggregate_version bigint not null check (aggregate_version > 0),
  session_id uuid,
  event_type text not null check (event_type ~ '^(booking|agreement|payment|access|inspection|area|artifact|investigation|transcription|agent|tool|verifier|finding|approval|report|delivery|recipient_access|amendment|system)\.[a-z0-9_]+$'),
  actor_id uuid references public.actors(id) on delete restrict,
  client_occurred_at timestamptz,
  recorded_at timestamptz not null default statement_timestamp(),
  idempotency_key text,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object'),
  protected_artifact_refs uuid[] not null default '{}'::uuid[],
  correlation_id uuid,
  causation_id uuid,
  schema_version integer not null default 1 check (schema_version > 0),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  previous_event_sha256 text check (previous_event_sha256 is null or previous_event_sha256 ~ '^[0-9a-f]{64}$'),
  checkpoint_event_id uuid,
  event_sha256 text not null check (event_sha256 ~ '^[0-9a-f]{64}$'),
  foreign key (session_id, organization_id) references public.sessions(id, organization_id) on delete restrict,
  unique (organization_id, aggregate_type, aggregate_id, aggregate_version),
  unique (id, organization_id)
);

create unique index if not exists session_events_idempotency_idx
  on public.session_events (organization_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists session_events_replay_idx
  on public.session_events (organization_id, aggregate_type, aggregate_id, aggregate_version);

create table if not exists public.webhook_inbox (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null,
  provider_event_id text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature_verified boolean not null,
  state text not null default 'received' check (state in ('received', 'processing', 'processed', 'rejected', 'failed', 'unknown')),
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  observed_result_ref text,
  unique (organization_id, provider, provider_event_id),
  unique (organization_id, provider, request_fingerprint),
  unique (id, organization_id)
);

create table if not exists public.async_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  task_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 240),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null default 'queued'
    check (state in ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'unknown', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 100),
  available_at timestamptz not null default statement_timestamp(),
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  lease_token uuid,
  leased_by text,
  leased_until timestamptz,
  heartbeat_at timestamptz,
  expected_aggregate_revision bigint check (expected_aggregate_revision is null or expected_aggregate_revision >= 0),
  payload_artifact_id uuid,
  result_artifact_id uuid,
  last_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (payload_artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  foreign key (result_artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  check (
    (state = 'running' and lease_token is not null and leased_by is not null and leased_until is not null)
    or
    (state <> 'running')
  )
);

create index if not exists async_tasks_lease_idx
  on public.async_tasks (state, available_at, leased_until, created_at);

create table if not exists public.outbox_records (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  async_task_id uuid,
  destination text not null,
  action text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 240),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_artifact_id uuid,
  state text not null default 'pending' check (state in ('pending', 'leased', 'observed_success', 'observed_failure', 'unknown', 'cancelled')),
  provider_observation_ref text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (async_task_id, organization_id) references public.async_tasks(id, organization_id) on delete restrict,
  foreign key (payload_artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (organization_id, idempotency_key),
  unique (id, organization_id)
);

create index if not exists outbox_records_dispatch_idx
  on public.outbox_records (state, available_at, created_at);

create table if not exists public.lifecycle_holds (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  target_class text not null check (target_class in ('job', 'artifact', 'module_snapshot', 'report_version', 'delivery', 'actor_identity', 'event_stream')),
  target_id uuid not null,
  hold_kind text not null check (hold_kind in ('professional', 'dispute', 'legal', 'accounting', 'security_incident')),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  placed_by_actor_id uuid not null references public.actors(id) on delete restrict,
  placed_at timestamptz not null default statement_timestamp(),
  unique (organization_id, target_class, target_id, hold_kind, placed_at),
  unique (id, organization_id)
);

create table if not exists public.lifecycle_hold_releases (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  hold_id uuid not null,
  release_reason text not null check (length(btrim(release_reason)) between 1 and 2000),
  released_by_actor_id uuid not null references public.actors(id) on delete restrict,
  released_at timestamptz not null default statement_timestamp(),
  foreign key (hold_id, organization_id) references public.lifecycle_holds(id, organization_id) on delete restrict,
  unique (organization_id, hold_id)
);

create table if not exists public.lifecycle_suppressions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  target_class text not null check (target_class in ('quote', 'slot_hold', 'booking_draft', 'actor_identity', 'recipient_grant', 'session', 'artifact', 'provider_work')),
  target_id uuid not null,
  suppression_kind text not null check (suppression_kind in ('expired', 'cancelled', 'deleted', 'anonymised', 'revoked', 'offboarded', 'restore_replay')),
  source_event_id uuid,
  reason_sha256 text not null check (reason_sha256 ~ '^[0-9a-f]{64}$'),
  effective_at timestamptz not null default statement_timestamp(),
  retain_until timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (source_event_id, organization_id) references public.session_events(id, organization_id) on delete restrict,
  unique (organization_id, target_class, target_id, suppression_kind),
  unique (id, organization_id)
);

create table if not exists public.data_lifecycle_policies (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  data_class text not null,
  policy_version integer not null check (policy_version > 0),
  retention_interval interval not null check (retention_interval > interval '0 days'),
  backup_expiry_interval interval not null check (backup_expiry_interval > interval '0 days'),
  anonymisation_rule text not null,
  purge_gate text not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, data_class, policy_version)
);

-- PostgreSQL 15 introduced security-invoker views. Supabase production and CI use
-- that posture. PostgreSQL 14 developer machines receive a service-role-only
-- fallback below; authenticated is never granted a definer view that could bypass RLS.
do $block$
declare
  invoker_clause text := case
    when current_setting('server_version_num')::integer >= 150000 then ' with (security_invoker = true)'
    else ''
  end;
begin
  execute 'drop view if exists public.delivery_package_current_state';
  execute 'create view public.delivery_package_current_state' || invoker_clause || ' as
    select distinct on (e.package_id)
      e.organization_id, e.package_id, e.package_version, e.state, e.reason, e.recorded_at
    from public.delivery_package_events e
    order by e.package_id, e.package_version desc';

  execute 'drop view if exists public.delivery_current_state';
  execute 'create view public.delivery_current_state' || invoker_clause || ' as
    select distinct on (e.delivery_id)
      e.organization_id, e.delivery_id, e.delivery_version, e.state,
      e.provider_observation_ref, e.detail_code, e.recorded_at
    from public.delivery_events e
    order by e.delivery_id, e.delivery_version desc';
end;
$block$;

drop trigger if exists async_tasks_touch_updated_at on public.async_tasks;
create trigger async_tasks_touch_updated_at before update on public.async_tasks
for each row execute function public.u2_touch_updated_at();
drop trigger if exists outbox_records_touch_updated_at on public.outbox_records;
create trigger outbox_records_touch_updated_at before update on public.outbox_records
for each row execute function public.u2_touch_updated_at();
