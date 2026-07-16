-- Shared, transactional authority for the synthetic Build Week recipient
-- portal. These records are deliberately isolated from the real recipient
-- grant graph, but use the same service-only, append-only and fail-closed
-- patterns. No browser or authenticated Supabase client can call these
-- commands or write their backing tables directly.

begin;

create table public.recipient_demo_invitation_claims (
  invitation_digest text primary key check (invitation_digest ~ '^[A-Za-z0-9_-]{43}$'),
  challenge_id uuid not null unique default extensions.gen_random_uuid(),
  intended_email text not null check (intended_email = lower(intended_email) and length(intended_email) between 3 and 320),
  claimed_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '10 minutes',
  check (expires_at > claimed_at)
);

create table public.recipient_demo_challenge_completions (
  challenge_id uuid primary key references public.recipient_demo_invitation_claims(challenge_id) on delete restrict,
  completed_at timestamptz not null default statement_timestamp()
);

create table public.recipient_demo_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  challenge_id uuid not null unique references public.recipient_demo_invitation_claims(challenge_id) on delete restrict,
  principal_id text not null check (principal_id = 'principal_demo_recipient'),
  verified_email text not null check (verified_email = lower(verified_email)),
  organization_id text not null check (organization_id = 'org_demo'),
  job_id text not null check (job_id = 'job_demo_cracked_tile'),
  report_version_id text not null check (report_version_id = 'report_demo_v2'),
  permitted_modules text[] not null check (
    cardinality(permitted_modules) between 1 and 2
    and permitted_modules <@ array['building', 'timber_pest']::text[]
  ),
  permitted_actions text[] not null check (
    cardinality(permitted_actions) > 0
    and permitted_actions <@ array[
      'read_report', 'download_pdf', 'view_curated_media', 'view_history',
      'contact_inspector', 'invite_recipient'
    ]::text[]
  ),
  revision bigint not null default 1 check (revision = 1),
  issued_at timestamptz not null default date_trunc('milliseconds', statement_timestamp()),
  expires_at timestamptz not null default date_trunc('milliseconds', statement_timestamp()) + interval '1 hour',
  check (expires_at > issued_at)
);

create table public.recipient_demo_grant_revocations (
  grant_id uuid primary key references public.recipient_demo_grants(id) on delete restrict,
  safe_reason text not null check (length(btrim(safe_reason)) between 1 and 120),
  revoked_at timestamptz not null default statement_timestamp()
);

create table public.recipient_demo_module_events (
  id uuid primary key default extensions.gen_random_uuid(),
  report_version_id text not null check (report_version_id = 'report_demo_v2'),
  module_type text not null check (module_type in ('building', 'timber_pest')),
  state text not null check (state in ('withdrawn', 'restored')),
  recorded_at timestamptz not null default statement_timestamp()
);

create index recipient_demo_module_events_projection_idx
  on public.recipient_demo_module_events (report_version_id, module_type, recorded_at desc, id desc);

create table public.recipient_demo_share_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  grant_id uuid not null references public.recipient_demo_grants(id) on delete restrict,
  email text not null check (email = lower(email) and length(email) between 3 and 320),
  permitted_modules text[] not null check (
    cardinality(permitted_modules) between 1 and 2
    and permitted_modules <@ array['building', 'timber_pest']::text[]
  ),
  recorded_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > recorded_at)
);

create index recipient_demo_share_requests_grant_idx
  on public.recipient_demo_share_requests (grant_id, recorded_at desc);

create table public.recipient_demo_share_revocations (
  share_request_id uuid primary key references public.recipient_demo_share_requests(id) on delete restrict,
  grant_id uuid not null references public.recipient_demo_grants(id) on delete restrict,
  revoked_at timestamptz not null default statement_timestamp()
);

create table public.recipient_demo_contact_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  grant_id uuid not null references public.recipient_demo_grants(id) on delete restrict,
  finding_reference text check (finding_reference is null or length(finding_reference) between 1 and 120),
  module_type text check (module_type is null or module_type in ('building', 'timber_pest')),
  recorded_at timestamptz not null default statement_timestamp()
);

