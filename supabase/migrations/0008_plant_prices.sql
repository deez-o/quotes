-- Mix prices per supply plant: the same mix (e.g. "AC10 asphalt") can have a
-- different price at each plant. Items with no plant are general costs.

alter table public.supply_plants
  add column if not exists prices_valid_until date,      -- from the plant's price list
  add column if not exists prices_note        text,      -- e.g. "Price list 2026/27, uploaded 3 Dec"
  add column if not exists place_source       text check (place_source in ('google', 'osm', 'entered'));

-- Road distance and truck time from a site quote's location to each plant ({plant_id: {km, minutes, source}}).
alter table public.site_quotes add column if not exists haul_routes jsonb;

-- A plant's items must belong to the same customer: composite key, so a row can't point across tenants.
alter table public.supply_plants add constraint supply_plants_id_tenant_key unique (id, tenant_id);

alter table public.cost_items add column if not exists supply_plant_id uuid;
alter table public.cost_items
  add constraint cost_items_supply_plant_fk foreign key (supply_plant_id, tenant_id)
  references public.supply_plants (id, tenant_id) on delete set null (supply_plant_id);

-- Names are unique per plant (and among general costs), only among active items.
alter table public.cost_items drop constraint if exists cost_items_tenant_id_name_key;
create unique index if not exists cost_items_name_per_plant
  on public.cost_items (tenant_id, lower(name), coalesce(supply_plant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where active;
create index if not exists cost_items_plant_idx on public.cost_items (supply_plant_id) where supply_plant_id is not null;
