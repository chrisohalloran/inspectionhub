-- Keep the public Build Week recipient portal synthetic and bounded. The
-- report lock acquired by recipient_demo_grant_locked serializes both grant
-- and rolling report-window quota checks with inserts.

begin;

alter table public.rate_limit_buckets
  drop constraint rate_limit_buckets_policy_name_check,
  add constraint rate_limit_buckets_policy_name_check check (policy_name in (
    'recipient_access', 'recipient_demo_global', 'privileged_action',
    'provider_callback', 'booking_quote'
  ));

alter table public.recipient_demo_share_requests
  add constraint recipient_demo_share_requests_reserved_email_check
  check (email ~ '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]com$')
  not valid;

-- Migration 009 allowed any lowercase address. Preserve those append-only
-- audit rows, but quarantine their identity and exclude them from every
-- recipient-facing projection. The NOT VALID constraint still rejects every
-- new non-reserved address immediately.
create table public.recipient_demo_share_request_quarantines (
  share_request_id uuid primary key references public.recipient_demo_share_requests(id) on delete restrict,
  email_digest text not null check (email_digest ~ '^[a-f0-9]{64}$'),
  safe_reason text not null check (safe_reason = 'legacy_non_reserved_email'),
  quarantined_at timestamptz not null default statement_timestamp()
);

insert into public.recipient_demo_share_request_quarantines (
  share_request_id, email_digest, safe_reason
)
select
  share.id,
  encode(extensions.digest(share.email, 'sha256'), 'hex'),
  'legacy_non_reserved_email'
from public.recipient_demo_share_requests share
where share.email !~ '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]com$';

alter table public.recipient_demo_share_request_quarantines enable row level security;
alter table public.recipient_demo_share_request_quarantines force row level security;
revoke all on public.recipient_demo_share_request_quarantines
  from public, anon, authenticated, service_role;
grant select on public.recipient_demo_share_request_quarantines to service_role;
create trigger recipient_demo_share_request_quarantines_reject_mutation
  before update or delete on public.recipient_demo_share_request_quarantines
  for each row execute function public.u2_reject_mutation();

do $validation$
begin
  if not exists (
    select 1
    from public.recipient_demo_share_requests share
    where share.email !~ '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]com$'
  ) then
    alter table public.recipient_demo_share_requests
      validate constraint recipient_demo_share_requests_reserved_email_check;
  end if;
end;
$validation$;

create index recipient_demo_share_requests_report_window_idx
  on public.recipient_demo_share_requests (recorded_at desc, grant_id);
create index recipient_demo_contact_requests_report_window_idx
  on public.recipient_demo_contact_requests (recorded_at desc, grant_id);

create or replace function public.command_consume_rate_limit(
  target_policy_name text,
  target_opaque_key_sha256 text
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  policy_limit integer;
  current_count integer;
  attempt_time timestamptz := statement_timestamp();
  window_start timestamptz := date_trunc('minute', statement_timestamp());
  retry_seconds integer;
begin
  policy_limit := case target_policy_name
    when 'recipient_access' then 30
    when 'recipient_demo_global' then 300
    when 'privileged_action' then 10
    when 'provider_callback' then 120
    when 'booking_quote' then 20
    else null
  end;
  if policy_limit is null
     or target_opaque_key_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'invalid rate-limit policy or opaque identity digest';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(
    ':', target_policy_name, target_opaque_key_sha256, window_start::text
  ), 0));
  select coalesce(bucket.consumed_count, 0) into current_count
  from public.rate_limit_buckets bucket
  where bucket.policy_name = target_policy_name
    and bucket.opaque_key_sha256 = target_opaque_key_sha256
    and bucket.window_started_at = window_start;
  current_count := coalesce(current_count, 0);

  if current_count >= policy_limit then
    retry_seconds := greatest(
      1,
      ceil(extract(epoch from window_start + interval '1 minute' - attempt_time))::integer
    );
    return query select false, 0, retry_seconds;
    return;
  end if;

  insert into public.rate_limit_buckets (
    policy_name, opaque_key_sha256, window_started_at, consumed_count, updated_at
  ) values (
    target_policy_name, target_opaque_key_sha256, window_start,
    current_count + 1, attempt_time
  )
  on conflict (policy_name, opaque_key_sha256, window_started_at)
  do update set
    consumed_count = excluded.consumed_count,
    updated_at = excluded.updated_at;
  return query select true, policy_limit - current_count - 1, 0;
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
     or not exists (
       select 1
       from unnest(grant_row.permitted_modules) module_type
       where not public.recipient_demo_module_is_withdrawn(module_type)
     ) then
    raise exception using errcode = '42501', message = 'recipient portal is unavailable';
  end if;
  return jsonb_build_object(
    'buildingWithdrawn', public.recipient_demo_module_is_withdrawn('building'),
    'timberPestWithdrawn', public.recipient_demo_module_is_withdrawn('timber_pest'),
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
        and not exists (
          select 1
          from public.recipient_demo_share_request_quarantines quarantine
          where quarantine.share_request_id = share.id
        )
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
     or target_email !~ '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]com$'
     or target_share_expires_at <= statement_timestamp()
     or target_share_expires_at > grant_row.expires_at then
    raise exception using errcode = '42501', message = 'recipient share request is unavailable';
  end if;
  if (
       select count(*)
       from public.recipient_demo_share_requests share
       where share.grant_id = grant_row.id
     ) >= 5 then
    raise exception using errcode = 'P0001', message = 'grant_mutation_limit_reached';
  end if;
  if (
       select count(*)
       from public.recipient_demo_share_requests share
       join public.recipient_demo_grants report_grant
         on report_grant.id = share.grant_id
       where report_grant.report_version_id = grant_row.report_version_id
         and share.recorded_at >= statement_timestamp() - interval '1 hour'
     ) >= 25 then
    raise exception using errcode = 'P0001', message = 'report_mutation_window_reached';
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
  if (
       select count(*)
       from public.recipient_demo_contact_requests contact
       where contact.grant_id = grant_row.id
     ) >= 5 then
    raise exception using errcode = 'P0001', message = 'grant_mutation_limit_reached';
  end if;
  if (
       select count(*)
       from public.recipient_demo_contact_requests contact
       join public.recipient_demo_grants report_grant
         on report_grant.id = contact.grant_id
       where report_grant.report_version_id = grant_row.report_version_id
         and contact.recorded_at >= statement_timestamp() - interval '1 hour'
     ) >= 25 then
    raise exception using errcode = 'P0001', message = 'report_mutation_window_reached';
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

revoke all on function public.command_recipient_demo_record_share(
  uuid, bigint, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.command_recipient_demo_record_contact(
  uuid, bigint, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.command_recipient_demo_record_share(
  uuid, bigint, text, text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.command_recipient_demo_record_contact(
  uuid, bigint, text, text, text, text, text, text, text
) to service_role;

create or replace function public.recipient_demo_contract_version()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select 'recipient-demo-public-bounds-v2'::text
$function$;
revoke all on function public.recipient_demo_contract_version()
  from public, anon, authenticated;
grant execute on function public.recipient_demo_contract_version()
  to service_role;

commit;
