-- Where the company's yard or depot is: crew travel time to the job is worked out from here.
alter table public.tenant_settings add column if not exists base_lat numeric, add column if not exists base_lng numeric;
