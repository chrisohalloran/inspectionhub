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
  if not 'read_report' = any(grant_row.permitted_actions) then
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
