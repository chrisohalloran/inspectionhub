-- U10 P1 remediation: authenticated clients cannot manufacture durable evidence,
-- professional finding history, or immutable snapshot graphs with direct table
-- writes. Assigned inspectors use narrow, transactional commands; independent
-- durability observation remains service-only through record_verified_artifact_durability.

begin;

create table if not exists public.professional_transition_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references public.actors(id) on delete restrict,
  command_name text not null check (command_name in ('append_finding_version', 'create_module_snapshot')),
  idempotency_key_sha256 text not null check (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  request_fingerprint_sha256 text not null check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  result_record_id uuid not null,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (organization_id, command_name, idempotency_key_sha256)
);

drop trigger if exists professional_transition_receipts_reject_mutation
  on public.professional_transition_receipts;
create trigger professional_transition_receipts_reject_mutation
before update or delete on public.professional_transition_receipts
for each row execute function public.u2_reject_mutation();

alter table public.professional_transition_receipts enable row level security;
alter table public.professional_transition_receipts force row level security;
revoke all on public.professional_transition_receipts from public, anon, authenticated;
grant select on public.professional_transition_receipts to service_role;

-- These rows are authoritative only when written by their command boundary.
drop policy if exists tenant_professional_insert on public.artifacts;
drop policy if exists tenant_professional_insert on public.artifact_durability_receipts;
drop policy if exists tenant_professional_insert on public.findings;
drop policy if exists tenant_professional_insert on public.finding_versions;
drop policy if exists tenant_professional_insert on public.finding_evidence;
drop policy if exists tenant_professional_insert on public.module_snapshots;
drop policy if exists tenant_professional_insert on public.module_snapshot_findings;
drop policy if exists tenant_professional_insert on public.module_snapshot_artifacts;
drop policy if exists findings_tenant_update on public.findings;

revoke insert on
  public.artifacts,
  public.artifact_durability_receipts,
  public.findings,
  public.finding_versions,
  public.finding_evidence,
  public.module_snapshots,
  public.module_snapshot_findings,
  public.module_snapshot_artifacts
from authenticated;
revoke update on public.findings from authenticated;

