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
  ('eeaaaaaa-0000-4000-8000-000000000001', 'trusted-alpha', 'Trusted Alpha'),
  ('eebbbbbb-0000-4000-8000-000000000001', 'trusted-beta', 'Trusted Beta');

insert into public.actors (id, auth_user_id, actor_kind, display_name) values
  ('ee100000-0000-4000-8000-000000000001', 'ee100000-0000-4000-8000-000000000001', 'inspector', 'Assigned Inspector'),
  ('ee200000-0000-4000-8000-000000000001', 'ee200000-0000-4000-8000-000000000001', 'inspector', 'Other Inspector');

insert into public.organization_members (organization_id, actor_id, member_role, status) values
  ('eeaaaaaa-0000-4000-8000-000000000001', 'ee100000-0000-4000-8000-000000000001', 'inspector', 'active'),
  ('eebbbbbb-0000-4000-8000-000000000001', 'ee200000-0000-4000-8000-000000000001', 'inspector', 'active');

insert into public.jobs (id, organization_id, reference, property_label, state, revision) values
  ('eea00000-0000-4000-8000-000000000001', 'eeaaaaaa-0000-4000-8000-000000000001', 'TRUST-A', 'Trusted Alpha Property', 'review', 0),
  ('eeb00000-0000-4000-8000-000000000001', 'eebbbbbb-0000-4000-8000-000000000001', 'TRUST-B', 'Trusted Beta Property', 'review', 0);

insert into public.inspection_modules (
  id, organization_id, job_id, module_type, assigned_inspector_actor_id, state, revision
) values (
  'eea10000-0000-4000-8000-000000000001', 'eeaaaaaa-0000-4000-8000-000000000001',
  'eea00000-0000-4000-8000-000000000001', 'building',
  'ee100000-0000-4000-8000-000000000001', 'review', 0
), (
  'eeb10000-0000-4000-8000-000000000001', 'eebbbbbb-0000-4000-8000-000000000001',
  'eeb00000-0000-4000-8000-000000000001', 'building',
  'ee200000-0000-4000-8000-000000000001', 'review', 0
);

-- This fixture represents the output of the existing service-only durability
-- command. The authenticated inspector may reference it but cannot forge it.
insert into public.artifacts (
  id, organization_id, job_id, capture_id, capture_sequence, artifact_kind,
  evidence_visibility, content_sha256, byte_size, media_type, storage_key,
  captured_at, quarantine_state
) values (
  'eea20000-0000-4000-8000-000000000001', 'eeaaaaaa-0000-4000-8000-000000000001',
  'eea00000-0000-4000-8000-000000000001', 'eea21000-0000-4000-8000-000000000001',
  1, 'photo', 'report_candidate', repeat('a', 64), 1024, 'image/jpeg',
  'quarantine/eeaaaaaa-0000-4000-8000-000000000001/eea00000-0000-4000-8000-000000000001/evidence.jpg',
  statement_timestamp(), 'accepted'
), (
  'eea20000-0000-4000-8000-000000000002', 'eeaaaaaa-0000-4000-8000-000000000001',
  'eea00000-0000-4000-8000-000000000001', 'eea21000-0000-4000-8000-000000000002',
  2, 'photo', 'report_candidate', repeat('b', 64), 2048, 'image/jpeg',
  'quarantine/eeaaaaaa-0000-4000-8000-000000000001/eea00000-0000-4000-8000-000000000001/not-durable.jpg',
  statement_timestamp(), 'pending'
);

insert into public.artifact_durability_receipts (
  organization_id, artifact_id, object_version, observed_sha256,
  observed_byte_size, observer_actor_id
) values (
  'eeaaaaaa-0000-4000-8000-000000000001',
  'eea20000-0000-4000-8000-000000000001', 'object-v1', repeat('a', 64),
  1024, 'ee100000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ee100000-0000-4000-8000-000000000001', true);

select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.artifacts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.artifact_durability_receipts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.findings', 'INSERT')
  and not has_table_privilege('authenticated', 'public.findings', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.finding_versions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.finding_evidence', 'INSERT')
  and not has_table_privilege('authenticated', 'public.module_snapshots', 'INSERT')
  and not has_table_privilege('authenticated', 'public.module_snapshot_findings', 'INSERT')
  and not has_table_privilege('authenticated', 'public.module_snapshot_artifacts', 'INSERT'),
  'authenticated clients hold no direct trusted-transition table write privilege'
);

select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.command_append_finding_version(uuid,uuid,uuid,bigint,jsonb,jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.command_create_module_snapshot(uuid,uuid,bigint,jsonb,uuid[],jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.command_append_finding_version(uuid,uuid,uuid,bigint,jsonb,jsonb,text)',
    'EXECUTE'
  ),
  'only authenticated or trusted service callers can invoke professional commands'
);

