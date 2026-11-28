-- Binder extra-overs: plants price their mixes at a base binder (usually C320) plus $/t extra for others.
alter table public.supply_plants add column if not exists base_binder text not null default 'C320';

create table if not exists public.binder_extras (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  supply_plant_id uuid not null references public.supply_plants(id) on delete cascade,
  binder          text not null check (length(binder) between 1 and 40),
  extra_per_t     numeric(10,2) not null check (extra_per_t >= -1000 and extra_per_t <= 10000),
  updated_at      timestamptz not null default now(),
  unique (supply_plant_id, binder)
);
create index if not exists binder_extras_tenant on public.binder_extras (tenant_id);
alter table public.binder_extras enable row level security;
create policy "members read" on public.binder_extras for select to authenticated using (public.is_member(tenant_id));
create policy "admins write" on public.binder_extras for all to authenticated
  using (public.has_role(tenant_id, array['admin'])) with check (public.has_role(tenant_id, array['admin']));

-- Minimum hire: trucks, bobcats and crew charged for at least this many hours a day.
alter table public.cost_items add column if not exists min_hours numeric(6,2) check (min_hours is null or (min_hours > 0 and min_hours <= 24));
