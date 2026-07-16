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

create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null
);

insert into public.organizations (id, slug, name) values
  ('cccccccc-0000-0000-0000-000000000001', 'security-alpha', 'Security Alpha'),
  ('dddddddd-0000-0000-0000-000000000001', 'security-beta', 'Security Beta');

insert into public.actors (id, auth_user_id, actor_kind, display_name) values
  ('66666666-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001', 'inspector', 'Security Inspector'),
  ('77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'administrator', 'Security Administrator'),
  ('88888888-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', 'inspector', 'Other Inspector');

insert into public.organization_members (organization_id, actor_id, member_role, status) values
  ('cccccccc-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001', 'inspector', 'active'),
  ('cccccccc-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'administrator', 'active'),
  ('dddddddd-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', 'inspector', 'active');

insert into public.jobs (id, organization_id, reference, property_label, state, revision) values
  ('cccc0000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'SEC-1', 'Synthetic Security Property', 'review', 0);

insert into public.inspection_modules (
  id, organization_id, job_id, module_type, assigned_inspector_actor_id, state, revision
) values (
  'cccc1000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
  'cccc0000-0000-0000-0000-000000000001', 'building',
  '66666666-0000-0000-0000-000000000001', 'review', 0
), (
  'cccc1000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
  'cccc0000-0000-0000-0000-000000000001', 'timber_pest',
  '66666666-0000-0000-0000-000000000001', 'review', 0
);

insert into public.module_snapshots (
  id, organization_id, job_id, module_id, module_type, snapshot_version,
  expected_module_revision, canonical_sha256, content_manifest,
  inspector_actor_id, inspector_credential_version, requirement_version, template_version
) values (
  'cccc1100-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
  'cccc0000-0000-0000-0000-000000000001', 'cccc1000-0000-0000-0000-000000000001',
  'building', 1, 0, repeat('1', 64), '{"module":"building"}'::jsonb,
  '66666666-0000-0000-0000-000000000001', 'credential-v1', 'requirements-v1', 'template-v1'
), (
  'cccc1100-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
  'cccc0000-0000-0000-0000-000000000001', 'cccc1000-0000-0000-0000-000000000002',
  'timber_pest', 1, 0, repeat('2', 64), '{"module":"timber_pest"}'::jsonb,
  '66666666-0000-0000-0000-000000000001', 'credential-v1', 'requirements-v1', 'template-v1'
);

update public.inspection_modules
set current_snapshot_id = case id
  when 'cccc1000-0000-0000-0000-000000000001' then 'cccc1100-0000-0000-0000-000000000001'::uuid
  else 'cccc1100-0000-0000-0000-000000000002'::uuid
end
where id in (
  'cccc1000-0000-0000-0000-000000000001',
  'cccc1000-0000-0000-0000-000000000002'
);

insert into public.registered_devices (
  id, organization_id, actor_id, public_key_sha256, display_label, registered_by_actor_id
) values (
  'cccc2000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001', repeat('a', 64), 'Bound inspector device',
  '66666666-0000-0000-0000-000000000001'
), (
  'cccc2000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001', repeat('b', 64), 'Unbound active device',
  '66666666-0000-0000-0000-000000000001'
), (
  'cccc2000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001',
  '77777777-0000-0000-0000-000000000001', repeat('c', 64), 'Bound administrator device',
  '77777777-0000-0000-0000-000000000001'
);

insert into auth.sessions (id, user_id) values
  ('cccc3000-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001'),
  ('cccc3000-0000-0000-0000-000000000002', '66666666-0000-0000-0000-000000000001'),
  ('cccc3000-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000001');

insert into public.privileged_session_bindings (
  session_id, organization_id, actor_id, device_id, session_started_at, binding_request_sha256
) values (
  'cccc3000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001', 'cccc2000-0000-0000-0000-000000000001',
  statement_timestamp() - interval '10 minutes', repeat('d', 64)
), (
  'cccc3000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001', 'cccc2000-0000-0000-0000-000000000002',
  statement_timestamp() - interval '13 hours', repeat('e', 64)
), (
  'cccc3000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001',
  '77777777-0000-0000-0000-000000000001', 'cccc2000-0000-0000-0000-000000000003',
  statement_timestamp() - interval '10 minutes', repeat('f', 64)
);

insert into public.privileged_session_activity_events (
  session_id, organization_id, actor_id, device_id, occurred_at, request_id_sha256
) values (
  'cccc3000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001', 'cccc2000-0000-0000-0000-000000000001',
  statement_timestamp(), repeat('1', 64)
), (
  'cccc3000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001', 'cccc2000-0000-0000-0000-000000000002',
  statement_timestamp(), repeat('2', 64)
), (
  'cccc3000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001',
  '77777777-0000-0000-0000-000000000001', 'cccc2000-0000-0000-0000-000000000003',
  statement_timestamp(), repeat('3', 64)
);

select set_config('request.jwt.claim.sub', '66666666-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '66666666-0000-0000-0000-000000000001',
    'session_id', 'cccc3000-0000-0000-0000-000000000001',
    'aal', 'aal2',
    'iat', extract(epoch from statement_timestamp())::bigint,
    'exp', extract(epoch from statement_timestamp() + interval '1 hour')::bigint,
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp', 'timestamp', extract(epoch from statement_timestamp())::bigint
    ))
  )::text,
  true
);