do $test$
begin
  begin
    insert into public.artifacts (
      organization_id, job_id, capture_id, capture_sequence, artifact_kind,
      content_sha256, byte_size, media_type, storage_key, captured_at
    ) values (
      'eeaaaaaa-0000-4000-8000-000000000001', 'eea00000-0000-4000-8000-000000000001',
      'eea21000-0000-4000-8000-000000000099', 99, 'photo', repeat('f', 64),
      1, 'image/jpeg', 'forged/client.jpg', statement_timestamp()
    );
    raise exception 'assertion failed: authenticated artifact insert was accepted';
  exception when insufficient_privilege then
    raise notice 'ok - authenticated artifact insert is denied';
  end;

  begin
    insert into public.artifact_durability_receipts (
      organization_id, artifact_id, object_version, observed_sha256, observed_byte_size
    ) values (
      'eeaaaaaa-0000-4000-8000-000000000001',
      'eea20000-0000-4000-8000-000000000002', 'forged-v1', repeat('b', 64), 2048
    );
    raise exception 'assertion failed: authenticated durability receipt insert was accepted';
  exception when insufficient_privilege then
    raise notice 'ok - authenticated durability receipt insert is denied';
  end;

  begin
    insert into public.findings (
      organization_id, module_id, module_type, state, revision
    ) values (
      'eeaaaaaa-0000-4000-8000-000000000001',
      'eea10000-0000-4000-8000-000000000001', 'building', 'confirmed', 0
    );
    raise exception 'assertion failed: authenticated finding insert was accepted';
  exception when insufficient_privilege then
    raise notice 'ok - authenticated finding insert is denied';
  end;

  begin
    insert into public.module_snapshots (
      organization_id, job_id, module_id, module_type, snapshot_version,
      expected_module_revision, canonical_sha256, content_manifest,
      inspector_actor_id, inspector_credential_version, requirement_version,
      template_version
    ) values (
      'eeaaaaaa-0000-4000-8000-000000000001', 'eea00000-0000-4000-8000-000000000001',
      'eea10000-0000-4000-8000-000000000001', 'building', 1, 0,
      repeat('c', 64), '{}'::jsonb, 'ee100000-0000-4000-8000-000000000001',
      'credential-v1', 'requirements-v1', 'template-v1'
    );
    raise exception 'assertion failed: authenticated module snapshot insert was accepted';
  exception when insufficient_privilege then
    raise notice 'ok - authenticated module snapshot insert is denied';
  end;
end;
$test$;

select public.command_append_finding_version(
  'eeaaaaaa-0000-4000-8000-000000000001',
  'eea10000-0000-4000-8000-000000000001',
  'eea30000-0000-4000-8000-000000000001',
  0,
  jsonb_build_object(
    'authorshipOrigin', 'human',
    'taxonomyCode', 'major_defect',
    'observation', 'Cracked shower-base and bathroom floor tiles.',
    'apparentExtent', 'Cracking is visible in several tiles.',
    'significance', 'Movement may have affected the waterproofing membrane.',
    'qualifiedHypothesis', 'Subfloor movement is suspected but not visually confirmed.',
    'uncertainty', 'The concealed subfloor and membrane were not inspected.',
    'furtherInvestigation', 'Engage a suitably licensed builder or tiler to investigate.',
    'verifierState', 'not_required',
    'confirm', true
  ),
  jsonb_build_array(jsonb_build_object(
    'artifactId', 'eea20000-0000-4000-8000-000000000001',
    'role', 'context'
  )),
  'finding-command-0001'
);

select pg_temp.assert_true(
  (select count(*) = 1
    from public.findings finding
    where finding.id = 'eea30000-0000-4000-8000-000000000001'
      and finding.state = 'confirmed'
      and finding.revision = 1
      and finding.current_version_id is not null)
  and (select count(*) = 1
    from public.finding_versions version
    join public.findings finding on finding.current_version_id = version.id
    where finding.id = 'eea30000-0000-4000-8000-000000000001'
      and version.version = 1
      and version.expected_finding_revision = 0
      and version.confirmed_by_actor_id = 'ee100000-0000-4000-8000-000000000001'
      and version.content_sha256 ~ '^[0-9a-f]{64}$')
  and (select count(*) = 1
    from public.finding_evidence evidence
    join public.findings finding on finding.current_version_id = evidence.finding_version_id
    where finding.id = 'eea30000-0000-4000-8000-000000000001'
      and evidence.artifact_id = 'eea20000-0000-4000-8000-000000000001'),
  'finding head, immutable version, durable evidence and derived inspector commit atomically'
);