create index recipient_demo_contact_requests_grant_idx
  on public.recipient_demo_contact_requests (grant_id, recorded_at desc);

do $ddl$
declare
  table_name text;
begin
  foreach table_name in array array[
    'recipient_demo_invitation_claims',
    'recipient_demo_challenge_completions',
    'recipient_demo_grants',
    'recipient_demo_grant_revocations',
    'recipient_demo_module_events',
    'recipient_demo_share_requests',
    'recipient_demo_share_revocations',
    'recipient_demo_contact_requests'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to service_role', table_name);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.u2_reject_mutation()',
      table_name || '_reject_mutation', table_name
    );
  end loop;
end;
$ddl$;

create or replace function public.recipient_demo_module_is_withdrawn(target_module text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce((
    select event.state = 'withdrawn'
    from public.recipient_demo_module_events event
    where event.report_version_id = 'report_demo_v2'
      and event.module_type = target_module
    order by event.recorded_at desc, event.id desc
    limit 1
  ), false)
$function$;

create or replace function public.recipient_demo_grant_locked(
  target_grant_id uuid,
  target_grant_revision bigint,
  target_principal_id text,
  target_verified_email text,
  target_organization_id text,
  target_job_id text,
  target_report_version_id text
)
returns public.recipient_demo_grants
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  grant_row public.recipient_demo_grants%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('recipient-demo:report_demo_v2', 0));
  select * into grant_row
  from public.recipient_demo_grants grant_record
  where grant_record.id = target_grant_id
  for key share;
  if not found
     or exists (
       select 1 from public.recipient_demo_grant_revocations revocation
       where revocation.grant_id = grant_row.id
     )
     or grant_row.revision is distinct from target_grant_revision
     or grant_row.principal_id is distinct from target_principal_id
     or grant_row.verified_email is distinct from target_verified_email
     or grant_row.organization_id is distinct from target_organization_id
     or grant_row.job_id is distinct from target_job_id
     or grant_row.report_version_id is distinct from target_report_version_id
     or grant_row.expires_at <= statement_timestamp() then
    raise exception using errcode = '42501', message = 'recipient grant is unavailable';
  end if;
  return grant_row;
end;
$function$;

create or replace function public.recipient_demo_grant_json(
  grant_row public.recipient_demo_grants,
  target_status text default 'active'
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'grantId', grant_row.id,
    'principalId', grant_row.principal_id,
    'verifiedEmail', grant_row.verified_email,
    'organizationId', grant_row.organization_id,
    'jobId', grant_row.job_id,
    'reportVersionId', grant_row.report_version_id,
    'modules', grant_row.permitted_modules,
    'actions', grant_row.permitted_actions,
    'issuedAt', grant_row.issued_at,
    'expiresAt', grant_row.expires_at,
    'revision', grant_row.revision,
    'status', target_status
  )
$function$;

