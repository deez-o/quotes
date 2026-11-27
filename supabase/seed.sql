-- Demo Asphalt Co: made-up test data. No real customer, rate or quote.
-- Run after the migration (Supabase SQL editor, or `supabase db reset` locally).

insert into public.tenants (id, slug, name, abn, depots, file_storage, status)
values (
  '00000000-0000-4000-8000-000000000001',
  'demo-asphalt',
  'Demo Asphalt Co',
  '00 000 000 000',
  '[{"name": "Brendale depot", "address": "1 Demo St, Brendale QLD 4500"}]',
  'app',
  'setup'
) on conflict (id) do nothing;

insert into public.tenant_modules (tenant_id, module, enabled) values
  ('00000000-0000-4000-8000-000000000001', 'quoting', true),
  ('00000000-0000-4000-8000-000000000001', 'inbox_sorting', true)
on conflict do nothing;

-- Products (made up)
insert into public.catalogue_products (tenant_id, code, name, operation, density_t_per_m3, unit, aliases) values
  ('00000000-0000-4000-8000-000000000001', 'AC10',  'AC10 dense 10 mm',      'asphalt',     2.40, 'm2', '{"AC 10 mix","10mm asphalt"}'),
  ('00000000-0000-4000-8000-000000000001', 'AC14',  'AC14 dense 14 mm',      'asphalt',     2.40, 'm2', '{"AC15","hot mix","14mm asphalt"}'),
  ('00000000-0000-4000-8000-000000000001', 'AC20',  'AC20 dense 20 mm',      'asphalt',     2.40, 'm2', '{"20mm asphalt","base course"}'),
  ('00000000-0000-4000-8000-000000000001', 'PRIME', 'Prime',                 'prime',       null, 'm2', '{"sealer","prime coat"}'),
  ('00000000-0000-4000-8000-000000000001', 'PSEAL', 'Primer seal 7 mm',      'primer_seal', null, 'm2', '{"primerseal"}'),
  ('00000000-0000-4000-8000-000000000001', 'C170',  'Spray seal C170 14/7',  'spray_seal',  null, 'm2', '{"C170 seal","two coat seal"}'),
  ('00000000-0000-4000-8000-000000000001', 'TACK',  'Tack coat',             'tack',        null, 'm2', '{"bond coat"}')
on conflict do nothing;

-- Rates (made up; replaced by each customer's own)
insert into public.rates (tenant_id, kind, key, value, unit, notes) values
  ('00000000-0000-4000-8000-000000000001', 'crew',          'crew_under_60min',            1000, 'AUD/shift', 'Demo value only'),
  ('00000000-0000-4000-8000-000000000001', 'crew',          'crew_over_60min',             1200, 'AUD/shift', 'Demo value only'),
  ('00000000-0000-4000-8000-000000000001', 'production',    'production_open_carpark',     1500, 'm2/shift',  'Demo value only'),
  ('00000000-0000-4000-8000-000000000001', 'production',    'production_carpark_islands',   900, 'm2/shift',  'Demo value only'),
  ('00000000-0000-4000-8000-000000000001', 'production',    'production_road',             2000, 'm2/shift',  'Demo value only'),
  ('00000000-0000-4000-8000-000000000001', 'production',    'production_subdivision',      1800, 'm2/shift',  'Demo value only'),
  ('00000000-0000-4000-8000-000000000001', 'establishment', 'establishments_default',         2, 'count',     'Demo value only'),
  ('00000000-0000-4000-8000-000000000001', 'markup',        'spray_markup',                  10, '%',         'Demo value only')
on conflict do nothing;

-- Demo tenant's copy of the starter pack (the pack itself is in migration 0003)
insert into public.rules (tenant_id, module, code, grp, text, status, source, always_on)
select '00000000-0000-4000-8000-000000000001', module, replace(code, 'S', 'R'), grp, text, 'active', 'starter', always_on
from public.starter_rules
on conflict do nothing;

insert into public.tenant_settings (tenant_id, margin_mode, default_binder, default_prime, spray_markup_percent, extra_establishment_rate, info_request_signature)
values ('00000000-0000-4000-8000-000000000001', 'none', 'C320', 'PRIME', 10, 2500, 'Demo Asphalt Co Sales Team')
on conflict (tenant_id) do nothing;

insert into public.inbound_addresses (local_part, tenant_id)
values ('demo-asphalt', '00000000-0000-4000-8000-000000000001')
on conflict do nothing;

-- Costs library for talk-to-quote (made-up demo figures)
insert into public.cost_items (tenant_id, category, material_kind, name, unit, rate, density_t_per_m3, includes_delivery, truck_capacity_t) values
  ('00000000-0000-4000-8000-000000000001', 'crew',     null,      'Asphalt crew',               'shift', 9500, null, false, null),
  ('00000000-0000-4000-8000-000000000001', 'crew',     null,      'Spray crew',                 'shift', 4200, null, false, null),
  ('00000000-0000-4000-8000-000000000001', 'material', 'asphalt', 'AC10 asphalt',               't',     150,  2.4,  false, null),
  ('00000000-0000-4000-8000-000000000001', 'material', 'asphalt', 'AC14 asphalt',               't',     140,  2.4,  false, null),
  ('00000000-0000-4000-8000-000000000001', 'material', 'base',    'Crushed rock base',          't',     45,   2.2,  true,  null),
  ('00000000-0000-4000-8000-000000000001', 'material', 'prime',   'Prime',                      'm2',    1.8,  null, false, null),
  ('00000000-0000-4000-8000-000000000001', 'material', 'seal',    'Two coat seal C170',         'm2',    6.5,  null, false, null),
  ('00000000-0000-4000-8000-000000000001', 'plant',    null,      'Bobcat',                     'h',     120,  null, false, null),
  ('00000000-0000-4000-8000-000000000001', 'plant',    null,      'Profiler',                   'h',     450,  null, false, null),
  ('00000000-0000-4000-8000-000000000001', 'truck',    null,      'Truck and driver (12 t)',    'h',     140,  null, false, 12)
on conflict do nothing;

insert into public.supply_plants (tenant_id, name, address, lat, lng) values
  ('00000000-0000-4000-8000-000000000001', 'Narangba plant',  'Narangba QLD (demo)', -27.2016, 152.9621),
  ('00000000-0000-4000-8000-000000000001', 'Brendale quarry', 'Brendale QLD (demo)', -27.3240, 152.9830)
on conflict do nothing;

update public.tenant_settings set margin_percent = coalesce(margin_percent, 15),
  quote_terms = coalesce(quote_terms, 'Valid for 30 days. Price assumes clear access during normal working hours. Traffic management, line marking and kerbing excluded unless listed.')
where tenant_id = '00000000-0000-4000-8000-000000000001';

insert into public.customers (tenant_id, name, aliases, email_domains) values
  ('00000000-0000-4000-8000-000000000001', 'Bayside Developments', '{"Bayside Dev"}', '{"baysidedev.example"}'),
  ('00000000-0000-4000-8000-000000000001', 'Northpoint Civil',     '{}',             '{"northpointcivil.example"}'),
  ('00000000-0000-4000-8000-000000000001', 'Ridgeline Civil',      '{}',             '{"ridgeline.example"}');

-- Give yourself access: run once in the SQL editor after you first sign in,
-- replacing the email with your own.
--
--   insert into public.memberships (tenant_id, user_id, role)
--   select '00000000-0000-4000-8000-000000000001', id, 'admin'
--   from auth.users where email = 'you@example.com';
--
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'you@example.com';