select pg_temp.assert_true(
  public.command_append_finding_version(
    'eeaaaaaa-0000-4000-8000-000000000001',
    'eea10000-0000-4000-8000-000000000001',
    'eea30000-0000-4000-8000-000000000001',
    0,
    jsonb_build_object(
      'authorshipOrigin', 'human',
      'taxonomyCode', 'major_defect',
      'observation', 'Cracked shower-base and bathroom floor tiles.',
      'apparentExtent', 'Cracking is visible in several tiles.',
      'significance', 'Movement may have affected the waterproofing membrane.',
      'qualifiedHypothesis', 'Subfloor movement is suspected but not visually confirmed.',
      'uncertainty', 'The concealed subfloor and membrane were not inspected.',
      'furtherInvestigation', 'Engage a suitably licensed builder or tiler to investigate.',
      'verifierState', 'not_required',
      'confirm', true
    ),
    jsonb_build_array(jsonb_build_object(
      'artifactId', 'eea20000-0000-4000-8000-000000000001',
      'role', 'context'
    )),
    'finding-command-0001'
  ) = (
    select current_version_id from public.findings
    where id = 'eea30000-0000-4000-8000-000000000001'
  )
  and (select count(*) = 1 from public.finding_versions
    where finding_id = 'eea30000-0000-4000-8000-000000000001'),
  'exact finding command replay returns the original version without another transition'
);

do $test$
begin
  begin
    perform public.command_append_finding_version(
      'eeaaaaaa-0000-4000-8000-000000000001',
      'eea10000-0000-4000-8000-000000000001',
      'eea30000-0000-4000-8000-000000000002', 0,
      jsonb_build_object(
        'authorshipOrigin', 'human', 'taxonomyCode', 'minor_defect',
        'observation', 'Caller-selected hash attempt',
        'verifierState', 'not_required', 'contentSha256', repeat('0', 64),
        'confirm', true
      ),
      '[]'::jsonb, 'finding-command-bad-hash'
    );
    raise exception 'assertion failed: caller-selected finding hash was accepted';
  exception when check_violation then
    raise notice 'ok - finding content hash is derived and caller mismatch is rejected';
  end;

  begin
    perform public.command_append_finding_version(
      'eeaaaaaa-0000-4000-8000-000000000001',
      'eea10000-0000-4000-8000-000000000001',
      'eea30000-0000-4000-8000-000000000001', 0,
      jsonb_build_object(
        'authorshipOrigin', 'human', 'taxonomyCode', 'minor_defect',
        'observation', 'Changed request', 'verifierState', 'not_required',
        'confirm', true
      ),
      '[]'::jsonb, 'finding-command-0001'
    );
    raise exception 'assertion failed: changed finding idempotency replay was accepted';
  exception when unique_violation then
    raise notice 'ok - changed finding replay fails closed on the durable idempotency receipt';
  end;

  begin
    update public.findings
    set state = 'removed'
    where id = 'eea30000-0000-4000-8000-000000000001';
    raise exception 'assertion failed: authenticated finding head update was accepted';
  exception when insufficient_privilege then
    raise notice 'ok - authenticated finding head update is denied';
  end;
end;
$test$;

do $test$
begin
  begin
    perform public.command_create_module_snapshot(
      'eeaaaaaa-0000-4000-8000-000000000001',
      'eea10000-0000-4000-8000-000000000001', 0,
      jsonb_build_object(
        'canonicalSha256', repeat('0', 64),
        'contentManifest', jsonb_build_object('module', 'building'),
        'inspectorCredentialVersion', 'credential-v1',
        'requirementVersion', 'requirements-v1',
        'templateVersion', 'template-v1'
      ),
      array[(select current_version_id from public.findings
        where id = 'eea30000-0000-4000-8000-000000000001')],
      jsonb_build_array(jsonb_build_object(
        'artifactId', 'eea20000-0000-4000-8000-000000000001',
        'artifactSha256', repeat('a', 64),
        'selectionRole', 'source'
      )),
      'snapshot-command-bad-hash'
    );
    raise exception 'assertion failed: caller-selected snapshot hash was accepted';
  exception when check_violation then
    raise notice 'ok - snapshot hash is derived and caller mismatch is rejected';
  end;

  begin
    perform public.command_create_module_snapshot(
      'eeaaaaaa-0000-4000-8000-000000000001',
      'eea10000-0000-4000-8000-000000000001', 0,
      jsonb_build_object(
        'contentManifest', jsonb_build_object('module', 'building'),
        'inspectorCredentialVersion', 'credential-v1',
        'requirementVersion', 'requirements-v1',
        'templateVersion', 'template-v1'
      ),
      array[(select current_version_id from public.findings
        where id = 'eea30000-0000-4000-8000-000000000001')],
      jsonb_build_array(jsonb_build_object(
        'artifactId', 'eea20000-0000-4000-8000-000000000002',
        'artifactSha256', repeat('b', 64),
        'selectionRole', 'source'
      )),
      'snapshot-command-bad1'
    );
    raise exception 'assertion failed: snapshot accepted an artifact without a durability receipt';
  exception when check_violation then
    raise notice 'ok - snapshot rejects evidence without an independent durability receipt';
  end;
