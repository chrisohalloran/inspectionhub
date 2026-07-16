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

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.recipient_demo_grants', 'SELECT')
  and not has_table_privilege('authenticated', 'public.recipient_demo_grants', 'INSERT')
  and not has_function_privilege(
    'anon', 'public.command_recipient_demo_claim_invitation(text,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_recipient_demo_record_share(uuid,bigint,text,text,text,text,text,text,timestamptz)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.command_recipient_demo_record_contact(uuid,bigint,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'recipient authority tables and commands are service-only'
);

select
  result ->> 'challengeId' as challenge_id,
  result ->> 'invitationDigest' as invitation_digest,
  result ->> 'intendedEmail' as intended_email
from public.command_recipient_demo_claim_invitation(
  repeat('a', 43), 'recipient@example.com'
) result
\gset recipient_

do $test$
begin
  begin
    perform public.command_recipient_demo_claim_invitation(
      repeat('a', 43), 'recipient@example.com'
    );
    raise exception 'assertion failed: invitation replay was accepted';
  exception when unique_violation then
    raise notice 'ok - invitation claim is single-use under the database lock';
  end;
end;
$test$;

select
  result ->> 'grantId' as grant_id,
  result ->> 'principalId' as principal_id,
  result ->> 'verifiedEmail' as verified_email,
  result ->> 'organizationId' as organization_id,
  result ->> 'jobId' as job_id,
  result ->> 'reportVersionId' as report_version_id,
  (result ->> 'revision')::bigint as grant_revision,
  result ->> 'expiresAt' as grant_expires_at
from public.command_recipient_demo_issue_grant(
  :'recipient_challenge_id'::uuid,
  :'recipient_invitation_digest',
  :'recipient_intended_email'
) result
\gset recipient_

create temporary table recipient_test_context (
  challenge_id uuid,
  invitation_digest text,
  intended_email text,
  grant_id uuid,
  grant_revision bigint,
  principal_id text,
  verified_email text,
  organization_id text,
  job_id text,
  report_version_id text,
  grant_expires_at timestamptz
) on commit drop;

insert into recipient_test_context values (
  :'recipient_challenge_id'::uuid,
  :'recipient_invitation_digest',
  :'recipient_intended_email',
  :'recipient_grant_id'::uuid,
  :'recipient_grant_revision'::bigint,
  :'recipient_principal_id',
  :'recipient_verified_email',
  :'recipient_organization_id',
  :'recipient_job_id',
  :'recipient_report_version_id',
  :'recipient_grant_expires_at'::timestamptz
);

select pg_temp.assert_true(
  mod(
    floor(extract(microseconds from :'recipient_grant_expires_at'::timestamptz))::bigint,
    1000
  ) = 0,
  'issued grant expiry is normalized to the JavaScript millisecond contract'
);

do $test$
declare
  context recipient_test_context%rowtype;
begin
  select * into context from recipient_test_context;
  begin
    perform public.command_recipient_demo_issue_grant(
      context.challenge_id,
      context.invitation_digest,
      context.intended_email
    );
    raise exception 'assertion failed: completed challenge was reused';
  exception when insufficient_privilege then
    raise notice 'ok - challenge completion is append-only and single-use';
  end;
end;
$test$;

select pg_temp.assert_true(
  (public.command_recipient_demo_authorise(
    :'recipient_grant_id'::uuid,
    :'recipient_grant_revision'::bigint,
    :'recipient_principal_id',
    :'recipient_verified_email',
    :'recipient_organization_id',
    :'recipient_job_id',
    :'recipient_report_version_id',
    'building',
    'read_report'
  ) ->> 'status') = 'active',
  'current grant, module and action are authorised from shared state'
);

select
  result ->> 'invitationId' as share_id
from public.command_recipient_demo_record_share(
  :'recipient_grant_id'::uuid,
  :'recipient_grant_revision'::bigint,
  :'recipient_principal_id',
  :'recipient_verified_email',
  :'recipient_organization_id',
  :'recipient_job_id',
  :'recipient_report_version_id',
  'buyer@example.com',
  statement_timestamp() + interval '30 minutes'
) result
\gset recipient_

