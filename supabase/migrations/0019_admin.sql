-- Owner admin area: who runs quoteout, devices each login uses, AI use per person,
-- plan limits per company, and suspending a person or a company.

-- People who can open /admin. Only the service role reads this; no customer can see it.
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

-- Plan limits per company. Null means no limit.
alter table public.tenants
  add column if not exists ai_quota_month int,
  add column if not exists max_devices int,
  add column if not exists admin_note text,
  add column if not exists trial_ends_at timestamptz;
alter table public.tenants drop constraint if exists tenants_ai_quota_month_check;
alter table public.tenants add constraint tenants_ai_quota_month_check check (ai_quota_month is null or ai_quota_month >= 0);
alter table public.tenants drop constraint if exists tenants_max_devices_check;
alter table public.tenants add constraint tenants_max_devices_check check (max_devices is null or max_devices between 1 and 20);

-- Suspend one person without touching the rest of their company.
alter table public.memberships add column if not exists disabled_at timestamptz;

-- Each browser or phone a login is used on, and roughly where from.
create table if not exists public.user_devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  tenant_id       uuid references public.tenants on delete cascade,
  device_id       text not null,
  label           text,
  session_id      uuid,
  ip              text,
  city            text,
  region          text,
  country         text,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_session uuid,
  revoked_reason  text,
  unique (user_id, device_id)
);
create index if not exists user_devices_tenant_seen on public.user_devices (tenant_id, last_seen desc);
create index if not exists user_devices_user_seen on public.user_devices (user_id, last_seen desc);
alter table public.user_devices enable row level security;

-- Who used the AI, not just which company.
alter table public.usage_events add column if not exists user_id uuid;
create index if not exists usage_events_tenant_period on public.usage_events (tenant_id, period, kind);

-- Ends a person's sign-ins (all of them, or one session) so their refresh tokens stop working.
create or replace function public.admin_end_sessions(p_user uuid, p_session uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  delete from auth.sessions
   where user_id = p_user
     and (p_session is null or id = p_session);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.admin_end_sessions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_end_sessions(uuid, uuid) to service_role;