create or replace function public.command_append_finding_version(
  target_organization_id uuid,
  target_module_id uuid,
  target_finding_id uuid,
  target_expected_finding_revision bigint,
  target_payload jsonb,
  target_evidence jsonb,
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
  module_row public.inspection_modules%rowtype;
  finding_row public.findings%rowtype;
  prior_receipt public.professional_transition_receipts%rowtype;
  evidence_item record;
  version_id uuid := extensions.gen_random_uuid();
  next_version bigint;
  idempotency_sha text;
  request_fingerprint text;
  authorship_origin text;
  taxonomy_code text;
  observation_text text;
  verifier_state text;
  content_sha text;
  provided_content_sha text;
  should_confirm boolean;
  packet_revision_id uuid;
  verifier_artifact_id uuid;
  evidence_artifact_id uuid;
  evidence_role text;
begin
  if actor_id is null
     or not public.is_assigned_module_inspector(target_organization_id, target_module_id) then
    raise exception using errcode = '42501', message = 'only the assigned active inspector may append finding history';
  end if;
  if target_finding_id is null
     or target_expected_finding_revision is null
     or target_expected_finding_revision < 0
     or raw_idempotency_key is null
     or length(raw_idempotency_key) not between 16 and 160
     or jsonb_typeof(target_payload) is distinct from 'object'
     or jsonb_typeof(target_evidence) is distinct from 'array'
     or pg_column_size(target_payload) > 65536
     or pg_column_size(target_evidence) > 1048576
     or jsonb_array_length(target_evidence) > 500 then
    raise exception using errcode = '22023', message = 'invalid finding command envelope';
  end if;

  if (target_payload - array[
      'authorshipOrigin', 'taxonomyCode', 'observation', 'apparentExtent',
      'significance', 'qualifiedHypothesis', 'uncertainty',
      'furtherInvestigation', 'packetRevisionId', 'modelVersion',
      'promptVersion', 'skillVersion', 'verifierState',
      'verifierVerdictArtifactId', 'contentSha256', 'confirm'
    ]) <> '{}'::jsonb
     or not (target_payload ?& array[
       'authorshipOrigin', 'taxonomyCode', 'observation', 'verifierState',
       'confirm'
     ])
     or jsonb_typeof(target_payload -> 'confirm') is distinct from 'boolean' then
    raise exception using errcode = '22023', message = 'finding payload has unknown, missing or mistyped fields';
  end if;

  authorship_origin := target_payload ->> 'authorshipOrigin';
  taxonomy_code := target_payload ->> 'taxonomyCode';
  observation_text := target_payload ->> 'observation';
  verifier_state := target_payload ->> 'verifierState';
  provided_content_sha := target_payload ->> 'contentSha256';
  should_confirm := (target_payload ->> 'confirm')::boolean;
  packet_revision_id := nullif(target_payload ->> 'packetRevisionId', '')::uuid;
  verifier_artifact_id := nullif(target_payload ->> 'verifierVerdictArtifactId', '')::uuid;

  if authorship_origin not in ('human', 'ai_provisional', 'human_edited_ai')
     or verifier_state not in ('not_required', 'pending', 'accepted', 'rejected', 'exhausted', 'stale')
     or (provided_content_sha is not null and provided_content_sha !~ '^[0-9a-f]{64}$')
     or length(btrim(taxonomy_code)) not between 1 and 120
     or length(btrim(observation_text)) not between 1 and 10000
     or length(coalesce(target_payload ->> 'apparentExtent', '')) > 10000
     or length(coalesce(target_payload ->> 'significance', '')) > 10000
     or length(coalesce(target_payload ->> 'qualifiedHypothesis', '')) > 10000
     or length(coalesce(target_payload ->> 'uncertainty', '')) > 10000
     or length(coalesce(target_payload ->> 'furtherInvestigation', '')) > 10000
     or length(coalesce(target_payload ->> 'modelVersion', '')) > 240
     or length(coalesce(target_payload ->> 'promptVersion', '')) > 240
     or length(coalesce(target_payload ->> 'skillVersion', '')) > 240 then
    raise exception using errcode = '22023', message = 'invalid finding content';
  end if;
  if should_confirm and verifier_state in ('pending', 'rejected', 'exhausted', 'stale') then
    raise exception using errcode = '23514', message = 'a non-publication-eligible finding version cannot be confirmed';
  end if;

  idempotency_sha := encode(extensions.digest(raw_idempotency_key, 'sha256'), 'hex');
  request_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'actorId', actor_id,
    'moduleId', target_module_id,
    'findingId', target_finding_id,
    'expectedRevision', target_expected_finding_revision,
    'payload', target_payload,
    'evidence', target_evidence
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':professional:' || idempotency_sha, 0
  ));
  select * into prior_receipt
  from public.professional_transition_receipts receipt
  where receipt.organization_id = target_organization_id
    and receipt.command_name = 'append_finding_version'
    and receipt.idempotency_key_sha256 = idempotency_sha;
  if found then
    if prior_receipt.actor_id is distinct from actor_id
       or prior_receipt.request_fingerprint_sha256 is distinct from request_fingerprint then
      raise exception using errcode = '23505', message = 'idempotency key was already used for another finding request';
    end if;
    return prior_receipt.result_record_id;
  end if;

  select * into module_row
  from public.inspection_modules module
  where module.id = target_module_id
    and module.organization_id = target_organization_id
  for key share;
  if not found or module_row.assigned_inspector_actor_id is distinct from actor_id then
    raise exception using errcode = '42501', message = 'finding command module identity is not assigned to the caller';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':finding:' || target_finding_id::text, 0
  ));
  select * into finding_row
  from public.findings finding
  where finding.id = target_finding_id
    and finding.organization_id = target_organization_id
  for update;

  if found then
    if finding_row.module_id is distinct from target_module_id
       or finding_row.module_type is distinct from module_row.module_type then
      raise exception using errcode = '23514', message = 'finding identity is bound to another module';
    end if;
    if finding_row.state in ('superseded', 'removed') then
      raise exception using errcode = '55000', message = 'closed finding history cannot be appended';
    end if;
  else
    if target_expected_finding_revision <> 0 then
      raise exception using errcode = '40001', message = 'stale finding revision';
    end if;
    insert into public.findings (
      id, organization_id, module_id, module_type, state, revision
    ) values (
      target_finding_id, target_organization_id, target_module_id,
      module_row.module_type, 'draft', 0
    ) returning * into finding_row;
  end if;

  if finding_row.revision <> target_expected_finding_revision then
    raise exception using errcode = '40001', message = 'stale finding revision';
  end if;
  -- The database owns the immutable content digest. A client may send its
  -- expected digest, but cannot choose a different trusted value.
  content_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'organizationId', target_organization_id,
    'moduleId', target_module_id,
    'moduleType', module_row.module_type,
    'findingId', target_finding_id,
    'payload', target_payload - 'contentSha256',
    'evidence', target_evidence
  )::text, 'UTF8'), 'sha256'), 'hex');
  if provided_content_sha is not null and provided_content_sha <> content_sha then
    raise exception using errcode = '23514', message = 'finding content hash does not match the server projection';
  end if;
  select coalesce(max(version.version), 0) + 1 into next_version
  from public.finding_versions version
  where version.finding_id = target_finding_id;

  if verifier_artifact_id is not null and not exists (
    select 1
    from public.artifacts artifact
    join public.artifact_durability_receipts receipt
      on receipt.artifact_id = artifact.id
     and receipt.organization_id = artifact.organization_id
     and receipt.observed_sha256 = artifact.content_sha256
     and receipt.observed_byte_size = artifact.byte_size
    where artifact.id = verifier_artifact_id
      and artifact.organization_id = target_organization_id
      and artifact.job_id = module_row.job_id
  ) then
    raise exception using errcode = '23514', message = 'verifier verdict must be a durable artifact from the same job';
  end if;

  insert into public.finding_versions (
    id, organization_id, finding_id, module_type, version,
    expected_finding_revision, authorship_origin, taxonomy_code, observation,
    apparent_extent, significance, qualified_hypothesis, uncertainty,
    further_investigation, packet_revision_id, model_version, prompt_version,
    skill_version, verifier_state, verifier_verdict_artifact_id,
    confirmed_by_actor_id, confirmed_at, content_sha256
  ) values (
    version_id, target_organization_id, target_finding_id, module_row.module_type,
    next_version, finding_row.revision, authorship_origin, taxonomy_code,
    observation_text, target_payload ->> 'apparentExtent',
    target_payload ->> 'significance', target_payload ->> 'qualifiedHypothesis',
    coalesce(target_payload ->> 'uncertainty', ''),
    target_payload ->> 'furtherInvestigation', packet_revision_id,
    target_payload ->> 'modelVersion', target_payload ->> 'promptVersion',
    target_payload ->> 'skillVersion', verifier_state, verifier_artifact_id,
    case when should_confirm then actor_id end,
    case when should_confirm then statement_timestamp() end,
    content_sha
  );

  for evidence_item in
    select item.value, item.ordinality
    from jsonb_array_elements(target_evidence) with ordinality as item(value, ordinality)
  loop
    if jsonb_typeof(evidence_item.value) is distinct from 'object'
       or (evidence_item.value - array['artifactId', 'role']) <> '{}'::jsonb
       or not (evidence_item.value ?& array['artifactId', 'role']) then
      raise exception using errcode = '22023', message = 'finding evidence item has unknown or missing fields';
    end if;
    evidence_artifact_id := (evidence_item.value ->> 'artifactId')::uuid;
    evidence_role := evidence_item.value ->> 'role';
    if evidence_role not in ('overview', 'close_up', 'context', 'contradiction', 'measurement', 'report_selected')
       or not exists (
         select 1
         from public.artifacts artifact
         join public.artifact_durability_receipts receipt
           on receipt.artifact_id = artifact.id
          and receipt.organization_id = artifact.organization_id
          and receipt.observed_sha256 = artifact.content_sha256
          and receipt.observed_byte_size = artifact.byte_size
         where artifact.id = evidence_artifact_id
           and artifact.organization_id = target_organization_id
           and artifact.job_id = module_row.job_id
       ) then
      raise exception using errcode = '23514', message = 'finding evidence must be a durable artifact from the same job';
    end if;
    insert into public.finding_evidence (
      organization_id, finding_version_id, artifact_id, evidence_role, ordinal
    ) values (
      target_organization_id, version_id, evidence_artifact_id, evidence_role,
      evidence_item.ordinality
    );
  end loop;

  update public.findings finding
  set revision = finding_row.revision + 1,
      state = case
        when should_confirm then 'confirmed'
        when finding_row.current_version_id is null then 'provisional'
        else finding_row.state
      end,
      current_version_id = case
        when should_confirm then version_id
        else finding_row.current_version_id
      end
  where finding.id = target_finding_id
    and finding.organization_id = target_organization_id;

  insert into public.professional_transition_receipts (
    organization_id, actor_id, command_name, idempotency_key_sha256,
    request_fingerprint_sha256, result_record_id
  ) values (
    target_organization_id, actor_id, 'append_finding_version', idempotency_sha,
    request_fingerprint, version_id
  );
  return version_id;