select pg_temp.assert_true(
  (public.command_recipient_demo_revoke_share(
    :'recipient_grant_id'::uuid,
    :'recipient_grant_revision'::bigint,
    :'recipient_principal_id',
    :'recipient_verified_email',
    :'recipient_organization_id',
    :'recipient_job_id',
    :'recipient_report_version_id',
    :'recipient_share_id'::uuid
  ) ->> 'state') = 'revoked',
  'share revocation is appended against the exact current grant'
);

select public.command_recipient_demo_set_module_withdrawal('building', true);

do $test$
declare
  context recipient_test_context%rowtype;
begin
  select * into context from recipient_test_context;
  begin
    perform public.command_recipient_demo_record_contact(
      context.grant_id,
      context.grant_revision,
      context.principal_id,
      context.verified_email,
      context.organization_id,
      context.job_id,
      context.report_version_id,
      'finding_cracked_tiles',
      'building'
    );
    raise exception 'assertion failed: withdrawn-module contact was recorded';
  exception when insufficient_privilege then
    raise notice 'ok - contact mutation atomically rejects a withdrawn target module';
  end;
end;
$test$;

select pg_temp.assert_true(
  (public.command_recipient_demo_record_contact(
    :'recipient_grant_id'::uuid,
    :'recipient_grant_revision'::bigint,
    :'recipient_principal_id',
    :'recipient_verified_email',
    :'recipient_organization_id',
    :'recipient_job_id',
    :'recipient_report_version_id',
    'finding_garden_bed',
    'timber_pest'
  ) ->> 'state') = 'recorded',
  'remaining delivered module can record a scoped contact request'
);

select public.command_recipient_demo_set_module_withdrawal('timber_pest', true);

do $test$
declare
  context recipient_test_context%rowtype;
begin
  select * into context from recipient_test_context;
  begin
    perform public.command_recipient_demo_record_share(
      context.grant_id,
      context.grant_revision,
      context.principal_id,
      context.verified_email,
      context.organization_id,
      context.job_id,
      context.report_version_id,
      'blocked@example.com',
      statement_timestamp() + interval '30 minutes'
    );
    raise exception 'assertion failed: share with no active module was recorded';
  exception when insufficient_privilege then
    raise notice 'ok - share mutation atomically rejects a fully withdrawn report';
  end;
end;
$test$;

select public.command_recipient_demo_set_module_withdrawal('building', false);
select public.command_recipient_demo_set_module_withdrawal('timber_pest', false);

select pg_temp.assert_true(
  (public.command_recipient_demo_portal_state(
    :'recipient_grant_id'::uuid,
    :'recipient_grant_revision'::bigint,
    :'recipient_principal_id',
    :'recipient_verified_email',
    :'recipient_organization_id',
    :'recipient_job_id',
    :'recipient_report_version_id'
  ) ->> 'buildingWithdrawn')::boolean = false,
  'portal state is projected from the same locked grant and module authority'
);

select public.command_recipient_demo_revoke_grant(
  :'recipient_grant_id'::uuid,
  :'recipient_grant_revision'::bigint,
  :'recipient_principal_id',
  :'recipient_verified_email',
  :'recipient_organization_id',
  :'recipient_job_id',
  :'recipient_report_version_id'
);

do $test$
declare
  context recipient_test_context%rowtype;
begin
  select * into context from recipient_test_context;
  begin
    perform public.command_recipient_demo_authorise(
      context.grant_id,
      context.grant_revision,
      context.principal_id,
      context.verified_email,
      context.organization_id,
      context.job_id,
      context.report_version_id,
      'building',
      'read_report'
    );
    raise exception 'assertion failed: revoked grant remained authorised';
  exception when insufficient_privilege then
    raise notice 'ok - revocation invalidates the existing signed session immediately';
  end;
end;
$test$;

select pg_temp.assert_true(
  (select count(*) = 1 from public.recipient_demo_invitation_claims)
  and (select count(*) = 1 from public.recipient_demo_challenge_completions)
  and (select count(*) = 1 from public.recipient_demo_grants)
  and (select count(*) = 1 from public.recipient_demo_grant_revocations)
  and (select count(*) = 1 from public.recipient_demo_share_requests)
  and (select count(*) = 1 from public.recipient_demo_share_revocations)
  and (select count(*) = 1 from public.recipient_demo_contact_requests),
  'recipient continuity records are append-only and independently auditable'
);

rollback;