create or replace function public.command_recipient_demo_claim_invitation(
  target_invitation_digest text,
  target_intended_email text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  claim_row public.recipient_demo_invitation_claims%rowtype;
begin
  if target_invitation_digest !~ '^[A-Za-z0-9_-]{43}$'
     or target_intended_email is distinct from lower(target_intended_email)
     or target_intended_email <> 'recipient@example.com' then
    raise exception using errcode = '22023', message = 'recipient invitation is invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('recipient-demo:invitation:' || target_invitation_digest, 0));
  insert into public.recipient_demo_invitation_claims (
    invitation_digest, intended_email
  ) values (
    target_invitation_digest, target_intended_email
  ) returning * into claim_row;
  return jsonb_build_object(
    'challengeId', claim_row.challenge_id,
    'invitationDigest', claim_row.invitation_digest,
    'intendedEmail', claim_row.intended_email,
    'expiresAt', claim_row.expires_at
  );
exception when unique_violation then
  raise exception using errcode = '23505', message = 'recipient invitation is unavailable';
end;
$function$;

create or replace function public.command_recipient_demo_issue_grant(
  target_challenge_id uuid,
  target_invitation_digest text,
  target_intended_email text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  claim_row public.recipient_demo_invitation_claims%rowtype;
  grant_row public.recipient_demo_grants%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('recipient-demo:challenge:' || target_challenge_id::text, 0));
  select * into claim_row
  from public.recipient_demo_invitation_claims claim
  where claim.challenge_id = target_challenge_id
  for key share;
  if not found
     or claim_row.invitation_digest is distinct from target_invitation_digest
     or claim_row.intended_email is distinct from target_intended_email
     or claim_row.expires_at <= statement_timestamp()
     or exists (
       select 1 from public.recipient_demo_challenge_completions completion
       where completion.challenge_id = target_challenge_id
     ) then
    raise exception using errcode = '42501', message = 'recipient challenge is unavailable';
  end if;
  insert into public.recipient_demo_challenge_completions (challenge_id)
  values (target_challenge_id);
  insert into public.recipient_demo_grants (
    challenge_id, principal_id, verified_email, organization_id, job_id,
    report_version_id, permitted_modules, permitted_actions
  ) values (
    target_challenge_id, 'principal_demo_recipient', claim_row.intended_email,
    'org_demo', 'job_demo_cracked_tile', 'report_demo_v2',
    array['building', 'timber_pest']::text[],
    array[
      'read_report', 'download_pdf', 'view_curated_media', 'view_history',
      'contact_inspector', 'invite_recipient'
    ]::text[]
  ) returning * into grant_row;
  return public.recipient_demo_grant_json(grant_row);
end;
$function$;

create or replace function public.command_recipient_demo_authorise(
  target_grant_id uuid,
  target_grant_revision bigint,
  target_principal_id text,
  target_verified_email text,
  target_organization_id text,
  target_job_id text,
  target_report_version_id text,
  target_module text,
  target_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  grant_row public.recipient_demo_grants%rowtype;
begin
  grant_row := public.recipient_demo_grant_locked(
    target_grant_id, target_grant_revision, target_principal_id,
    target_verified_email, target_organization_id, target_job_id,
    target_report_version_id
  );
  if not target_module = any(grant_row.permitted_modules)
     or not target_action = any(grant_row.permitted_actions)
     or public.recipient_demo_module_is_withdrawn(target_module) then
    raise exception using errcode = '42501', message = 'recipient capability is unavailable';
  end if;
  return public.recipient_demo_grant_json(grant_row);
end;
$function$;

create or replace function public.command_recipient_demo_portal_state(
  target_grant_id uuid,
  target_grant_revision bigint,
  target_principal_id text,
  target_verified_email text,
  target_organization_id text,
  target_job_id text,
  target_report_version_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  grant_row public.recipient_demo_grants%rowtype;
begin
  grant_row := public.recipient_demo_grant_locked(
    target_grant_id, target_grant_revision, target_principal_id,
    target_verified_email, target_organization_id, target_job_id,
    target_report_version_id
  );
  if not 'read_report' = any(grant_row.permitted_actions)
     or not 'timber_pest' = any(grant_row.permitted_modules)
     or public.recipient_demo_module_is_withdrawn('timber_pest') then
    raise exception using errcode = '42501', message = 'recipient portal is unavailable';
  end if;
  return jsonb_build_object(
    'buildingWithdrawn', public.recipient_demo_module_is_withdrawn('building'),
    'shareInvitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'invitationId', share.id,
        'grantId', share.grant_id,
        'email', share.email,
        'recordedAt', share.recorded_at,
        'expiresAt', share.expires_at,
        'state', case
          when revocation.share_request_id is not null then 'revoked'
          when share.expires_at <= statement_timestamp() then 'expired'
          else 'recorded'
        end
      ) order by share.recorded_at desc)
      from public.recipient_demo_share_requests share
      left join public.recipient_demo_share_revocations revocation
        on revocation.share_request_id = share.id
      where share.grant_id = grant_row.id
    ), '[]'::jsonb),
    'contactRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contactRequestId', contact.id,
        'grantId', contact.grant_id,
        'findingReference', contact.finding_reference,
        'recordedAt', contact.recorded_at,
        'state', 'recorded'
      ) order by contact.recorded_at desc)
      from public.recipient_demo_contact_requests contact
      where contact.grant_id = grant_row.id
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.command_recipient_demo_revoke_grant(
  target_grant_id uuid,
  target_grant_revision bigint,
  target_principal_id text,
  target_verified_email text,
  target_organization_id text,
  target_job_id text,
  target_report_version_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  grant_row public.recipient_demo_grants%rowtype;
begin
  grant_row := public.recipient_demo_grant_locked(
    target_grant_id, target_grant_revision, target_principal_id,
    target_verified_email, target_organization_id, target_job_id,
    target_report_version_id
  );
  insert into public.recipient_demo_grant_revocations (grant_id, safe_reason)
  values (grant_row.id, 'recipient_session_ended');
  return jsonb_build_object('revoked', true);
end;
$function$;

create or replace function public.command_recipient_demo_record_share(
  target_grant_id uuid,
  target_grant_revision bigint,
  target_principal_id text,
  target_verified_email text,
  target_organization_id text,
  target_job_id text,
  target_report_version_id text,
  target_email text,
  target_share_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  grant_row public.recipient_demo_grants%rowtype;
  share_row public.recipient_demo_share_requests%rowtype;
  active_modules text[];
begin
  grant_row := public.recipient_demo_grant_locked(
    target_grant_id, target_grant_revision, target_principal_id,
    target_verified_email, target_organization_id, target_job_id,
    target_report_version_id
  );
  select array_agg(module_type order by module_type) into active_modules
  from unnest(grant_row.permitted_modules) module_type
  where not public.recipient_demo_module_is_withdrawn(module_type);
  if not 'invite_recipient' = any(grant_row.permitted_actions)
     or coalesce(cardinality(active_modules), 0) = 0
     or target_email is distinct from lower(target_email)
     or length(target_email) not between 3 and 320
     or target_share_expires_at <= statement_timestamp()
     or target_share_expires_at > grant_row.expires_at then
    raise exception using errcode = '42501', message = 'recipient share request is unavailable';
  end if;
  insert into public.recipient_demo_share_requests (
    grant_id, email, permitted_modules, expires_at
  ) values (
    grant_row.id, target_email, active_modules, target_share_expires_at
  ) returning * into share_row;
  return jsonb_build_object(
    'invitationId', share_row.id,
    'grantId', share_row.grant_id,
    'email', share_row.email,
    'recordedAt', share_row.recorded_at,
    'expiresAt', share_row.expires_at,
    'state', 'recorded'
  );
end;
$function$;

create or replace function public.command_recipient_demo_revoke_share(
  target_grant_id uuid,
  target_grant_revision bigint,
  target_principal_id text,
  target_verified_email text,
  target_organization_id text,
  target_job_id text,
  target_report_version_id text,
  target_invitation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  grant_row public.recipient_demo_grants%rowtype;
  share_row public.recipient_demo_share_requests%rowtype;
begin
  grant_row := public.recipient_demo_grant_locked(
    target_grant_id, target_grant_revision, target_principal_id,
    target_verified_email, target_organization_id, target_job_id,
    target_report_version_id
  );
  if not 'invite_recipient' = any(grant_row.permitted_actions) then
    raise exception using errcode = '42501', message = 'recipient share request is unavailable';
  end if;
  select * into share_row
  from public.recipient_demo_share_requests share
  where share.id = target_invitation_id
    and share.grant_id = grant_row.id
  for key share;
  if not found
     or share_row.expires_at <= statement_timestamp()
     or exists (
       select 1 from public.recipient_demo_share_revocations revocation
       where revocation.share_request_id = share_row.id
     ) then
    raise exception using errcode = '42501', message = 'recipient share request is unavailable';
  end if;
  insert into public.recipient_demo_share_revocations (share_request_id, grant_id)
  values (share_row.id, grant_row.id);
  return jsonb_build_object(
    'invitationId', share_row.id,
    'grantId', share_row.grant_id,
    'email', share_row.email,
    'recordedAt', share_row.recorded_at,
    'expiresAt', share_row.expires_at,
    'state', 'revoked'
  );
end;
$function$;

create or replace function public.command_recipient_demo_record_contact(
  target_grant_id uuid,
  target_grant_revision bigint,
  target_principal_id text,
  target_verified_email text,
  target_organization_id text,
  target_job_id text,
  target_report_version_id text,
  target_finding_reference text,
  target_module text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  grant_row public.recipient_demo_grants%rowtype;
  contact_row public.recipient_demo_contact_requests%rowtype;
  active_module_exists boolean;
begin
  grant_row := public.recipient_demo_grant_locked(
    target_grant_id, target_grant_revision, target_principal_id,
    target_verified_email, target_organization_id, target_job_id,
    target_report_version_id
  );
  active_module_exists := case
    when target_module is null then exists (
      select 1 from unnest(grant_row.permitted_modules) module_type
      where not public.recipient_demo_module_is_withdrawn(module_type)
    )
    else target_module = any(grant_row.permitted_modules)
      and not public.recipient_demo_module_is_withdrawn(target_module)
  end;
  if not 'contact_inspector' = any(grant_row.permitted_actions)
     or not active_module_exists
     or target_module is not null and target_module not in ('building', 'timber_pest')
     or target_finding_reference is not null
        and length(target_finding_reference) not between 1 and 120 then
    raise exception using errcode = '42501', message = 'recipient contact request is unavailable';
  end if;
  insert into public.recipient_demo_contact_requests (
    grant_id, finding_reference, module_type
  ) values (
    grant_row.id, target_finding_reference, target_module
  ) returning * into contact_row;
  return jsonb_build_object(
    'contactRequestId', contact_row.id,
    'grantId', contact_row.grant_id,
    'findingReference', contact_row.finding_reference,
    'recordedAt', contact_row.recorded_at,
    'state', 'recorded'
  );
end;
$function$;

create or replace function public.command_recipient_demo_set_module_withdrawal(
  target_module text,
  target_withdrawn boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
begin
  if target_module not in ('building', 'timber_pest') then
    raise exception using errcode = '22023', message = 'recipient demo module is invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('recipient-demo:report_demo_v2', 0));
  insert into public.recipient_demo_module_events (
    report_version_id, module_type, state
  ) values (
    'report_demo_v2', target_module,
    case when target_withdrawn then 'withdrawn' else 'restored' end
  );
  return jsonb_build_object('recorded', true);
end;
$function$;

do $privileges$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.recipient_demo_module_is_withdrawn(text)',
    'public.recipient_demo_grant_locked(uuid,bigint,text,text,text,text,text)',
    'public.recipient_demo_grant_json(public.recipient_demo_grants,text)',
    'public.command_recipient_demo_claim_invitation(text,text)',
    'public.command_recipient_demo_issue_grant(uuid,text,text)',
    'public.command_recipient_demo_authorise(uuid,bigint,text,text,text,text,text,text,text)',
    'public.command_recipient_demo_portal_state(uuid,bigint,text,text,text,text,text)',
    'public.command_recipient_demo_revoke_grant(uuid,bigint,text,text,text,text,text)',
    'public.command_recipient_demo_record_share(uuid,bigint,text,text,text,text,text,text,timestamptz)',
    'public.command_recipient_demo_revoke_share(uuid,bigint,text,text,text,text,text,uuid)',
    'public.command_recipient_demo_record_contact(uuid,bigint,text,text,text,text,text,text,text)',
    'public.command_recipient_demo_set_module_withdrawal(text,boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
  end loop;
  foreach function_signature in array array[
    'public.command_recipient_demo_claim_invitation(text,text)',
    'public.command_recipient_demo_issue_grant(uuid,text,text)',
    'public.command_recipient_demo_authorise(uuid,bigint,text,text,text,text,text,text,text)',
    'public.command_recipient_demo_portal_state(uuid,bigint,text,text,text,text,text)',
    'public.command_recipient_demo_revoke_grant(uuid,bigint,text,text,text,text,text)',
    'public.command_recipient_demo_record_share(uuid,bigint,text,text,text,text,text,text,timestamptz)',
    'public.command_recipient_demo_revoke_share(uuid,bigint,text,text,text,text,text,uuid)',
    'public.command_recipient_demo_record_contact(uuid,bigint,text,text,text,text,text,text,text)',
    'public.command_recipient_demo_set_module_withdrawal(text,boolean)'
  ] loop
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$privileges$;

commit;
