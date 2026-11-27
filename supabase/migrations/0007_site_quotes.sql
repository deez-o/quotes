-- Talk-to-quote on site: the customer's costs library, supply plants, truck settings and saved site quotes.

create table public.cost_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants on delete cascade,
  category            text not null check (category in ('crew', 'material', 'plant', 'truck', 'other')),
  material_kind       text check (material_kind in ('asphalt', 'base', 'prime', 'seal', 'other')),
  name                text not null,
  unit                text not null check (unit in ('shift', 'day', 'h', 't', 'm2', 'm3', 'each', 'km')),
  rate                numeric not null check (rate >= 0),        -- AUD per unit, ex GST
  density_t_per_m3    numeric check (density_t_per_m3 > 0),     -- materials sold by the tonne but measured by volume
  includes_delivery   boolean not null default false,           -- supplier delivers: no trucks needed
  truck_capacity_t    numeric check (truck_capacity_t > 0),     -- for trucks
  notes               text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.supply_plants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  name        text not null,
  address     text,
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.tenant_settings
  add column if not exists truck_load_minutes   numeric not null default 15,
  add column if not exists truck_unload_minutes numeric not null default 10,
  add column if not exists shift_minutes        numeric not null default 480,
  add column if not exists road_factor          numeric not null default 1.3,   -- straight line to road distance
  add column if not exists average_speed_kmh    numeric not null default 60,
  add column if not exists gst_percent          numeric not null default 10,
  add column if not exists quote_terms          text;

create table public.site_quotes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants on delete cascade,
  quote_no        text,
  status          text not null default 'draft' check (status in ('draft', 'sent', 'won', 'lost')),
  title           text,
  customer_name   text,
  customer_email  text,
  site_address    text,
  site_lat        double precision,
  site_lng        double precision,
  transcript      text,
  photos          text[] not null default '{}',     -- storage paths, all under the tenant
  scope           jsonb not null default '{}',      -- what the AI heard, as edited by the user
  costing         jsonb not null default '{}',      -- last priced result (for the list and the printout)
  margin_percent  numeric not null default 15 check (margin_percent >= 0 and margin_percent < 95),
  total_ex_gst    numeric,
  created_by      uuid references auth.users,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, quote_no)
);

alter table public.cost_items    enable row level security;
alter table public.supply_plants enable row level security;
alter table public.site_quotes   enable row level security;

create policy "members read" on public.cost_items    for select to authenticated using (public.is_member(tenant_id));
create policy "members read" on public.supply_plants for select to authenticated using (public.is_member(tenant_id));
create policy "members read" on public.site_quotes   for select to authenticated using (public.is_member(tenant_id));

create policy "admins write" on public.cost_items for all to authenticated
  using (public.has_role(tenant_id, array['admin'])) with check (public.has_role(tenant_id, array['admin']));
create policy "admins write" on public.supply_plants for all to authenticated
  using (public.has_role(tenant_id, array['admin'])) with check (public.has_role(tenant_id, array['admin']));
create policy "estimators write" on public.site_quotes for all to authenticated
  using (public.has_role(tenant_id, array['admin', 'estimator']))
  with check (public.has_role(tenant_id, array['admin', 'estimator']));

-- Signed-in estimators and admins can take the next quote number for their own company.
create or replace function public.take_quote_number(t uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(t, array['admin', 'estimator']) then
    raise exception 'not allowed';
  end if;
  return public.next_quote_number(t);
end;
$$;
revoke execute on function public.take_quote_number(uuid) from public, anon;
grant execute on function public.take_quote_number(uuid) to authenticated;
