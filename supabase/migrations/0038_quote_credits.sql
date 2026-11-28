-- Quote top-ups: credits used once the month's plan allowance is gone. Each Stripe payment once.
alter table public.tenants add column if not exists quote_credits integer not null default 0 check (quote_credits >= 0);
create table if not exists public.quote_topups (
  session_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quotes integer not null check (quotes > 0),
  amount_aud numeric not null,
  created_at timestamptz not null default now()
);
alter table public.quote_topups enable row level security;
create policy quote_topups_read on public.quote_topups for select using (public.is_member(tenant_id));
create or replace function public.take_quote_credit(t uuid) returns boolean language sql security definer set search_path = public as $$
  with u as (update public.tenants set quote_credits = quote_credits - 1 where id = t and quote_credits > 0 returning 1)
  select exists (select 1 from u);
$$;
revoke all on function public.take_quote_credit(uuid) from public, anon, authenticated;
create or replace function public.add_quote_credits(t uuid, n integer, sid text, amount numeric) returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.quote_topups (session_id, tenant_id, quotes, amount_aud) values (sid, t, n, amount);
  update public.tenants set quote_credits = quote_credits + n where id = t;
  return true;
exception when unique_violation then
  return false;
end $$;
revoke all on function public.add_quote_credits(uuid, integer, text, numeric) from public, anon, authenticated;
