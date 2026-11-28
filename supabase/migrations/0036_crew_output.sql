-- How much a crew lays in a 10-hour day, by job type and haul, and how far over goes to 12-hour days.
alter table public.tenant_settings add column if not exists crew_output jsonb;