select pg_temp.assert_true(
  public.is_module_privileged_request_allowed(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc1000-0000-0000-0000-000000000001', 'approve_module'
  ),
  'assigned inspector with AAL2, fresh MFA and a durable session-device binding may approve'
);

select pg_temp.assert_true(
  public.request_bound_device_id('cccccccc-0000-0000-0000-000000000001')
    = 'cccc2000-0000-0000-0000-000000000001',
  'privileged device identity is derived from the exact session binding'
);

select pg_temp.assert_true(
  not public.is_privileged_request_allowed(
    'dddddddd-0000-0000-0000-000000000001', 'share_report'
  ),
  'tenant-bound session and device cannot authorize a cross-tenant request'
);

select pg_temp.assert_true(
  not public.is_privileged_request_allowed(
    'cccccccc-0000-0000-0000-000000000001', 'unknown_action'
  ),
  'unknown privileged action fails closed'
);

select set_config(
  'request.jwt.claims',
  jsonb_set(
    current_setting('request.jwt.claims')::jsonb,
    '{session_id}', '"cccc3000-0000-0000-0000-000000000002"'::jsonb
  )::text,
  true
);
select pg_temp.assert_true(
  not public.request_session_is_current(
    'cccccccc-0000-0000-0000-000000000001', interval '12 hours'
  ),
  'fresh JWT iat cannot reset the absolute age of the durable session binding'
);

select set_config(
  'request.jwt.claims',
  jsonb_set(
    current_setting('request.jwt.claims')::jsonb,
    '{session_id}', '"cccc3000-0000-0000-0000-000000000001"'::jsonb
  )::text,
  true
);

create temporary table u10_command_results (
  action_name text primary key,
  result_id uuid not null
) on commit drop;

insert into u10_command_results (action_name, result_id)
select 'approve', public.command_approve_module(
  'cccccccc-0000-0000-0000-000000000001',
  'cccc1000-0000-0000-0000-000000000001',
  'cccc1100-0000-0000-0000-000000000001',
  repeat('1', 64), 0, 'approve-security-0001'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.module_approvals approval
    join u10_command_results result on result.action_name = 'approve'
      and result.result_id = approval.id)
  and (select count(*) = 1 from public.privileged_action_audit audit
    join u10_command_results result on result.action_name = 'approve'
      and result.result_id = audit.result_record_id
    where audit.action_name = 'approve_module'
      and audit.device_id = 'cccc2000-0000-0000-0000-000000000001'
      and audit.outcome = 'completed'),
  'approval and its audit commit atomically with the derived bound device'
);

select pg_temp.assert_true(
  public.command_approve_module(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc1000-0000-0000-0000-000000000001',
    'cccc1100-0000-0000-0000-000000000001',
    repeat('1', 64), 0, 'approve-security-0001'
  ) = (select result_id from u10_command_results where action_name = 'approve')
  and (select count(*) = 1 from public.privileged_action_audit where action_name = 'approve_module'),
  'exact idempotent approval replay returns the original result without a second audit row'
);

insert into u10_command_results (action_name, result_id)
select 'approve_other', public.command_approve_module(
  'cccccccc-0000-0000-0000-000000000001',
  'cccc1000-0000-0000-0000-000000000002',
  'cccc1100-0000-0000-0000-000000000002',
  repeat('2', 64), 0, 'approve-security-0002'
);

do $test$
declare
  command_result uuid;
