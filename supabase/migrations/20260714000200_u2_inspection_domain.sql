-- U2: tenant-safe jobs, professional modules, evidence, findings, snapshots and approvals.

create table if not exists public.jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  reference text not null,
  state text not null default 'draft'
    check (state in ('draft', 'booked', 'ready', 'in_progress', 'review', 'completed', 'cancelled')),
  property_label text not null check (length(btrim(property_label)) between 1 and 240),
  scheduled_for timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (organization_id, reference),
  unique (id, organization_id)
);

create table if not exists public.job_participants (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  actor_id uuid not null references public.actors(id) on delete restrict,
  participant_role text not null
    check (participant_role in ('client', 'report_recipient', 'invoice_contact', 'access_contact', 'assigned_inspector')),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  unique (job_id, actor_id, participant_role),
  unique (id, organization_id)
);

create index if not exists job_participants_org_actor_idx
  on public.job_participants (organization_id, actor_id, participant_role);

create table if not exists public.inspection_modules (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  assigned_inspector_actor_id uuid not null references public.actors(id) on delete restrict,
  commissioned_at timestamptz not null default statement_timestamp(),
  state text not null default 'commissioned'
    check (state in ('commissioned', 'in_progress', 'review', 'approved', 'withdrawn')),
  revision bigint not null default 0 check (revision >= 0),
  current_snapshot_id uuid,
  current_report_version_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  unique (job_id, module_type),
  unique (id, organization_id),
  unique (id, organization_id, module_type)
);

create index if not exists inspection_modules_org_inspector_idx
  on public.inspection_modules (organization_id, assigned_inspector_actor_id, state);

create table if not exists public.artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  capture_id uuid not null,
  capture_sequence bigint not null check (capture_sequence > 0),
  artifact_kind text not null check (artifact_kind in ('photo', 'audio', 'document', 'structured_json', 'rendered_pdf', 'safe_proxy')),
  evidence_visibility text not null default 'private'
    check (evidence_visibility in ('private', 'report_candidate', 'report_selected', 'protected')),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  media_type text not null check (length(btrim(media_type)) between 1 and 160),
  storage_key text not null check (length(btrim(storage_key)) between 1 and 1024),
  capture_area text,
  captured_at timestamptz not null,
  device_id uuid,
  quarantine_state text not null default 'pending'
    check (quarantine_state in ('pending', 'accepted', 'rejected', 'quarantined')),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  unique (organization_id, capture_id),
  unique (organization_id, storage_key),
  unique (id, organization_id),
  unique (id, organization_id, job_id)
);

create index if not exists artifacts_org_job_sequence_idx
  on public.artifacts (organization_id, job_id, capture_sequence);
create index if not exists artifacts_org_hash_idx
  on public.artifacts (organization_id, content_sha256);

create table if not exists public.artifact_durability_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  artifact_id uuid not null,
  object_version text not null,
  observed_sha256 text not null check (observed_sha256 ~ '^[0-9a-f]{64}$'),
  observed_byte_size bigint not null check (observed_byte_size >= 0),
  observed_at timestamptz not null default statement_timestamp(),
  observer_actor_id uuid references public.actors(id) on delete restrict,
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (organization_id, artifact_id, object_version)
);

