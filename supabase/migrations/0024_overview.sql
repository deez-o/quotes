-- The job overview for a quote: specs and dates pulled from the RFQ, and areas drawn on the map.
alter table public.site_quotes add column if not exists overview jsonb;
