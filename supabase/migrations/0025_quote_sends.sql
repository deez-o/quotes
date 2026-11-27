-- Quotes emailed to customers from inside the app: who it went to, when, and by whom.
create table if not exists public.quote_sends (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants on delete cascade,
  site_quote_id uuid not null references public.site_quotes on delete cascade,
  to_addresses  text[] not null,
  cc_addresses  text[] not null default '{}',
  subject       text not null,
  message       text not null,
  total_ex_gst  numeric,
  sent_by       uuid references auth.users on delete set null,
  sent_by_email text,
  provider_id   text,
  status        text not null default 'sent' check (status in ('sent', 'failed')),
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists quote_sends_quote on public.quote_sends (tenant_id, site_quote_id, created_at desc);
alter table public.quote_sends enable row level security;
-- Members can see the send history; only the server (service role) records sends.
create policy "members read" on public.quote_sends for select to authenticated using (public.is_member(tenant_id));

alter table public.site_quotes add column if not exists sent_at timestamptz;
-- The company's own wording for the email that goes with a quote.
alter table public.tenant_settings add column if not exists quote_email_message text;
