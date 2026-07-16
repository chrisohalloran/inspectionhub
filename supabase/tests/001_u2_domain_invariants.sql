\set ON_ERROR_STOP on

-- Portable SQL assertion suite. It intentionally does not require pgTAP so the
-- local PostgreSQL harness and `supabase test db` can execute the same proof.
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
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alpha-inspections', 'Alpha Inspections'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'beta-inspections', 'Beta Inspections');

insert into public.actors (id, auth_user_id, actor_kind, display_name, mailbox_normalized) values
  ('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'inspector', 'Alpha Inspector', 'inspector@alpha.test'),
  ('22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'inspector', 'Beta Inspector', 'inspector@beta.test'),
  ('33333333-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'report_recipient', 'Alpha Recipient', 'recipient@alpha.test'),
  ('44444444-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'client', 'Alpha Client', 'client@alpha.test'),
  ('55555555-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'access_contact', 'Alpha Access', 'access@alpha.test');

insert into public.organization_members (organization_id, actor_id, member_role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'inspector', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'inspector', 'active');

insert into public.jobs (id, organization_id, reference, property_label, state, revision) values
  ('aaaa0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ALPHA-1', 'Synthetic Alpha Property', 'review', 0),
  ('bbbb0000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'BETA-1', 'Synthetic Beta Property', 'review', 0);

insert into public.job_participants (organization_id, job_id, actor_id, participant_role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'client'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'report_recipient'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'access_contact'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'assigned_inspector');

select pg_temp.assert_true(
  (select count(distinct participant_role) = 4 from public.job_participants where job_id = 'aaaa0000-0000-0000-0000-000000000001'),
  'client, recipient, access contact and assigned inspector remain distinct roles'
);

insert into public.inspection_modules (
  id, organization_id, job_id, module_type, assigned_inspector_actor_id, state, revision
) values
  ('aaaa1000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'building', '11111111-0000-0000-0000-000000000001', 'review', 0),
  ('aaaa2000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'timber_pest', '11111111-0000-0000-0000-000000000001', 'review', 0),
  ('bbbb1000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001', 'building', '22222222-0000-0000-0000-000000000001', 'review', 0);

insert into public.artifacts (
  id, organization_id, job_id, capture_id, capture_sequence, artifact_kind,
  content_sha256, byte_size, media_type, storage_key, captured_at, quarantine_state
) values
  ('aaaa3000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa4000-0000-0000-0000-000000000001', 1, 'photo', repeat('a', 64), 2048, 'image/jpeg', 'aaaaaaaa-0000-0000-0000-000000000001/jobs/1/original-1.jpg', statement_timestamp(), 'accepted'),
  ('aaaa3000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa4000-0000-0000-0000-000000000002', 2, 'photo', repeat('a', 64), 2048, 'image/jpeg', 'aaaaaaaa-0000-0000-0000-000000000001/jobs/1/original-2.jpg', statement_timestamp(), 'accepted');

select pg_temp.assert_true(
  (select count(*) = 2 and count(distinct capture_id) = 2 and count(distinct content_sha256) = 1 from public.artifacts where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'identical bytes from genuine captures retain distinct capture identities'
);

do $test$
begin
  begin
    update public.artifacts set capture_area = 'changed' where id = 'aaaa3000-0000-0000-0000-000000000001';
    raise exception 'assertion failed: immutable artifact update was accepted';
  exception when sqlstate '55000' then
    raise notice 'ok - immutable artifact update is denied';
  end;
  begin
    delete from public.artifacts where id = 'aaaa3000-0000-0000-0000-000000000001';
    raise exception 'assertion failed: immutable artifact delete was accepted';
  exception when sqlstate '55000' then
    raise notice 'ok - immutable artifact delete is denied';
  end;
end;
$test$;

insert into public.findings (id, organization_id, module_id, module_type, state, revision) values
  ('aaaa5000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001', 'building', 'draft', 0),
  ('aaaa5000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa2000-0000-0000-0000-000000000001', 'timber_pest', 'draft', 0);

do $test$
begin
  begin
    insert into public.finding_versions (
      organization_id, finding_id, module_type, version, expected_finding_revision,
      authorship_origin, taxonomy_code, observation, verifier_state, content_sha256
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-000000000002',
      'timber_pest', 1, 0, 'human', 'major_defect', 'Invalid cross-taxonomy value', 'not_required', repeat('b', 64)
    );
    raise exception 'assertion failed: Building classification entered Timber Pest taxonomy';
  exception when check_violation then
    raise notice 'ok - module taxonomy rejects Building classifications in Timber Pest';
  end;
end;
$test$;

insert into public.finding_versions (
  id, organization_id, finding_id, module_type, version, expected_finding_revision,
  authorship_origin, taxonomy_code, observation, uncertainty, verifier_state,
  confirmed_by_actor_id, confirmed_at, content_sha256
) values
  ('aaaa6000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-000000000001', 'building', 1, 0, 'human', 'major_defect', 'Cracked shower-base and bathroom floor tiles.', 'Subfloor construction was not visually confirmed.', 'not_required', '11111111-0000-0000-0000-000000000001', statement_timestamp(), repeat('c', 64)),
  ('aaaa6000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa5000-0000-0000-0000-000000000002', 'timber_pest', 1, 0, 'human', 'evidence', 'Visible timber member evidence retained for assessment.', 'Activity was not inferred from this photograph alone.', 'not_required', '11111111-0000-0000-0000-000000000001', statement_timestamp(), repeat('d', 64));

update public.findings set current_version_id = 'aaaa6000-0000-0000-0000-000000000001', state = 'confirmed' where id = 'aaaa5000-0000-0000-0000-000000000001';
update public.findings set current_version_id = 'aaaa6000-0000-0000-0000-000000000002', state = 'confirmed' where id = 'aaaa5000-0000-0000-0000-000000000002';

insert into public.finding_evidence (organization_id, finding_version_id, artifact_id, evidence_role, ordinal) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaa6000-0000-0000-0000-000000000001', 'aaaa3000-0000-0000-0000-000000000001', 'context', 1),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaa6000-0000-0000-0000-000000000002', 'aaaa3000-0000-0000-0000-000000000001', 'context', 1);

insert into public.artifact_links (
  organization_id, job_id, artifact_id, module_id, link_role, linked_record_type, linked_record_id, created_by_actor_id
) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa3000-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001', 'finding_source', 'finding', 'aaaa5000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa3000-0000-0000-0000-000000000001', 'aaaa2000-0000-0000-0000-000000000001', 'finding_source', 'finding', 'aaaa5000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001');

select pg_temp.assert_true(
  (select count(*) = 2 and count(distinct artifact_id) = 1 and count(distinct module_id) = 2 from public.artifact_links where linked_record_type = 'finding'),
  'one immutable artifact is shared by separate Building and Timber Pest findings'
);

do $test$
begin
  begin
    insert into public.module_snapshots (
      organization_id, job_id, module_id, module_type, snapshot_version, expected_module_revision,
      canonical_sha256, content_manifest, inspector_actor_id, inspector_credential_version,
      requirement_version, template_version
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001',
      'aaaa1000-0000-0000-0000-000000000001', 'building', 99, 1, repeat('e', 64), '{}'::jsonb,
      '11111111-0000-0000-0000-000000000001', 'credential-v1', 'requirements-v1', 'template-v1'
    );
    raise exception 'assertion failed: stale snapshot revision was accepted';
  exception when serialization_failure then
    raise notice 'ok - stale professional revision is rejected';
  end;
end;
$test$;

insert into public.module_snapshots (
  id, organization_id, job_id, module_id, module_type, snapshot_version, expected_module_revision,
  canonical_sha256, content_manifest, inspector_actor_id, inspector_credential_version,
  requirement_version, template_version
) values
  ('aaaa7000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001', 'building', 1, 0, repeat('1', 64), '{"module":"building","version":1}'::jsonb, '11111111-0000-0000-0000-000000000001', 'credential-v1', 'requirements-v1', 'template-v1'),
  ('aaaa7000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa2000-0000-0000-0000-000000000001', 'timber_pest', 1, 0, repeat('2', 64), '{"module":"timber_pest","version":1}'::jsonb, '11111111-0000-0000-0000-000000000001', 'credential-v1', 'requirements-v1', 'template-v1');

insert into public.module_snapshot_findings (snapshot_id, organization_id, finding_version_id, ordinal) values
  ('aaaa7000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa6000-0000-0000-0000-000000000001', 1),
  ('aaaa7000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa6000-0000-0000-0000-000000000002', 1);

insert into public.finding_versions (
  id, organization_id, finding_id, module_type, version, expected_finding_revision,
  authorship_origin, taxonomy_code, observation, uncertainty, verifier_state,
  content_sha256
) values (
  'aaaa6000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaa5000-0000-0000-0000-000000000001', 'building', 2, 0, 'ai_provisional',
  'major_defect', 'Unsupported provisional observation.', 'Verifier rejected factual additions.',
  'rejected', repeat('9', 64)
);
do $test$
begin
  begin
    insert into public.module_snapshot_findings (
      snapshot_id, organization_id, finding_version_id, ordinal
    ) values (
      'aaaa7000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaa6000-0000-0000-0000-000000000099', 2
    );
    raise exception 'assertion failed: rejected provisional finding entered a snapshot';
  exception when check_violation then
    raise notice 'ok - rejected or unconfirmed finding versions cannot enter a module snapshot';
  end;
end;
$test$;

update public.inspection_modules set current_snapshot_id = 'aaaa7000-0000-0000-0000-000000000001' where id = 'aaaa1000-0000-0000-0000-000000000001';
update public.inspection_modules set current_snapshot_id = 'aaaa7000-0000-0000-0000-000000000002' where id = 'aaaa2000-0000-0000-0000-000000000001';

insert into public.module_approvals (
  id, organization_id, module_id, module_type, snapshot_id, snapshot_sha256,
  expected_module_revision, approved_by_actor_id
) values
  ('aaaa8000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001', 'building', 'aaaa7000-0000-0000-0000-000000000001', repeat('1', 64), 0, '11111111-0000-0000-0000-000000000001'),
  ('aaaa8000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa2000-0000-0000-0000-000000000001', 'timber_pest', 'aaaa7000-0000-0000-0000-000000000002', repeat('2', 64), 0, '11111111-0000-0000-0000-000000000001');

insert into public.report_versions (
  id, organization_id, job_id, module_id, module_type, module_snapshot_id, report_version,
  expected_module_revision, structured_snapshot, canonical_sha256, issued_by_actor_id
) values
  ('aaaa9000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001', 'building', 'aaaa7000-0000-0000-0000-000000000001', 1, 0, '{"module":"building"}'::jsonb, repeat('3', 64), '11111111-0000-0000-0000-000000000001'),
  ('aaaa9000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa2000-0000-0000-0000-000000000001', 'timber_pest', 'aaaa7000-0000-0000-0000-000000000002', 1, 0, '{"module":"timber_pest"}'::jsonb, repeat('4', 64), '11111111-0000-0000-0000-000000000001');

update public.inspection_modules set current_report_version_id = 'aaaa9000-0000-0000-0000-000000000001' where id = 'aaaa1000-0000-0000-0000-000000000001';
update public.inspection_modules set current_report_version_id = 'aaaa9000-0000-0000-0000-000000000002' where id = 'aaaa2000-0000-0000-0000-000000000001';

do $test$
begin
  begin
    insert into public.delivery_packages (
      id, organization_id, job_id, expected_job_revision, durability_manifest_sha256,
      idempotency_key, confirmed_by_actor_id
    ) values (
      'aaaab000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaa0000-0000-0000-0000-000000000001', 0, repeat('5', 64), 'package-incomplete',
      '11111111-0000-0000-0000-000000000001'
    );
    insert into public.delivery_package_modules (
      package_id, organization_id, module_id, module_type, module_snapshot_id, approval_id, report_version_id
    ) values (
      'aaaab000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaa1000-0000-0000-0000-000000000001', 'building', 'aaaa7000-0000-0000-0000-000000000001',
      'aaaa8000-0000-0000-0000-000000000001', 'aaaa9000-0000-0000-0000-000000000001'
    );
    set constraints all immediate;
    raise exception 'assertion failed: package omitted a commissioned module';
  exception when check_violation then
    raise notice 'ok - package confirmation rejects a missing commissioned module';
  end;
  set constraints all deferred;
end;
$test$;

insert into public.delivery_packages (
  id, organization_id, job_id, expected_job_revision, durability_manifest_sha256,
  idempotency_key, confirmed_by_actor_id
) values (
  'aaaab000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaa0000-0000-0000-0000-000000000001', 0, repeat('6', 64), 'package-complete',
  '11111111-0000-0000-0000-000000000001'
);
insert into public.delivery_package_modules (
  package_id, organization_id, module_id, module_type, module_snapshot_id, approval_id, report_version_id
) values
  ('aaaab000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001', 'building', 'aaaa7000-0000-0000-0000-000000000001', 'aaaa8000-0000-0000-0000-000000000001', 'aaaa9000-0000-0000-0000-000000000001'),
  ('aaaab000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa2000-0000-0000-0000-000000000001', 'timber_pest', 'aaaa7000-0000-0000-0000-000000000002', 'aaaa8000-0000-0000-0000-000000000002', 'aaaa9000-0000-0000-0000-000000000002');
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true(
  (select count(*) = 2 from public.delivery_package_modules where package_id = 'aaaab000-0000-0000-0000-000000000001'),
  'package binds the exact commissioned Building and Timber Pest snapshot set'
);

insert into public.report_artifacts (
  organization_id, report_version_id, artifact_id, presentation_role, ordinal
) values (
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa9000-0000-0000-0000-000000000001',
  'aaaa3000-0000-0000-0000-000000000001', 'primary', 1
);

insert into public.recipient_grants (
  id, organization_id, principal_actor_id, job_id, delivered_report_version_id,
  permitted_modules, permitted_actions, expires_at, issued_by_actor_id, invitation_id, redeemed_at
) values (
  'aaaac000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  '33333333-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001',
  'aaaa9000-0000-0000-0000-000000000001', array['building'], array['read', 'view_media'],
  statement_timestamp() + interval '1 day', '11111111-0000-0000-0000-000000000001',
  'aaaac100-0000-0000-0000-000000000001', statement_timestamp()
);

insert into public.session_events (
  id, organization_id, aggregate_type, aggregate_id, aggregate_version, event_type,
  actor_id, idempotency_key, payload_sha256, event_sha256
) values (
  'aaaad000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'job', 'aaaa0000-0000-0000-0000-000000000001', 1, 'inspection.started',
  '11111111-0000-0000-0000-000000000001', 'event-start', repeat('7', 64), repeat('0', 64)
);

do $test$
begin
  begin
    insert into public.session_events (
      organization_id, aggregate_type, aggregate_id, aggregate_version, event_type,
      idempotency_key, payload_sha256, event_sha256
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001', 'job', 'aaaa0000-0000-0000-0000-000000000001',
      3, 'inspection.completed', 'event-gap', repeat('8', 64), repeat('0', 64)
    );
    raise exception 'assertion failed: event version gap was accepted';
  exception when check_violation then
    raise notice 'ok - event version gaps and reordering are rejected';
  end;
  begin
    insert into public.session_events (
      organization_id, aggregate_type, aggregate_id, aggregate_version, event_type,
      idempotency_key, payload_sha256, previous_event_sha256, event_sha256
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001', 'job', 'aaaa0000-0000-0000-0000-000000000001',
      2, 'inspection.completed', 'event-bad-hash', repeat('8', 64), repeat('f', 64), repeat('0', 64)
    );
    raise exception 'assertion failed: wrong previous event hash was accepted';
  exception when check_violation then
    raise notice 'ok - tamper-evident previous hash mismatch is rejected';
  end;
end;
$test$;

insert into public.session_events (
  organization_id, aggregate_type, aggregate_id, aggregate_version, event_type,
  actor_id, idempotency_key, payload_sha256, previous_event_sha256, event_sha256
) select
  'aaaaaaaa-0000-0000-0000-000000000001', 'job', 'aaaa0000-0000-0000-0000-000000000001',
  2, 'inspection.completed', '11111111-0000-0000-0000-000000000001', 'event-complete',
  repeat('8', 64), event_sha256, repeat('0', 64)
from public.session_events where id = 'aaaad000-0000-0000-0000-000000000001';

select pg_temp.assert_true(
  (select count(*) = 2 and max(aggregate_version) = 2 from public.session_events where aggregate_id = 'aaaa0000-0000-0000-0000-000000000001'),
  'contiguous events append with a server-computed hash chain'
);

do $test$
begin
  begin
    update public.session_events set safe_metadata = '{"mutated":true}' where id = 'aaaad000-0000-0000-0000-000000000001';
    raise exception 'assertion failed: session event update was accepted';
  exception when sqlstate '55000' then
    raise notice 'ok - event update is structurally denied';
  end;
  begin
    delete from public.session_events where id = 'aaaad000-0000-0000-0000-000000000001';
    raise exception 'assertion failed: session event delete was accepted';
  exception when sqlstate '55000' then
    raise notice 'ok - event delete is structurally denied';
  end;
  begin
    insert into public.session_events (
      organization_id, aggregate_type, aggregate_id, aggregate_version, event_type,
      idempotency_key, payload_sha256, event_sha256
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001', 'other', 'bbbb0000-0000-0000-0000-000000000001',
      1, 'system.retry', 'event-start', repeat('9', 64), repeat('0', 64)
    );
    raise exception 'assertion failed: duplicate event idempotency key was accepted';
  exception when unique_violation then
    raise notice 'ok - event idempotency key is unique per tenant';
  end;
end;
$test$;

insert into public.webhook_inbox (
  organization_id, provider, provider_event_id, request_fingerprint, payload_sha256, signature_verified
) values (
  'aaaaaaaa-0000-0000-0000-000000000001', 'stripe', 'evt_test_1', repeat('a', 64), repeat('b', 64), true
);

do $test$
begin
  begin
    insert into public.webhook_inbox (
      organization_id, provider, provider_event_id, request_fingerprint, payload_sha256, signature_verified
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001', 'stripe', 'evt_test_1', repeat('a', 64), repeat('b', 64), true
    );
    raise exception 'assertion failed: replayed provider event was duplicated';
  exception when unique_violation then
    raise notice 'ok - webhook replay collapses to one inbox identity';
  end;
end;
$test$;

insert into public.async_tasks (
  id, organization_id, task_type, aggregate_type, aggregate_id, idempotency_key, request_fingerprint
) values (
  'aaaae000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'render_report', 'job', 'aaaa0000-0000-0000-0000-000000000001', 'task-render-1', repeat('c', 64)
);
insert into public.outbox_records (
  organization_id, async_task_id, destination, action, aggregate_type, aggregate_id,
  idempotency_key, request_fingerprint
) values (
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaae000-0000-0000-0000-000000000001',
  'report-worker', 'render', 'job', 'aaaa0000-0000-0000-0000-000000000001',
  'outbox-render-1', repeat('d', 64)
);

select count(*) from public.lease_async_task('worker-a', interval '2 minutes');
select pg_temp.assert_true(
  (select state = 'running' and lease_generation = 1 and lease_token is not null from public.async_tasks where id = 'aaaae000-0000-0000-0000-000000000001'),
  'worker lease increments a fencing generation and assigns a token'
);
select pg_temp.assert_true(
  not public.complete_async_task(
    'aaaae000-0000-0000-0000-000000000001', 0,
    (select lease_token from public.async_tasks where id = 'aaaae000-0000-0000-0000-000000000001')
  ),
  'stale worker generation cannot commit completion'
);
select pg_temp.assert_true(
  public.complete_async_task(
    'aaaae000-0000-0000-0000-000000000001', 1,
    (select lease_token from public.async_tasks where id = 'aaaae000-0000-0000-0000-000000000001')
  ),
  'current fenced worker commits completion once'
);

do $test$
begin
  begin
    insert into public.async_tasks (
      organization_id, task_type, aggregate_type, aggregate_id, idempotency_key, request_fingerprint
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001', 'render_report', 'job',
      'aaaa0000-0000-0000-0000-000000000001', 'task-render-1', repeat('c', 64)
    );
    raise exception 'assertion failed: duplicate task idempotency key was accepted';
  exception when unique_violation then
    raise notice 'ok - concurrent task identity is idempotent';
  end;
end;
$test$;

-- RLS matrix: Alpha staff cannot see or write Beta rows.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(
  (select count(*) = 1 from public.jobs),
  'tenant member reads only their organization jobs'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.jobs where organization_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'cross-tenant read is denied'
);
do $test$
begin
  begin
    insert into public.artifacts (
      organization_id, job_id, capture_id, capture_sequence, artifact_kind,
      content_sha256, byte_size, media_type, storage_key, captured_at
    ) values (
      'bbbbbbbb-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001',
      'bbbb4000-0000-0000-0000-000000000099', 99, 'photo', repeat('f', 64), 1,
      'image/jpeg', 'bbbbbbbb-0000-0000-0000-000000000001/denied.jpg', statement_timestamp()
    );
    raise exception 'assertion failed: cross-tenant artifact write was accepted';
  exception when insufficient_privilege then
    raise notice 'ok - cross-tenant write is denied';
  end;
end;
$test$;
reset role;

-- A non-member recipient sees only the exact delivered version and curated media.
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(
  (select count(*) = 1 from public.report_versions),
  'recipient capability exposes only the delivered report version'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.artifacts),
  'recipient capability exposes only report-curated media'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.delivery_packages),
  'recipient capability does not leak operational package records'
);
reset role;

insert into public.recipient_grant_revocations (
  organization_id, grant_id, reason, revoked_by_actor_id
) values (
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaac000-0000-0000-0000-000000000001',
  'Recipient access revoked in fixture', '11111111-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.report_versions),
  'revoked recipient capability fails closed immediately'
);
reset role;

-- Amendment creates a new immutable snapshot/report chain without rewriting v1.
insert into public.module_snapshots (
  id, organization_id, job_id, module_id, module_type, snapshot_version, expected_module_revision,
  canonical_sha256, content_manifest, inspector_actor_id, inspector_credential_version,
  requirement_version, template_version
) values (
  'aaaa7000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaa0000-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001',
  'building', 2, 0, repeat('e', 64), '{"module":"building","version":2}'::jsonb,
  '11111111-0000-0000-0000-000000000001', 'credential-v1', 'requirements-v1', 'template-v1'
);
insert into public.module_snapshot_findings (snapshot_id, organization_id, finding_version_id, ordinal) values (
  'aaaa7000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaa6000-0000-0000-0000-000000000001', 1
);
update public.inspection_modules set current_snapshot_id = 'aaaa7000-0000-0000-0000-000000000011' where id = 'aaaa1000-0000-0000-0000-000000000001';
insert into public.module_approvals (
  id, organization_id, module_id, module_type, snapshot_id, snapshot_sha256,
  expected_module_revision, approved_by_actor_id
) values (
  'aaaa8000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaa1000-0000-0000-0000-000000000001', 'building', 'aaaa7000-0000-0000-0000-000000000011',
  repeat('e', 64), 0, '11111111-0000-0000-0000-000000000001'
);
insert into public.report_versions (
  id, organization_id, job_id, module_id, module_type, module_snapshot_id, report_version,
  expected_module_revision, structured_snapshot, canonical_sha256, supersedes_report_version_id,
  amendment_reason, change_notice, issued_by_actor_id
) values (
  'aaaa9000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaa0000-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001',
  'building', 'aaaa7000-0000-0000-0000-000000000011', 2, 0,
  '{"module":"building","amended":true}'::jsonb, repeat('f', 64),
  'aaaa9000-0000-0000-0000-000000000001', 'Correct finding caption',
  'Finding caption corrected; professional classification unchanged.',
  '11111111-0000-0000-0000-000000000001'
);
update public.inspection_modules set current_report_version_id = 'aaaa9000-0000-0000-0000-000000000011' where id = 'aaaa1000-0000-0000-0000-000000000001';

select pg_temp.assert_true(
  (select count(*) = 2 and min(report_version) = 1 and max(report_version) = 2 from public.report_versions where module_id = 'aaaa1000-0000-0000-0000-000000000001'),
  'report amendment preserves v1 and appends contiguous v2 history'
);

insert into public.module_withdrawals (
  organization_id, module_id, module_type, snapshot_id, approval_id,
  expected_module_revision, reason, withdrawn_by_actor_id
) values (
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa1000-0000-0000-0000-000000000001',
  'building', 'aaaa7000-0000-0000-0000-000000000001', 'aaaa8000-0000-0000-0000-000000000001',
  0, 'Material issue discovered before queued package send.', '11111111-0000-0000-0000-000000000001'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.module_withdrawals where approval_id = 'aaaa8000-0000-0000-0000-000000000001'),
  'withdrawal is retained as a separate immutable professional record'
);
select pg_temp.assert_true(
  (select state = 'withdrawn' from public.delivery_package_current_state where package_id = 'aaaab000-0000-0000-0000-000000000001'),
  'queued exact package is withdrawn without rewriting its confirmation history'
);
select pg_temp.assert_true(
  (select count(*) = 2 from public.delivery_package_events where package_id = 'aaaab000-0000-0000-0000-000000000001'),
  'package confirmation and withdrawal remain independently auditable events'
);

insert into public.lifecycle_holds (
  id, organization_id, target_class, target_id, hold_kind, reason, placed_by_actor_id, placed_at
) values (
  'aaaaf000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'artifact', 'aaaa3000-0000-0000-0000-000000000001', 'dispute', 'Synthetic dispute hold',
  '11111111-0000-0000-0000-000000000001', statement_timestamp()
);
do $test$
begin
  begin
    insert into public.lifecycle_holds (
      organization_id, target_class, target_id, hold_kind, reason, placed_by_actor_id
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001', 'artifact',
      'aaaa3000-0000-0000-0000-000000000001', 'dispute', 'Duplicate active hold',
      '11111111-0000-0000-0000-000000000001'
    );
    raise exception 'assertion failed: duplicate active lifecycle hold was accepted';
  exception when unique_violation then
    raise notice 'ok - only one active hold of a kind is accepted per target';
  end;
end;
$test$;
insert into public.lifecycle_hold_releases (
  organization_id, hold_id, release_reason, released_by_actor_id
) values (
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaf000-0000-0000-0000-000000000001',
  'Synthetic dispute resolved', '11111111-0000-0000-0000-000000000001'
);
insert into public.lifecycle_holds (
  organization_id, target_class, target_id, hold_kind, reason, placed_by_actor_id, placed_at
) values (
  'aaaaaaaa-0000-0000-0000-000000000001', 'artifact',
  'aaaa3000-0000-0000-0000-000000000001', 'dispute', 'A later distinct dispute hold',
  '11111111-0000-0000-0000-000000000001', statement_timestamp() + interval '1 microsecond'
);

select pg_temp.assert_true(
  (select count(*) = 2 from public.lifecycle_holds where target_id = 'aaaa3000-0000-0000-0000-000000000001'),
  'hold release is append-only and a later hold preserves both records'
);

rollback;