create table if not exists public.artifact_derivations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  parent_artifact_id uuid not null,
  derived_artifact_id uuid not null,
  transformation text not null check (transformation in ('annotation', 'crop', 'compression_proxy', 'metadata_strip', 'safe_decode', 'render')),
  parameters_sha256 text not null check (parameters_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_actor_id uuid references public.actors(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (parent_artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  foreign key (derived_artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (organization_id, parent_artifact_id, derived_artifact_id),
  check (parent_artifact_id <> derived_artifact_id)
);

create table if not exists public.artifact_links (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  artifact_id uuid not null,
  module_id uuid,
  link_role text not null
    check (link_role in ('coverage', 'investigation', 'finding_source', 'snapshot_source', 'report_media', 'delivery_record', 'protected_ai_source')),
  linked_record_type text not null,
  linked_record_id uuid not null,
  created_by_actor_id uuid references public.actors(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  foreign key (artifact_id, organization_id, job_id) references public.artifacts(id, organization_id, job_id) on delete restrict,
  foreign key (module_id, organization_id) references public.inspection_modules(id, organization_id) on delete restrict,
  unique (organization_id, artifact_id, linked_record_type, linked_record_id, link_role)
);

create index if not exists artifact_links_org_record_idx
  on public.artifact_links (organization_id, linked_record_type, linked_record_id);

create table if not exists public.artifact_tombstones (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  artifact_id uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  requested_by_actor_id uuid not null references public.actors(id) on delete restrict,
  requested_at timestamptz not null default statement_timestamp(),
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (organization_id, artifact_id)
);

create table if not exists public.findings (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  state text not null default 'draft' check (state in ('draft', 'provisional', 'confirmed', 'superseded', 'removed')),
  revision bigint not null default 0 check (revision >= 0),
  current_version_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (module_id, organization_id, module_type)
    references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  unique (id, organization_id),
  unique (id, organization_id, module_type)
);

create table if not exists public.finding_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  finding_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  version bigint not null check (version > 0),
  expected_finding_revision bigint not null check (expected_finding_revision >= 0),
  authorship_origin text not null check (authorship_origin in ('human', 'ai_provisional', 'human_edited_ai')),
  taxonomy_code text not null,
  observation text not null check (length(btrim(observation)) > 0),
  apparent_extent text,
  significance text,
  qualified_hypothesis text,
  uncertainty text not null default '',
  further_investigation text,
  packet_revision_id uuid,
  model_version text,
  prompt_version text,
  skill_version text,
  verifier_state text not null default 'not_required'
    check (verifier_state in ('not_required', 'pending', 'accepted', 'rejected', 'exhausted', 'stale')),
  verifier_verdict_artifact_id uuid,
  confirmed_by_actor_id uuid references public.actors(id) on delete restrict,
  confirmed_at timestamptz,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (finding_id, organization_id, module_type)
    references public.findings(id, organization_id, module_type) on delete restrict,
  foreign key (verifier_verdict_artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete restrict,
  unique (finding_id, version),
  unique (id, organization_id),
  check (
    (module_type = 'building' and taxonomy_code in ('major_defect', 'minor_defect', 'safety_hazard', 'observation', 'no_finding'))
    or
    (module_type = 'timber_pest' and taxonomy_code in ('active_timber_pest', 'timber_pest_damage', 'conducive_condition', 'evidence', 'no_visible_evidence'))
  ),
  check (
    (authorship_origin = 'human' and verifier_state in ('not_required', 'accepted'))
    or
    (authorship_origin in ('ai_provisional', 'human_edited_ai') and verifier_state <> 'not_required')
  ),
  check ((confirmed_at is null) = (confirmed_by_actor_id is null)),
  check (
    confirmed_at is null
    or authorship_origin = 'human'
    or verifier_state = 'accepted'
  )
);

create table if not exists public.finding_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  finding_version_id uuid not null,
  artifact_id uuid not null,
  evidence_role text not null check (evidence_role in ('overview', 'close_up', 'context', 'contradiction', 'measurement', 'report_selected')),
  ordinal integer not null check (ordinal > 0),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (finding_version_id, organization_id) references public.finding_versions(id, organization_id) on delete restrict,
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  unique (finding_version_id, artifact_id, evidence_role),
  unique (finding_version_id, ordinal)
);

create table if not exists public.coverage_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  area_key text not null check (length(btrim(area_key)) > 0),
  version bigint not null check (version > 0),
  expected_module_revision bigint not null check (expected_module_revision >= 0),
  coverage_state text not null check (coverage_state in ('inspected', 'access_limited', 'inaccessible', 'not_applicable', 'revisit')),
  details text,
  authored_by_actor_id uuid not null references public.actors(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (module_id, organization_id, module_type) references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  unique (module_id, area_key, version),
  unique (id, organization_id)
);

create table if not exists public.module_limitations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  version bigint not null check (version > 0),
  expected_module_revision bigint not null check (expected_module_revision >= 0),
  limitation_key text not null,
  details text not null check (length(btrim(details)) > 0),
  material boolean not null default false,
  authored_by_actor_id uuid not null references public.actors(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (module_id, organization_id, module_type) references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  unique (module_id, limitation_key, version),
  unique (id, organization_id)
);

create table if not exists public.module_conclusions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  version bigint not null check (version > 0),
  expected_module_revision bigint not null check (expected_module_revision >= 0),
  conclusion_text text not null check (length(btrim(conclusion_text)) > 0),
  taxonomy_code text,
  authored_by_actor_id uuid not null references public.actors(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (module_id, organization_id, module_type) references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  unique (module_id, version),
  unique (id, organization_id),
  check (taxonomy_code is null or module_type = 'timber_pest')
);

create table if not exists public.module_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  snapshot_version bigint not null check (snapshot_version > 0),
  expected_module_revision bigint not null check (expected_module_revision >= 0),
  canonical_sha256 text not null check (canonical_sha256 ~ '^[0-9a-f]{64}$'),
  content_manifest jsonb not null check (jsonb_typeof(content_manifest) = 'object'),
  inspector_actor_id uuid not null references public.actors(id) on delete restrict,
  inspector_credential_version text not null,
  requirement_version text not null,
  template_version text not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete restrict,
  foreign key (module_id, organization_id, module_type) references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  unique (module_id, snapshot_version),
  unique (id, organization_id),
  unique (id, organization_id, module_type)
);

create table if not exists public.module_snapshot_findings (
  snapshot_id uuid not null,
  organization_id uuid not null,
  finding_version_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  primary key (snapshot_id, finding_version_id),
  foreign key (snapshot_id, organization_id) references public.module_snapshots(id, organization_id) on delete restrict,
  foreign key (finding_version_id, organization_id) references public.finding_versions(id, organization_id) on delete restrict,
  unique (snapshot_id, ordinal)
);

create table if not exists public.module_snapshot_artifacts (
  snapshot_id uuid not null,
  organization_id uuid not null,
  artifact_id uuid not null,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  selection_role text not null check (selection_role in ('source', 'report_selected', 'verifier', 'durability_manifest')),
  primary key (snapshot_id, artifact_id, selection_role),
  foreign key (snapshot_id, organization_id) references public.module_snapshots(id, organization_id) on delete restrict,
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict
);

create table if not exists public.module_approvals (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  snapshot_id uuid not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  expected_module_revision bigint not null check (expected_module_revision >= 0),
  approved_by_actor_id uuid not null references public.actors(id) on delete restrict,
  approved_at timestamptz not null default statement_timestamp(),
  approval_method text not null default 'authenticated_audit_boundary'
    check (approval_method = 'authenticated_audit_boundary'),
  foreign key (module_id, organization_id, module_type) references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  foreign key (snapshot_id, organization_id, module_type) references public.module_snapshots(id, organization_id, module_type) on delete restrict,
  unique (module_id, snapshot_id),
  unique (id, organization_id)
);

create table if not exists public.module_withdrawals (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  module_id uuid not null,
  module_type text not null check (module_type in ('building', 'timber_pest')),
  snapshot_id uuid not null,
  approval_id uuid not null,
  expected_module_revision bigint not null check (expected_module_revision >= 0),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  withdrawn_by_actor_id uuid not null references public.actors(id) on delete restrict,
  withdrawn_at timestamptz not null default statement_timestamp(),
  foreign key (module_id, organization_id, module_type) references public.inspection_modules(id, organization_id, module_type) on delete restrict,
  foreign key (snapshot_id, organization_id, module_type) references public.module_snapshots(id, organization_id, module_type) on delete restrict,
  foreign key (approval_id, organization_id) references public.module_approvals(id, organization_id) on delete restrict,
  unique (module_id, approval_id)
);

alter table public.findings
  drop constraint if exists findings_current_version_fk;
alter table public.findings
  add constraint findings_current_version_fk
  foreign key (current_version_id, organization_id) references public.finding_versions(id, organization_id) deferrable initially deferred;

alter table public.inspection_modules
  drop constraint if exists inspection_modules_current_snapshot_fk;
alter table public.inspection_modules
  add constraint inspection_modules_current_snapshot_fk
  foreign key (current_snapshot_id, organization_id) references public.module_snapshots(id, organization_id) deferrable initially deferred;

drop trigger if exists jobs_touch_updated_at on public.jobs;
create trigger jobs_touch_updated_at before update on public.jobs
for each row execute function public.u2_touch_updated_at();
drop trigger if exists inspection_modules_touch_updated_at on public.inspection_modules;
create trigger inspection_modules_touch_updated_at before update on public.inspection_modules
for each row execute function public.u2_touch_updated_at();
drop trigger if exists findings_touch_updated_at on public.findings;
create trigger findings_touch_updated_at before update on public.findings
for each row execute function public.u2_touch_updated_at();
