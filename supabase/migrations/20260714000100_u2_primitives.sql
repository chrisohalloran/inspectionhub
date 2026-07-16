-- U2: shared primitives, tenant identity, and authorization helpers.
-- Migrations are deliberately additive and safe to re-run in an empty/reset database.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.u2_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$function$;

create or replace function public.u2_reject_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%s is append-only', tg_table_name);
end;
$function$;

create table if not exists public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  lifecycle_state text not null default 'active'
    check (lifecycle_state in ('active', 'offboarding', 'suspended', 'purged')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table if not exists public.actors (
  id uuid primary key default extensions.gen_random_uuid(),
  auth_user_id uuid unique,
  actor_kind text not null
    check (actor_kind in ('inspector', 'administrator', 'client', 'access_contact', 'report_recipient', 'system', 'provider')),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  mailbox_normalized text,
  disabled_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (mailbox_normalized is null or mailbox_normalized = lower(btrim(mailbox_normalized)))
);

create unique index if not exists actors_mailbox_normalized_idx
  on public.actors (mailbox_normalized)
  where mailbox_normalized is not null;

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references public.actors(id) on delete restrict,
  member_role text not null check (member_role in ('inspector', 'administrator', 'support', 'system')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'revoked')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, actor_id)
);

create index if not exists organization_members_actor_org_idx
  on public.organization_members (actor_id, organization_id)
  where status = 'active';

create or replace function public.request_actor_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select a.id
  from public.actors a
  where a.auth_user_id = auth.uid()
    and a.disabled_at is null
  limit 1
$function$;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.organization_members om
    join public.actors a on a.id = om.actor_id
    where om.organization_id = target_organization_id
      and om.actor_id = public.request_actor_id()
      and om.status = 'active'
      and a.disabled_at is null
  )
$function$;

create or replace function public.has_organization_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.organization_members om
    join public.actors a on a.id = om.actor_id
    where om.organization_id = target_organization_id
      and om.actor_id = public.request_actor_id()
      and om.status = 'active'
      and om.member_role = any (allowed_roles)
      and a.disabled_at is null
  )
$function$;

revoke all on function public.request_actor_id() from public;
revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, text[]) from public;
grant execute on function public.request_actor_id() to authenticated, service_role;
grant execute on function public.is_organization_member(uuid) to authenticated, service_role;
grant execute on function public.has_organization_role(uuid, text[]) to authenticated, service_role;

drop trigger if exists organizations_touch_updated_at on public.organizations;
create trigger organizations_touch_updated_at before update on public.organizations
for each row execute function public.u2_touch_updated_at();

drop trigger if exists actors_touch_updated_at on public.actors;
create trigger actors_touch_updated_at before update on public.actors
for each row execute function public.u2_touch_updated_at();

drop trigger if exists organization_members_touch_updated_at on public.organization_members;
create trigger organization_members_touch_updated_at before update on public.organization_members
for each row execute function public.u2_touch_updated_at();