begin
  command_result := public.command_withdraw_module(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc1000-0000-0000-0000-000000000001',
    'cccc1100-0000-0000-0000-000000000001',
    (select result_id from u10_command_results where action_name = 'approve_other'),
    0, 'Mismatched approval must not withdraw', 'withdraw-security-mismatch'
  );
  perform pg_temp.assert_true(
    command_result is null
    and not exists (
      select 1 from public.module_withdrawals withdrawal
      where withdrawal.approval_id = (
        select result_id from u10_command_results where action_name = 'approve_other'
      )
    )
    and exists (
      select 1 from public.privileged_action_audit audit
      where audit.action_name = 'withdraw_report'
        and audit.outcome = 'denied'
        and audit.reason_code = 'approval_binding_mismatch'
    ),
    'withdrawal binds the exact module, type, snapshot, revision and approval tuple'
  );
end;
$test$;

insert into u10_command_results (action_name, result_id)
select 'withdraw', public.command_withdraw_module(
  'cccccccc-0000-0000-0000-000000000001',
  'cccc1000-0000-0000-0000-000000000001',
  'cccc1100-0000-0000-0000-000000000001',
  (select result_id from u10_command_results where action_name = 'approve'),
  0, 'Professional withdrawal test', 'withdraw-security-0001'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.module_withdrawals withdrawal
    join u10_command_results result on result.action_name = 'withdraw'
      and result.result_id = withdrawal.id)
  and (select count(*) = 1 from public.privileged_action_audit audit
    join u10_command_results result on result.action_name = 'withdraw'
      and result.result_id = audit.result_record_id
    where audit.action_name = 'withdraw_report'),
  'withdrawal and its audit commit atomically through the privileged command'
);

select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.module_approvals', 'INSERT')
  and not has_table_privilege('authenticated', 'public.module_withdrawals', 'INSERT')
  and not has_table_privilege('service_role', 'public.module_approvals', 'INSERT')
  and not has_table_privilege('service_role', 'public.module_withdrawals', 'INSERT')
  and has_function_privilege(
    'authenticated',
    'public.command_approve_module(uuid,uuid,uuid,text,bigint,text)', 'EXECUTE'
  ),
  'authenticated callers have command execution but no direct approval or withdrawal insert path'
);

select set_config(
  'request.jwt.claims',
  jsonb_set(current_setting('request.jwt.claims')::jsonb, '{aal}', '"aal1"'::jsonb)::text,
  true
);
do $test$
declare
  command_result uuid;
begin
  command_result := public.command_approve_module(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc1000-0000-0000-0000-000000000001',
    'cccc1100-0000-0000-0000-000000000001',
    repeat('1', 64), 0, 'approve-security-aal1'
  );
  perform pg_temp.assert_true(
    command_result is null
    and exists (
      select 1 from public.privileged_action_audit audit
      where audit.action_name = 'approve_module'
        and audit.outcome = 'denied'
        and audit.reason_code = 'privileged_guard_denied'
        and audit.assurance_level = 'aal1'
    ),
    'AAL1 approval is denied with a durable structured audit record'
  );
end;
$test$;

select set_config(
  'request.jwt.claims',
  jsonb_set(current_setting('request.jwt.claims')::jsonb, '{aal}', '"aal2"'::jsonb)::text,
  true
);
delete from auth.sessions where id = 'cccc3000-0000-0000-0000-000000000001';
select pg_temp.assert_true(
  not public.is_privileged_request_allowed(
    'cccccccc-0000-0000-0000-000000000001', 'share_report'
  ),
  'missing auth session cannot be restored from JWT claims or binding alone'
);
insert into auth.sessions (id, user_id) values (
  'cccc3000-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001'
);

insert into public.device_revocations (
  organization_id, device_id, revoked_by_actor_id, reason_code
) values (
  'cccccccc-0000-0000-0000-000000000001', 'cccc2000-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001', 'lost_device'
);
select pg_temp.assert_true(
  not public.is_privileged_request_allowed(
    'cccccccc-0000-0000-0000-000000000001', 'share_report'
  )
  and to_regprocedure('public.request_device_is_active(uuid,uuid,interval)') is null,
  'bound device revocation is immediate and callers cannot substitute another active device argument'
);

select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.privileged_session_bindings', 'INSERT')
  and not has_table_privilege('authenticated', 'public.privileged_session_activity_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.privileged_action_audit', 'INSERT'),
  'session binding, privileged activity and audit writes are server mediated'
);

do $test$
begin
  begin
    update public.device_revocations set reason_code = 'changed_reason';
    raise exception 'assertion failed: device revocation mutation was accepted';
  exception when sqlstate '55000' then
    raise notice 'ok - device revocations are append-only';
  end;
end;
$test$;