end;
$function$;

revoke all on function public.command_append_finding_version(
  uuid, uuid, uuid, bigint, jsonb, jsonb, text
) from public, anon;
grant execute on function public.command_append_finding_version(
  uuid, uuid, uuid, bigint, jsonb, jsonb, text
) to authenticated, service_role;

create or replace function public.command_create_module_snapshot(
  target_organization_id uuid,
  target_module_id uuid,
  target_expected_module_revision bigint,
  target_payload jsonb,
  target_finding_version_ids uuid[],
  target_artifacts jsonb,
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
  module_row public.inspection_modules%rowtype;
  prior_receipt public.professional_transition_receipts%rowtype;
  artifact_item record;
  finding_item record;
  snapshot_id uuid := extensions.gen_random_uuid();
  next_snapshot_version bigint;
  idempotency_sha text;
  request_fingerprint text;
  canonical_sha text;
  provided_canonical_sha text;
  content_manifest jsonb;
  snapshot_artifact_id uuid;
  artifact_sha text;
  selection_role text;
begin
  if actor_id is null
     or not public.is_assigned_module_inspector(target_organization_id, target_module_id) then
    raise exception using errcode = '42501', message = 'only the assigned active inspector may create a module snapshot';
  end if;
  if target_expected_module_revision is null
     or target_expected_module_revision < 0
     or raw_idempotency_key is null
     or length(raw_idempotency_key) not between 16 and 160
     or jsonb_typeof(target_payload) is distinct from 'object'
     or jsonb_typeof(target_artifacts) is distinct from 'array'
     or coalesce(cardinality(target_finding_version_ids), 0) > 500
     or jsonb_array_length(target_artifacts) > 2000
     or pg_column_size(target_payload) > 1048576
     or pg_column_size(target_artifacts) > 2097152 then
    raise exception using errcode = '22023', message = 'invalid snapshot command envelope';
  end if;
  target_finding_version_ids := coalesce(target_finding_version_ids, '{}'::uuid[]);

  if (target_payload - array[
      'canonicalSha256', 'contentManifest', 'inspectorCredentialVersion',
      'requirementVersion', 'templateVersion'
    ]) <> '{}'::jsonb
     or not (target_payload ?& array[
       'contentManifest', 'inspectorCredentialVersion', 'requirementVersion',
       'templateVersion'
     ])
     or jsonb_typeof(target_payload -> 'contentManifest') is distinct from 'object' then
    raise exception using errcode = '22023', message = 'snapshot payload has unknown, missing or mistyped fields';
  end if;
  provided_canonical_sha := target_payload ->> 'canonicalSha256';
  content_manifest := target_payload -> 'contentManifest';
  if (provided_canonical_sha is not null and provided_canonical_sha !~ '^[0-9a-f]{64}$')
     or length(btrim(target_payload ->> 'inspectorCredentialVersion')) not between 1 and 240
     or length(btrim(target_payload ->> 'requirementVersion')) not between 1 and 240
     or length(btrim(target_payload ->> 'templateVersion')) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'invalid snapshot content';
  end if;
  if cardinality(target_finding_version_ids) <> (
    select count(distinct finding_id) from unnest(target_finding_version_ids) finding_id
  ) then
    raise exception using errcode = '22023', message = 'snapshot finding version ids must be unique';
  end if;

  idempotency_sha := encode(extensions.digest(raw_idempotency_key, 'sha256'), 'hex');
  request_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'actorId', actor_id,
    'moduleId', target_module_id,
    'expectedRevision', target_expected_module_revision,
    'payload', target_payload,
    'findingVersionIds', to_jsonb(target_finding_version_ids),
    'artifacts', target_artifacts
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':professional:' || idempotency_sha, 0
  ));
  select * into prior_receipt
  from public.professional_transition_receipts receipt
  where receipt.organization_id = target_organization_id
    and receipt.command_name = 'create_module_snapshot'
    and receipt.idempotency_key_sha256 = idempotency_sha;
  if found then
    if prior_receipt.actor_id is distinct from actor_id
       or prior_receipt.request_fingerprint_sha256 is distinct from request_fingerprint then
      raise exception using errcode = '23505', message = 'idempotency key was already used for another snapshot request';
    end if;
    return prior_receipt.result_record_id;
  end if;

  select * into module_row
  from public.inspection_modules module
  where module.id = target_module_id
    and module.organization_id = target_organization_id
  for update;
  if not found or module_row.assigned_inspector_actor_id is distinct from actor_id then
    raise exception using errcode = '42501', message = 'snapshot command module identity is not assigned to the caller';
  end if;
  if module_row.state = 'withdrawn' then
    raise exception using errcode = '55000', message = 'a withdrawn module cannot create another snapshot';
  end if;
  if module_row.revision <> target_expected_module_revision then
    raise exception using errcode = '40001', message = 'stale module revision';
  end if;

  -- Bind the immutable snapshot hash to the server-observed professional graph,
  -- not to an opaque hash selected by the authenticated caller.
  canonical_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'organizationId', target_organization_id,
    'jobId', module_row.job_id,
    'moduleId', target_module_id,
    'moduleType', module_row.module_type,
    'expectedModuleRevision', module_row.revision,
    'payload', target_payload - 'canonicalSha256',
    'findingVersionIds', to_jsonb(target_finding_version_ids),
    'artifacts', target_artifacts
  )::text, 'UTF8'), 'sha256'), 'hex');
  if provided_canonical_sha is not null and provided_canonical_sha <> canonical_sha then
    raise exception using errcode = '23514', message = 'snapshot canonical hash does not match the server projection';
  end if;

  select coalesce(max(snapshot.snapshot_version), 0) + 1
  into next_snapshot_version
  from public.module_snapshots snapshot
  where snapshot.module_id = target_module_id;

  insert into public.module_snapshots (
    id, organization_id, job_id, module_id, module_type, snapshot_version,
    expected_module_revision, canonical_sha256, content_manifest,
    inspector_actor_id, inspector_credential_version, requirement_version,
    template_version
  ) values (
    snapshot_id, target_organization_id, module_row.job_id, target_module_id,
    module_row.module_type, next_snapshot_version, module_row.revision,
    canonical_sha, content_manifest, actor_id,
    target_payload ->> 'inspectorCredentialVersion',
    target_payload ->> 'requirementVersion',
    target_payload ->> 'templateVersion'
  );

  for finding_item in
    select finding_version_id, ordinality
    from unnest(target_finding_version_ids) with ordinality
      as selected(finding_version_id, ordinality)
  loop
    if not exists (
      select 1
      from public.finding_versions version
      join public.findings finding
        on finding.id = version.finding_id
       and finding.organization_id = version.organization_id
      where version.id = finding_item.finding_version_id
        and version.organization_id = target_organization_id
        and finding.module_id = target_module_id
        and finding.current_version_id = version.id
        and finding.state = 'confirmed'
        and version.confirmed_at is not null
        and version.confirmed_by_actor_id is not null
        and version.verifier_state not in ('pending', 'rejected', 'exhausted', 'stale')
    ) then
      raise exception using errcode = '23514', message = 'snapshot may include only current confirmed publication-eligible finding versions';
    end if;
    insert into public.module_snapshot_findings (
      snapshot_id, organization_id, finding_version_id, ordinal
    ) values (
      snapshot_id, target_organization_id, finding_item.finding_version_id,
      finding_item.ordinality
    );
  end loop;

  for artifact_item in
    select item.value
    from jsonb_array_elements(target_artifacts) as item(value)
  loop
    if jsonb_typeof(artifact_item.value) is distinct from 'object'
       or (artifact_item.value - array['artifactId', 'artifactSha256', 'selectionRole']) <> '{}'::jsonb
       or not (artifact_item.value ?& array['artifactId', 'artifactSha256', 'selectionRole']) then
      raise exception using errcode = '22023', message = 'snapshot artifact item has unknown or missing fields';
    end if;
    snapshot_artifact_id := (artifact_item.value ->> 'artifactId')::uuid;
    artifact_sha := artifact_item.value ->> 'artifactSha256';
    selection_role := artifact_item.value ->> 'selectionRole';
    if artifact_sha !~ '^[0-9a-f]{64}$'
       or selection_role not in ('source', 'report_selected', 'verifier', 'durability_manifest')
       or not exists (
         select 1
         from public.artifacts artifact
         join public.artifact_durability_receipts receipt
           on receipt.artifact_id = artifact.id
          and receipt.organization_id = artifact.organization_id
          and receipt.observed_sha256 = artifact.content_sha256
          and receipt.observed_byte_size = artifact.byte_size
         where artifact.id = snapshot_artifact_id
           and artifact.organization_id = target_organization_id
           and artifact.job_id = module_row.job_id
           and artifact.content_sha256 = artifact_sha
       ) then
      raise exception using errcode = '23514', message = 'snapshot artifacts must bind exact durable evidence from the same job';
    end if;
    insert into public.module_snapshot_artifacts (
      snapshot_id, organization_id, artifact_id, artifact_sha256, selection_role
    ) values (
      snapshot_id, target_organization_id, snapshot_artifact_id, artifact_sha, selection_role
    );
  end loop;

  update public.inspection_modules module
  set current_snapshot_id = snapshot_id,
      state = 'review',
      revision = module_row.revision + 1
  where module.id = target_module_id
    and module.organization_id = target_organization_id;

  insert into public.professional_transition_receipts (
    organization_id, actor_id, command_name, idempotency_key_sha256,
    request_fingerprint_sha256, result_record_id
  ) values (
    target_organization_id, actor_id, 'create_module_snapshot', idempotency_sha,
    request_fingerprint, snapshot_id
  );
  return snapshot_id;
end;
$function$;

revoke all on function public.command_create_module_snapshot(
  uuid, uuid, bigint, jsonb, uuid[], jsonb, text
) from public, anon;
grant execute on function public.command_create_module_snapshot(
  uuid, uuid, bigint, jsonb, uuid[], jsonb, text
) to authenticated, service_role;

commit;
