-- Options, revisions, online acceptance, inclusions/exclusions, customers, error alerts,
-- support requests, closing an account, bitumen index, and draft notifications.

-- Options (A, B...) share a quote number and a group; revisions (Rev A = 0, Rev B = 1...) keep the old versions.
alter table public.site_quotes
  add column if not exists option_group   uuid,
  add column if not exists option_label   text check (option_label ~ '^[A-Z]$'),
  add column if not exists revision       integer not null default 0 check (revision between 0 and 25),
  add column if not exists superseded_at  timestamptz,
  add column if not exists inclusions     text[] not null default '{}',
  add column if not exists exclusions     text[] not null default '{}',
  add column if not exists show_map       boolean not null default true,
  add column if not exists accept_token   text unique,
  add column if not exists accepted_at    timestamptz,
  add column if not exists accepted_name  text,
  add column if not exists accepted_po    text,
  add column if not exists accepted_note  text,
  add column if not exists customer_id    uuid references public.customers on delete set null,
  add column if not exists bitumen        jsonb;

alter table public.site_quotes drop constraint if exists site_quotes_tenant_id_quote_no_key;
create unique index if not exists site_quotes_number_option_rev
  on public.site_quotes (tenant_id, quote_no, coalesce(option_label, ''), revision) where quote_no is not null;
create index if not exists site_quotes_group on public.site_quotes (tenant_id, option_group) where option_group is not null;

-- The customer list: estimators add to it as they quote.
alter table public.customers
  add column if not exists contact_name text,
  add column if not exists email        text,
  add column if not exists phone        text,
  add column if not exists address      text,
  add column if not exists notes        text,
  add column if not exists updated_at   timestamptz not null default now();
create unique index if not exists customers_name_once on public.customers (tenant_id, lower(name));
create policy "estimators write" on public.customers for all to authenticated
  using (public.has_role(tenant_id, array['admin', 'estimator']))
  with check (public.has_role(tenant_id, array['admin', 'estimator']));

-- Errors from the app, for quoteout staff only (no policies: service role only).
create table if not exists public.app_errors (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants on delete set null,
  user_id     uuid,
  where_from  text not null,
  message     text not null,
  digest      text,
  path        text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists app_errors_recent on public.app_errors (created_at desc);
alter table public.app_errors enable row level security;

-- Help requests sent from inside the app.
create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  user_id     uuid references auth.users on delete set null,
  email       text,
  topic       text not null,
  message     text not null,
  page        text,
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_at  timestamptz not null default now()
);
alter table public.support_requests enable row level security;
create policy "members read" on public.support_requests for select to authenticated using (public.is_member(tenant_id));

-- A company asking to close its account (done by quoteout staff after the notice period).
alter table public.tenants
  add column if not exists close_requested_at timestamptz,
  add column if not exists close_reason       text;

-- The monthly bitumen index ($ per tonne of binder), kept by quoteout staff, read by everyone.
create table if not exists public.bitumen_indexes (
  month       date primary key check (extract(day from month) = 1),
  value       numeric not null check (value > 0),
  source      text,
  updated_at  timestamptz not null default now()
);
alter table public.bitumen_indexes enable row level security;
create policy "anyone signed in reads" on public.bitumen_indexes for select to authenticated using (true);

alter table public.tenant_settings
  add column if not exists notify_drafts  boolean not null default true,
  add column if not exists binder_percent numeric not null default 5.5 check (binder_percent > 0 and binder_percent < 20);
