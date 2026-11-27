-- A company's own quote spreadsheet: the uploaded file, where each part of a quote goes
-- (worked out by AI, checked by the company), and when they confirmed it.
alter table public.tenant_settings add column if not exists quote_sheet jsonb;
