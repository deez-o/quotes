-- Truck rounds a shift by distance from the plant (see src/lib/site/trucks.ts).
alter table public.tenant_settings add column if not exists cartage_rules jsonb;