end;
$test$;

select pg_temp.assert_true(
  (select count(*) = 0 from public.module_snapshots
    where module_id = 'eea10000-0000-4000-8000-000000000001'),
  'failed snapshot command leaves no partial snapshot graph'
);

select public.command_create_module_snapshot(
  'eeaaaaaa-0000-4000-8000-000000000001',
  'eea10000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'contentManifest', jsonb_build_object('module', 'building', 'version', 1),
    'inspectorCredentialVersion', 'credential-v1',
    'requirementVersion', 'requirements-v1',
    'templateVersion', 'template-v1'
  ),
  array[(select current_version_id from public.findings
    where id = 'eea30000-0000-4000-8000-000000000001')],
  jsonb_build_array(jsonb_build_object(
    'artifactId', 'eea20000-0000-4000-8000-000000000001',
    'artifactSha256', repeat('a', 64),
    'selectionRole', 'report_selected'
  )),
  'snapshot-command-0001'
);

select pg_temp.assert_true(
  (select count(*) = 1
    from public.module_snapshots snapshot
    join public.inspection_modules module on module.current_snapshot_id = snapshot.id
    where module.id = 'eea10000-0000-4000-8000-000000000001'
      and module.revision = 1
      and module.state = 'review'
      and snapshot.expected_module_revision = 0
      and snapshot.inspector_actor_id = 'ee100000-0000-4000-8000-000000000001'
      and snapshot.canonical_sha256 ~ '^[0-9a-f]{64}$')
  and (select count(*) = 1 from public.module_snapshot_findings relation
    join public.inspection_modules module on module.current_snapshot_id = relation.snapshot_id
    where module.id = 'eea10000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.module_snapshot_artifacts relation
    join public.inspection_modules module on module.current_snapshot_id = relation.snapshot_id
    where module.id = 'eea10000-0000-4000-8000-000000000001'
      and relation.artifact_sha256 = repeat('a', 64)),
  'snapshot row, exact finding and durable artifact graph, pointer and revision commit atomically'
);

select pg_temp.assert_true(
  public.command_create_module_snapshot(
    'eeaaaaaa-0000-4000-8000-000000000001',
    'eea10000-0000-4000-8000-000000000001', 0,
    jsonb_build_object(
      'contentManifest', jsonb_build_object('module', 'building', 'version', 1),
      'inspectorCredentialVersion', 'credential-v1',
      'requirementVersion', 'requirements-v1',
      'templateVersion', 'template-v1'
    ),
    array[(select current_version_id from public.findings
      where id = 'eea30000-0000-4000-8000-000000000001')],
    jsonb_build_array(jsonb_build_object(
      'artifactId', 'eea20000-0000-4000-8000-000000000001',
      'artifactSha256', repeat('a', 64),
      'selectionRole', 'report_selected'
    )),
    'snapshot-command-0001'
  ) = (
    select current_snapshot_id from public.inspection_modules
    where id = 'eea10000-0000-4000-8000-000000000001'
  )
  and (select count(*) = 1 from public.module_snapshots
    where module_id = 'eea10000-0000-4000-8000-000000000001'),
  'exact snapshot command replay returns the original immutable graph'
);

select set_config('request.jwt.claim.sub', 'ee200000-0000-4000-8000-000000000001', true);
do $test$
begin
  begin
    perform public.command_append_finding_version(
      'eeaaaaaa-0000-4000-8000-000000000001',
      'eea10000-0000-4000-8000-000000000001',
      'eea30000-0000-4000-8000-000000000099', 0,
      jsonb_build_object(
        'authorshipOrigin', 'human', 'taxonomyCode', 'observation',
        'observation', 'Cross-tenant attempt', 'verifierState', 'not_required',
        'confirm', true
      ),
      '[]'::jsonb, 'finding-command-cross-tenant'
    );
    raise exception 'assertion failed: unassigned inspector command was accepted';
  exception when insufficient_privilege then
    raise notice 'ok - unassigned cross-tenant inspector command is denied';
  end;
end;
$test$;

reset role;

select pg_temp.assert_true(
  (select count(*) = 2 from public.professional_transition_receipts
    where organization_id = 'eeaaaaaa-0000-4000-8000-000000000001')
  and (select count(*) = 0 from public.findings
    where id = 'eea30000-0000-4000-8000-000000000099'),
  'only the two successful professional transitions produced durable receipts'
);

rollback;