-- Canonical restore verification requires a revoked device's server session to
-- be absent rather than trusting a service-authored boolean.
delete from auth.sessions where id = 'cccc3000-0000-0000-0000-000000000001';

-- Restore egress is default-off, remains off after checks alone, and is enabled
-- only by a current AAL2 administrator command with an atomic audit event.
select set_config('request.jwt.claim.sub', '77777777-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '77777777-0000-0000-0000-000000000001',
    'session_id', 'cccc3000-0000-0000-0000-000000000003',
    'aal', 'aal2',
    'iat', extract(epoch from statement_timestamp())::bigint,
    'exp', extract(epoch from statement_timestamp() + interval '1 hour')::bigint,
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'webauthn', 'timestamp', extract(epoch from statement_timestamp())::bigint
    ))
  )::text,
  true
);

select pg_temp.assert_true(
  not public.restore_egress_is_enabled(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test'
  ),
  'restore egress is disabled by default when there is no enable event'
);

select pg_temp.assert_true(
  public.command_begin_restore_generation(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test', repeat('a', 64),
    '77777777-0000-0000-0000-000000000001'
  ) = 1,
  'trusted coordinator starts generation one in authoritative default-off state'
);

do $test$
declare
  command_result uuid;
begin
  command_result := public.command_enable_restore_egress(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test', 'restore-security-early'
  );
  perform pg_temp.assert_true(
    command_result is null
    and exists (
      select 1 from public.privileged_action_audit audit
      where audit.action_name = 'enable_restore_egress'
        and audit.outcome = 'denied'
        and audit.reason_code = 'restore_reconciliation_incomplete'
    ),
    'enablement before canonical verification is denied and durably audited'
  );
end;
$test$;

do $test$
declare
  verification_run bigint;
begin
  verification_run := public.command_verify_restore_generation(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test',
    '77777777-0000-0000-0000-000000000001'
  );
  perform pg_temp.assert_true(
    verification_run = 1
    and (select count(*) = 8
      from public.restore_reconciliation_checks checks
      where checks.organization_id = 'cccccccc-0000-0000-0000-000000000001'
        and checks.restore_session_id = 'cccc4000-0000-0000-0000-000000000001'
        and checks.verifier_version = 'restore_sql_v1'
        and checks.verdict = 'passed'
        and checks.violation_count = 0),
    'canonical SQL verifier derives all eight verdicts and evidence digests'
  );
end;
$test$;

select pg_temp.assert_true(
  not has_table_privilege('service_role', 'public.restore_generations', 'INSERT')
  and not has_table_privilege('service_role', 'public.restore_reconciliation_checks', 'INSERT')
  and not has_table_privilege('service_role', 'public.restore_egress_events', 'INSERT'),
  'restore coordinator can invoke narrow commands but cannot self-attest rows or enable bits'
);

select pg_temp.assert_true(
  public.restore_is_reconciled(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test'
  ) and not public.restore_egress_is_enabled(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test'
  ),
  'canonical passing checks are necessary but cannot self-enable restore egress'
);

insert into u10_command_results (action_name, result_id)
select 'restore_one', public.command_enable_restore_egress(
  'cccccccc-0000-0000-0000-000000000001',
  'cccc4000-0000-0000-0000-000000000001', 'test', 'restore-security-0001'
);

select pg_temp.assert_true(
  public.restore_egress_is_enabled(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test'
  )
  and (public.restore_egress_projection(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test'
  ) ->> 'state') = 'enabled'
  and (public.restore_egress_projection(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000001', 'test'
  ) ->> 'projectionHash') ~ '^[0-9a-f]{64}$',
  'audited generation-one enablement exposes a hash-bound service projection'
);

do $test$
declare
  restore_generation bigint;
begin
  restore_generation := public.command_begin_restore_generation(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000002', 'test', repeat('b', 64),
    '77777777-0000-0000-0000-000000000001'
  );
  perform pg_temp.assert_true(
    restore_generation = 2
    and not public.restore_egress_is_enabled(
      'cccccccc-0000-0000-0000-000000000001',
      'cccc4000-0000-0000-0000-000000000001', 'test'
    )
    and not public.restore_egress_is_enabled(
      'cccccccc-0000-0000-0000-000000000001',
      'cccc4000-0000-0000-0000-000000000002', 'test'
    ),
    'starting generation two atomically invalidates older generation enablement'
  );
end;
$test$;

select pg_temp.assert_true(
  public.command_verify_restore_generation(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000002', 'test',
    '77777777-0000-0000-0000-000000000001'
  ) = 1,
  'new active generation requires its own canonical verification run'
);

