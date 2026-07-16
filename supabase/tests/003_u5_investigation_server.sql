\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(condition boolean, description text)
returns void language plpgsql as $function$
begin
  if condition is distinct from true then raise exception 'assertion failed: %', description; end if;
  raise notice 'ok - %', description;
end;
$function$;

insert into public.organizations (id, slug, name) values
  ('daaaaaaa-0000-4000-8000-000000000001', 'u5-alpha', 'U5 Alpha'),
  ('dbbbbbbb-0000-4000-8000-000000000001', 'u5-beta', 'U5 Beta');
insert into public.actors (id, auth_user_id, actor_kind, display_name) values
  ('da100000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'inspector', 'Alpha Inspector'),
  ('db100000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000001', 'inspector', 'Beta Inspector');
insert into public.organization_members (organization_id, actor_id, member_role, status) values
  ('daaaaaaa-0000-4000-8000-000000000001', 'da100000-0000-4000-8000-000000000001', 'inspector', 'active'),
  ('dbbbbbbb-0000-4000-8000-000000000001', 'db100000-0000-4000-8000-000000000001', 'inspector', 'active');
insert into public.jobs (id, organization_id, reference, property_label, state) values
  ('daa00000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001', 'U5-A', 'Synthetic Alpha', 'in_progress'),
  ('dbb00000-0000-4000-8000-000000000001', 'dbbbbbbb-0000-4000-8000-000000000001', 'U5-B', 'Synthetic Beta', 'in_progress');
insert into public.inspection_modules (
  id, organization_id, job_id, module_type, assigned_inspector_actor_id, state
) values
  ('da200000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'building', 'da100000-0000-4000-8000-000000000001', 'in_progress'),
  ('da200000-0000-4000-8000-000000000002', 'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'timber_pest', 'da100000-0000-4000-8000-000000000001', 'in_progress'),
  ('db200000-0000-4000-8000-000000000001', 'dbbbbbbb-0000-4000-8000-000000000001', 'dbb00000-0000-4000-8000-000000000001', 'building', 'db100000-0000-4000-8000-000000000001', 'in_progress');

insert into public.inspection_areas (
  id, organization_id, job_id, area_key, label, ordinal, applicable_module_types
) values
  ('da300000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'bathroom-main', 'Main bathroom', 1, array['building', 'timber_pest']),
  ('da300000-0000-4000-8000-000000000002', 'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'exterior-east', 'Exterior east', 2, array['building', 'timber_pest']),
  ('db300000-0000-4000-8000-000000000001', 'dbbbbbbb-0000-4000-8000-000000000001', 'dbb00000-0000-4000-8000-000000000001', 'bathroom', 'Beta bathroom', 1, array['building']);

insert into public.artifacts (
  id, organization_id, job_id, capture_id, capture_sequence, artifact_kind,
  evidence_visibility, content_sha256, byte_size, media_type, storage_key,
  captured_at, quarantine_state
) values
  ('da400000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'da410000-0000-4000-8000-000000000001', 1, 'photo', 'private', repeat('1', 64), 100, 'image/jpeg', 'quarantine/u5-alpha/photo.jpg', statement_timestamp(), 'pending'),
  ('da400000-0000-4000-8000-000000000002', 'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'da410000-0000-4000-8000-000000000002', 2, 'structured_json', 'protected', repeat('2', 64), 50, 'application/json', 'protected/u5-alpha/note.json', statement_timestamp(), 'pending'),
  ('db400000-0000-4000-8000-000000000001', 'dbbbbbbb-0000-4000-8000-000000000001', 'dbb00000-0000-4000-8000-000000000001', 'db410000-0000-4000-8000-000000000001', 1, 'photo', 'private', repeat('3', 64), 100, 'image/jpeg', 'quarantine/u5-beta/photo.jpg', statement_timestamp(), 'pending');
insert into public.artifact_durability_receipts (
  organization_id, artifact_id, object_version, observed_sha256, observed_byte_size
) values
  ('daaaaaaa-0000-4000-8000-000000000001', 'da400000-0000-4000-8000-000000000001', 'u5-photo-v1', repeat('1', 64), 100),
  ('daaaaaaa-0000-4000-8000-000000000001', 'da400000-0000-4000-8000-000000000002', 'u5-note-v1', repeat('2', 64), 50),
  ('dbbbbbbb-0000-4000-8000-000000000001', 'db400000-0000-4000-8000-000000000001', 'u5-beta-v1', repeat('3', 64), 100);

insert into public.investigations (
  id, organization_id, job_id, started_by_inspector_actor_id, started_at
) values (
  'da500000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001',
  'daa00000-0000-4000-8000-000000000001', 'da100000-0000-4000-8000-000000000001',
  '2026-07-15T00:00:00Z'
);
insert into public.investigation_revisions (
  organization_id, job_id, investigation_id, revision, expected_previous_revision,
  status, current_area_id, content_sha256
) values (
  'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001',
  'da500000-0000-4000-8000-000000000001', 0, null, 'active',
  'da300000-0000-4000-8000-000000000001', repeat('a', 64)
);
insert into public.investigation_modules (
  organization_id, job_id, investigation_id, module_id, module_type
) values
  ('daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001', 'da200000-0000-4000-8000-000000000001', 'building'),
  ('daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001', 'da200000-0000-4000-8000-000000000002', 'timber_pest');
set constraints investigations_require_initial_state immediate;
set constraints investigations_require_initial_state deferred;
insert into public.investigation_areas (
  id, organization_id, job_id, investigation_id, area_id, ordinal, entered_at
) values (
  'da600000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001',
  'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001',
  'da300000-0000-4000-8000-000000000001', 1, '2026-07-15T00:00:00Z'
);
insert into public.investigation_artifacts (
  id, organization_id, job_id, investigation_id, artifact_id, capture_area_id,
  link_ordinal, source, attached_by_inspector_actor_id, attached_at
) values
  ('da700000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001', 'da400000-0000-4000-8000-000000000001', 'da300000-0000-4000-8000-000000000001', 1, 'captured_during_investigation', 'da100000-0000-4000-8000-000000000001', statement_timestamp()),
  ('da700000-0000-4000-8000-000000000002', 'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001', 'da400000-0000-4000-8000-000000000002', 'da300000-0000-4000-8000-000000000001', 2, 'captured_during_investigation', 'da100000-0000-4000-8000-000000000001', statement_timestamp());
insert into public.investigation_artifact_area_assignments (
  organization_id, investigation_id, investigation_artifact_id, area_id,
  assignment_ordinal, reason, assigned_by_inspector_actor_id, assigned_at
) values
  ('daaaaaaa-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001', 'da700000-0000-4000-8000-000000000001', 'da300000-0000-4000-8000-000000000001', 1, 'capture_context', 'da100000-0000-4000-8000-000000000001', statement_timestamp()),
  ('daaaaaaa-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001', 'da700000-0000-4000-8000-000000000001', 'da300000-0000-4000-8000-000000000002', 2, 'inspector_correction', 'da100000-0000-4000-8000-000000000001', statement_timestamp());
insert into public.investigation_notes (
  id, organization_id, job_id, investigation_id, area_id, note_kind,
  protected_artifact_id, recorded_by_inspector_actor_id, recorded_at
) values (
  'da800000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001',
  'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001',
  'da300000-0000-4000-8000-000000000001', 'observation',
  'da400000-0000-4000-8000-000000000002', 'da100000-0000-4000-8000-000000000001', statement_timestamp()
);
insert into public.measurements (
  id, organization_id, job_id, investigation_id, area_id, measurement_kind,
  measured_value, measurement_unit, protected_note_artifact_id,
  measured_by_inspector_actor_id, measured_at
) values (
  'da900000-0000-4000-8000-000000000001', 'daaaaaaa-0000-4000-8000-000000000001',
  'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001',
  'da300000-0000-4000-8000-000000000001', 'crack_width', 2.4, 'millimetres',
  'da400000-0000-4000-8000-000000000002', 'da100000-0000-4000-8000-000000000001', statement_timestamp()
);

select pg_temp.assert_true(
  (select count(*) = 2 from public.investigation_modules where investigation_id = 'da500000-0000-4000-8000-000000000001')
  and (select count(*) = 2 from public.investigation_artifacts where investigation_id = 'da500000-0000-4000-8000-000000000001')
  and (select count(*) = 2 from public.investigation_artifact_area_assignments where investigation_artifact_id = 'da700000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.investigation_notes where investigation_id = 'da500000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.measurements where investigation_id = 'da500000-0000-4000-8000-000000000001'),
  'server tables preserve module, area, immutable artifact, correction, note and measurement history'
);

do $test$
begin
  begin
    insert into public.investigations (
      organization_id, job_id, started_by_inspector_actor_id, started_at
    ) values (
      'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001',
      'db100000-0000-4000-8000-000000000001', statement_timestamp()
    );
    raise exception 'assertion failed: cross-tenant inspector started investigation';
  exception when check_violation then
    raise notice 'ok - cross-tenant inspector identity is rejected';
  end;
  begin
    insert into public.investigation_artifacts (
      organization_id, job_id, investigation_id, artifact_id, capture_area_id,
      link_ordinal, source, attached_by_inspector_actor_id, attached_at
    ) values (
      'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001',
      'da500000-0000-4000-8000-000000000001', 'db400000-0000-4000-8000-000000000001',
      'da300000-0000-4000-8000-000000000001', 3, 'attached_recent',
      'da100000-0000-4000-8000-000000000001', statement_timestamp()
    );
    raise exception 'assertion failed: cross-tenant artifact entered investigation';
  exception when foreign_key_violation or check_violation then
    raise notice 'ok - cross-tenant investigation artifact is rejected';
  end;
  begin
    update public.investigation_artifact_area_assignments set reason = 'capture_context'
    where investigation_artifact_id = 'da700000-0000-4000-8000-000000000001' and assignment_ordinal = 2;
    raise exception 'assertion failed: area correction history was rewritten';
  exception when sqlstate '55000' then
    raise notice 'ok - area assignment history is append-only';
  end;
end;
$test$;

do $test$
begin
  begin
    insert into public.investigation_revisions (
      organization_id, job_id, investigation_id, revision, expected_previous_revision,
      status, current_area_id, content_sha256
    ) values (
      'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001',
      'da500000-0000-4000-8000-000000000001', 2, 1, 'active',
      'da300000-0000-4000-8000-000000000001', repeat('b', 64)
    );
    raise exception 'assertion failed: revision gap accepted';
  exception when serialization_failure then
    raise notice 'ok - stale or non-contiguous revision is rejected';
  end;
end;
$test$;

insert into public.investigation_revisions (
  organization_id, job_id, investigation_id, revision, expected_previous_revision,
  status, current_area_id, content_sha256
) values
  ('daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001', 1, 0, 'paused', 'da300000-0000-4000-8000-000000000001', repeat('b', 64)),
  ('daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001', 'da500000-0000-4000-8000-000000000001', 2, 1, 'active', 'da300000-0000-4000-8000-000000000001', repeat('c', 64));
insert into public.investigation_revisions (
  organization_id, job_id, investigation_id, revision, expected_previous_revision,
  status, current_area_id, completed_at, completed_by_inspector_actor_id,
  drafting_disposition, content_sha256
) values (
  'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001',
  'da500000-0000-4000-8000-000000000001', 3, 2, 'completed_no_reportable_finding',
  'da300000-0000-4000-8000-000000000001', statement_timestamp(),
  'da100000-0000-4000-8000-000000000001', 'manual_only', repeat('d', 64)
);

do $test$
begin
  begin
    insert into public.measurements (
      organization_id, job_id, investigation_id, area_id, measurement_kind,
      measured_value, measurement_unit, measured_by_inspector_actor_id, measured_at
    ) values (
      'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001',
      'da500000-0000-4000-8000-000000000001', 'da300000-0000-4000-8000-000000000001',
      'length', 1, 'metres', 'da100000-0000-4000-8000-000000000001', statement_timestamp()
    );
    raise exception 'assertion failed: completed investigation accepted new measurement';
  exception when sqlstate '55000' then
    raise notice 'ok - completed investigation rejects new capture history';
  end;
  begin
    insert into public.investigation_revisions (
      organization_id, job_id, investigation_id, revision, expected_previous_revision,
      status, current_area_id, content_sha256
    ) values (
      'daaaaaaa-0000-4000-8000-000000000001', 'daa00000-0000-4000-8000-000000000001',
      'da500000-0000-4000-8000-000000000001', 4, 3, 'active',
      'da300000-0000-4000-8000-000000000001', repeat('e', 64)
    );
    raise exception 'assertion failed: completed investigation reopened';
  exception when sqlstate '55000' then
    raise notice 'ok - completed investigation cannot be reopened or rewritten';
  end;
end;
$test$;

select pg_temp.assert_true(
  (select revision = 3 and status = 'completed_no_reportable_finding'
    from public.investigation_current_state where investigation_id = 'da500000-0000-4000-8000-000000000001')
  and (select count(*) = 4 from public.session_events
    where aggregate_type = 'investigation' and aggregate_id = 'da500000-0000-4000-8000-000000000001'),
  'current projection derives from four append-only revisions and typed audit events'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ea100000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true(
  (select count(*) = 1 from public.investigations),
  'tenant inspector can read their investigation identity and history'
);
select set_config('request.jwt.claim.sub', 'eb100000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.investigations),
  'cross-tenant authenticated read is denied'
);
do $test$
begin
  begin
    insert into public.investigations (
      organization_id, job_id, started_by_inspector_actor_id, started_at
    ) values (
      'dbbbbbbb-0000-4000-8000-000000000001', 'dbb00000-0000-4000-8000-000000000001',
      'db100000-0000-4000-8000-000000000001', statement_timestamp()
    );
    raise exception 'assertion failed: direct authenticated investigation write accepted';
  exception when insufficient_privilege then
    raise notice 'ok - investigation writes remain server mediated';
  end;
end;
$test$;
reset role;

rollback;
