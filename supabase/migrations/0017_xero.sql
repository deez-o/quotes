-- A quote sent to Xero (as a draft): remember which Xero quote it is, so sending again updates it.
alter table public.site_quotes
  add column if not exists xero_quote_id text,
  add column if not exists xero_quote_number text,
  add column if not exists xero_sent_at timestamptz;