insert into u10_command_results (action_name, result_id)
select 'restore_two', public.command_enable_restore_egress(
  'cccccccc-0000-0000-0000-000000000001',
  'cccc4000-0000-0000-0000-000000000002', 'test', 'restore-security-0002'
);

select public.require_restore_egress_enabled(
  'cccccccc-0000-0000-0000-000000000001',
  'cccc4000-0000-0000-0000-000000000002', 'test'
);

insert into u10_command_results (action_name, result_id)
select 'restore_disable', public.command_disable_restore_egress(
  'cccccccc-0000-0000-0000-000000000001',
  'cccc4000-0000-0000-0000-000000000002', 'test', 'restore-disable-0002'
);

select pg_temp.assert_true(
  not public.restore_egress_is_enabled(
    'cccccccc-0000-0000-0000-000000000001',
    'cccc4000-0000-0000-0000-000000000002', 'test'
  )
  and (select count(*) = 1 from public.privileged_action_audit audit
    join u10_command_results result on result.action_name = 'restore_disable'
      and result.result_id = audit.result_record_id
    where audit.action_name = 'disable_restore_egress'
      and audit.outcome = 'completed'),
  'emergency disable is immediate, authoritative and atomically audited'
);

do $test$
declare
  attempt integer;
  decision record;
begin
  for attempt in 1..10 loop
    select * into decision from public.command_consume_rate_limit(
      'privileged_action', repeat('7', 64)
    );
    if decision.allowed is distinct from true then
      raise exception 'assertion failed: durable limiter denied allowed attempt %', attempt;
    end if;
  end loop;
  select * into decision from public.command_consume_rate_limit(
    'privileged_action', repeat('7', 64)
  );
  perform pg_temp.assert_true(
    decision.allowed is false
    and decision.remaining = 0
    and decision.retry_after_seconds between 1 and 60
    and (select consumed_count = 10 from public.rate_limit_buckets
      where policy_name = 'privileged_action'
        and opaque_key_sha256 = repeat('7', 64)),
    'database-wide fixed policy blocks the eleventh attempt without caller-selected time or limits'
  );
end;
$test$;

select pg_temp.assert_true(
  not has_table_privilege('service_role', 'public.rate_limit_buckets', 'INSERT')
  and not has_table_privilege('authenticated', 'public.rate_limit_buckets', 'SELECT')
  and has_function_privilege(
    'service_role', 'public.command_consume_rate_limit(text,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.command_consume_rate_limit(text,text)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.command_prune_rate_limit_buckets()', 'EXECUTE'
  ),
  'rate-limit state is reachable only through the narrow service command'
);

do $test$
begin
  begin
    perform public.command_consume_rate_limit(
      'caller_selected_policy', repeat('6', 64)
    );
    raise exception 'assertion failed: caller-selected rate-limit policy was accepted';
  exception when invalid_parameter_value then
    raise notice 'ok - rate-limit policies and limits are fixed by the database';
  end;
  begin
    perform public.command_consume_rate_limit('recipient_access', 'raw-email-or-ip');
    raise exception 'assertion failed: raw rate-limit identity was accepted';
  exception when invalid_parameter_value then
    raise notice 'ok - rate-limit state accepts only one-way identity digests';
  end;
end;
$test$;

do $test$
begin
  begin
    insert into public.secret_key_events (
      organization_id, environment_name, purpose, key_id_sha256, event_kind,
      recorded_by_actor_id
    ) values (
      'cccccccc-0000-0000-0000-000000000001', 'test', 'artifact_encryption',
      repeat('9', 64), 'decrypt_only', '77777777-0000-0000-0000-000000000001'
    );
    raise exception 'assertion failed: unbounded decrypt-only key event was accepted';
  exception when check_violation then
    raise notice 'ok - decrypt-only key events require a future bounded expiry';
  end;
end;
$test$;

do $test$
begin
  begin
    insert into public.secret_key_events (
      organization_id, environment_name, purpose, key_id_sha256, event_kind,
      decrypt_only_until, recorded_by_actor_id
    ) values (
      'cccccccc-0000-0000-0000-000000000001', 'test', 'artifact_encryption',
      repeat('8', 64), 'decrypt_only', statement_timestamp() + interval '31 days',
      '77777777-0000-0000-0000-000000000001'
    );
    raise exception 'assertion failed: overlong decrypt-only overlap was accepted';
  exception when check_violation then
    raise notice 'ok - decrypt-only overlap cannot exceed thirty days';
  end;
end;
$test$;

rollback;
