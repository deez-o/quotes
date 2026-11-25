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

-- Starter pack (platform level) and the demo tenant's copy of it
insert into public.starter_rules (module, code, text, always_on) values
  ('quoting', 'S1', 'Only use product codes from the customer''s product list. If nothing fits, leave the product empty and flag it.', false),
  ('quoting', 'S2', 'The BoQ beats the email. If they disagree, flag it.', false),
  ('quoting', 'S3', 'The latest customer email overrides the original RFQ.', false),
  ('quoting', 'S4', 'Plain "sealer" means prime, unless it says primer seal. Flag it.', false),
  ('quoting', 'S5', 'Anything marked by others, existing, or outside the works boundary goes in Not ours.', false),
  ('quoting', 'S6', 'Shifts = area divided by the production rate for the job type, rounded up, allowing the customer''s leeway before adding a shift.', false),
  ('quoting', 'S7', 'Pick the crew rate by job type and travel band only; never invent a rate.', false),
  ('quoting', 'S8', 'Never write a total, price or contribution. Write "calc in Excel".', true),
  ('quoting', 'S9', 'Quantities for pricing come from the RFQ. Drawing measurements are a check: flag differences over the tolerance.', false)
on conflict do nothing;

insert into public.rules (tenant_id, module, code, text, status, source, always_on)
select '00000000-0000-4000-8000-000000000001', module, replace(code, 'S', 'R'), text, 'active', 'starter', always_on
from public.starter_rules
on conflict do nothing;

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
