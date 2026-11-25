-- QUOTES platform: initial schema (milestone M0)
--
-- Every customer is a "tenant". Every table that holds customer data has a
-- tenant_id column and Row Level Security (RLS), so a signed-in user can only
-- ever see rows for tenants they are a member of. The background worker uses
-- the service role key, which bypasses RLS, and must always filter by tenant.
--
-- Every module-aware table also carries a `module` column (quoting,
-- inbox_sorting, ...) so new tasks plug into the same tables later.

-- gen_random_uuid() is built into Postgres 13+, no extension needed.

-------------------------------------------------------------------------------
-- Platform tables (not per tenant)
-------------------------------------------------------------------------------

create table public.modules (
  id          text primary key,              -- 'quoting', 'inbox_sorting', ...
  name        text not null,
  description text not null,
  available   boolean not null default true  -- false = coming soon
);

create table public.platform_admins (
  user_id uuid primary key references auth.users on delete cascade
);

-- The starter pack: rules every new tenant starts with (managed by Dan).
create table public.starter_rules (
  id         uuid primary key default gen_random_uuid(),
  module     text not null references public.modules,
  code       text not null,                  -- 'S1', 'S2', ...
  text       text not null,
  always_on  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (module, code)
);

-------------------------------------------------------------------------------
-- Tenants and people
-------------------------------------------------------------------------------

create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  abn           text,
  plan          text not null default 'pilot',
  time_zone     text not null default 'Australia/Brisbane',
  depots        jsonb not null default '[]',   -- [{name, address, lat, lng}]
  file_storage  text not null default 'app'
                check (file_storage in ('app', 'onedrive', 'sharepoint', 'google_drive')),
  status        text not null default 'setup'
                check (status in ('setup', 'live', 'paused')),
  next_quote_no integer not null default 1,
  created_at    timestamptz not null default now()
);

create table public.memberships (
  tenant_id  uuid not null references public.tenants on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       text not null check (role in ('admin', 'estimator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.tenant_modules (
  tenant_id  uuid not null references public.tenants on delete cascade,
  module     text not null references public.modules,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module)
);

-------------------------------------------------------------------------------
-- Access helpers (used by every policy)
-------------------------------------------------------------------------------

create or replace function public.is_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_role(t uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-------------------------------------------------------------------------------
-- Connections (mailbox, drives, accounting). Tokens live in a separate table
-- that signed-in users can never read; only the worker (service role) can.
-------------------------------------------------------------------------------

create table public.connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants on delete cascade,
  provider      text not null check (provider in ('microsoft', 'google', 'xero', 'forwarding')),
  purpose       text not null check (purpose in ('mailbox', 'files', 'accounting')),
  account_email text,
  scopes        text[] not null default '{}',
  status        text not null default 'pending'
                check (status in ('pending', 'ok', 'error', 'disconnected')),
  last_ok_at    timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

create table public.connection_secrets (
  connection_id     uuid primary key references public.connections on delete cascade,
  tenant_id         uuid not null references public.tenants on delete cascade,
  token_ciphertext  text not null,     -- encrypted with the tenant's key
  expires_at        timestamptz,
  updated_at        timestamptz not null default now()
);

create table public.mail_watches (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants on delete cascade,
  connection_id   uuid not null references public.connections on delete cascade,
  subscription_id text,
  cursor          text,               -- Gmail historyId or Graph delta link
  expires_at      timestamptz,
  updated_at      timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- Work: emails, jobs, files
-------------------------------------------------------------------------------

create table public.customers (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants on delete cascade,
  name                  text not null,
  aliases               text[] not null default '{}',
  email_domains         text[] not null default '{}',
  abn                   text,
  accounting_contact_id text,
  created_at            timestamptz not null default now()
);

create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants on delete cascade,
  module        text not null default 'quoting' references public.modules,
  quote_no      text,
  customer_id   uuid references public.customers on delete set null,
  customer_name text,
  site          text,
  job_type      text,
  status        text not null default 'new'
                check (status in ('new', 'processing', 'drafted', 'needs_attention',
                                  'approved', 'sent', 'won', 'lost', 'filed')),
  confidence    text check (confidence in ('high', 'medium', 'low')),
  flag_count    integer not null default 0,
  due_at        timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, quote_no)
);

create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants on delete cascade,
  connection_id       uuid references public.connections on delete set null,
  provider_message_id text not null,
  thread_id           text,
  from_address        text,
  subject             text,
  received_at         timestamptz,
  content_hash        text,            -- sender + subject + attachment hashes
  category            text,            -- set by inbox sorting: rfq, award, invoice, general, junk...
  module              text references public.modules,
  job_id              uuid references public.jobs on delete set null,
  created_at          timestamptz not null default now(),
  unique (connection_id, provider_message_id)   -- dedupe: an email is processed once
);

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants on delete cascade,
  job_id       uuid not null references public.jobs on delete cascade,
  message_id   uuid references public.messages on delete set null,
  filename     text not null,
  mime         text,
  size_bytes   bigint,
  sha256       text,
  kind         text check (kind in ('boq', 'drawing', 'spec', 'rfq_letter', 'photo', 'signature', 'other')),
  folder       text,                  -- '1. RFQ-Specs', '2. BOQ', ...
  storage_path text not null,         -- always starts with the tenant id
  pages        integer,
  read_ok      boolean,
  created_at   timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- What the customer teaches: catalogue, rates, rules, examples
-------------------------------------------------------------------------------

create table public.catalogue_products (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants on delete cascade,
  code                 text not null,
  name                 text not null,
  operation            text not null check (operation in ('asphalt', 'prime', 'primer_seal', 'spray_seal', 'tack', 'profiling', 'other')),
  density_t_per_m3     numeric,
  unit                 text not null default 'm2',
  aliases              text[] not null default '{}',
  accounting_item_code text,
  active               boolean not null default true,
  unique (tenant_id, code)
);

create table public.rates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants on delete cascade,
  kind       text not null check (kind in ('crew', 'production', 'establishment', 'markup', 'other')),
  key        text not null,            -- e.g. 'crew_under_60min', 'production_carpark_islands'
  value      numeric not null,
  unit       text not null,            -- 'AUD/shift', 'm2/shift', 'count', '%'
  notes      text,
  valid_from date not null default current_date,
  unique (tenant_id, kind, key, valid_from)
);

create table public.rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  module      text not null default 'quoting' references public.modules,
  code        text not null,            -- 'R1', 'R2', ...
  text        text not null,            -- plain English, as the customer wrote it
  status      text not null default 'active'
              check (status in ('proposed', 'active', 'off', 'rejected')),
  source      text not null default 'manual'
              check (source in ('starter', 'manual', 'learned', 'imported')),
  always_on   boolean not null default false,
  version     integer not null default 1,
  why         text,                     -- for learned rules: the jobs it came from
  approved_by uuid references auth.users,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, module, code, version)
);

create table public.examples (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants on delete cascade,
  module        text not null default 'quoting' references public.modules,
  title         text not null,           -- 'Carpark with islands'
  tags          text[] not null default '{}',
  rfq_text      text,
  approved_json jsonb,
  job_id        uuid references public.jobs on delete set null,
  created_at    timestamptz not null default now()
);

create table public.workbook_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants on delete cascade,
  filename     text not null,
  storage_path text not null,
  cell_map     jsonb not null default '{}',
  version      integer not null default 1,
  created_at   timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- AI runs, drafts, corrections
-------------------------------------------------------------------------------

create table public.ai_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants on delete cascade,
  module         text not null references public.modules,
  job_id         uuid references public.jobs on delete set null,
  provider       text not null,
  model          text not null,
  prompt_version text not null,
  rules_version  jsonb,                  -- which rule versions were in the prompt
  input_tokens   integer,
  cached_tokens  integer,
  output_tokens  integer,
  cost_usd       numeric(10, 5),
  latency_ms     integer,
  valid          boolean,
  error          text,
  raw_json       jsonb,
  created_at     timestamptz not null default now()
);

create table public.quote_drafts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants on delete cascade,
  job_id     uuid not null references public.jobs on delete cascade,
  version    integer not null default 1,
  ai_run_id  uuid references public.ai_runs on delete set null,
  answer     jsonb not null,             -- the validated rfq_quote_answer v1.0
  flags      jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (job_id, version)
);

create table public.corrections (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants on delete cascade,
  job_id     uuid not null references public.jobs on delete cascade,
  field      text not null,
  before     jsonb,
  after      jsonb,
  reason     text,
  user_id    uuid references auth.users,
  created_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- Usage and audit
-------------------------------------------------------------------------------

create table public.usage_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants on delete cascade,
  module     text not null references public.modules,
  kind       text not null,              -- 'email_sorted', 'rfq_drafted', 'ai_tokens', 'drawing_measured'
  qty        numeric not null default 1,
  cost_usd   numeric(10, 5),
  period     text not null default to_char(now(), 'YYYY-MM'),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid references public.tenants on delete cascade,
  actor      uuid,
  action     text not null,
  target     text,
  detail     jsonb,
  ip         inet,
  at         timestamptz not null default now()
);

-- The audit log is append-only.
create or replace function public.audit_log_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

-------------------------------------------------------------------------------
-- Quote numbers (called by the worker)
-------------------------------------------------------------------------------

create or replace function public.next_quote_number(t uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.tenants set next_quote_no = next_quote_no + 1
    where id = t returning next_quote_no - 1 into n;
  return 'Q-' || lpad(n::text, 4, '0');
end;
$$;
revoke execute on function public.next_quote_number(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------

alter table public.modules            enable row level security;
alter table public.platform_admins    enable row level security;
alter table public.starter_rules      enable row level security;
alter table public.tenants            enable row level security;
alter table public.memberships        enable row level security;
alter table public.tenant_modules     enable row level security;
alter table public.connections        enable row level security;
alter table public.connection_secrets enable row level security;  -- no policies: nobody but the worker
alter table public.mail_watches       enable row level security;  -- no policies: worker only
alter table public.customers          enable row level security;
alter table public.jobs               enable row level security;
alter table public.messages           enable row level security;
alter table public.attachments        enable row level security;
alter table public.catalogue_products enable row level security;
alter table public.rates              enable row level security;
alter table public.rules              enable row level security;
alter table public.examples           enable row level security;
alter table public.workbook_templates enable row level security;
alter table public.ai_runs            enable row level security;
alter table public.quote_drafts       enable row level security;
alter table public.corrections        enable row level security;
alter table public.usage_events       enable row level security;
alter table public.audit_log          enable row level security;

-- Platform tables
create policy "modules readable by signed-in users" on public.modules
  for select to authenticated using (true);
create policy "starter rules readable by platform admin" on public.starter_rules
  for select to authenticated using (public.is_platform_admin());
create policy "platform admin sees own row" on public.platform_admins
  for select to authenticated using (user_id = auth.uid());

-- Tenants and memberships
create policy "members read their tenant" on public.tenants
  for select to authenticated using (public.is_member(id));
create policy "admins update their tenant" on public.tenants
  for update to authenticated using (public.has_role(id, array['admin']))
  with check (public.has_role(id, array['admin']));
create policy "members read memberships of their tenant" on public.memberships
  for select to authenticated using (public.is_member(tenant_id));

-- Every tenant table: members can read
do $$
declare t text;
begin
  foreach t in array array[
    'tenant_modules', 'connections', 'customers', 'jobs', 'messages', 'attachments',
    'catalogue_products', 'rates', 'rules', 'examples', 'workbook_templates',
    'ai_runs', 'quote_drafts', 'corrections', 'usage_events'
  ] loop
    execute format(
      'create policy "members read" on public.%I for select to authenticated using (public.is_member(tenant_id))', t);
  end loop;
end $$;

-- Admin-only writes: setup and teaching
do $$
declare t text;
begin
  foreach t in array array[
    'tenant_modules', 'catalogue_products', 'rates', 'rules', 'examples', 'workbook_templates', 'customers'
  ] loop
    execute format(
      'create policy "admins write" on public.%I for all to authenticated
         using (public.has_role(tenant_id, array[''admin'']))
         with check (public.has_role(tenant_id, array[''admin'']))', t);
  end loop;
end $$;

-- Estimators can propose rules (status must be proposed); admins approve.
create policy "estimators propose rules" on public.rules
  for insert to authenticated
  with check (public.has_role(tenant_id, array['estimator']) and status = 'proposed');

-- Estimators and admins work on jobs and record corrections
create policy "estimators update jobs" on public.jobs
  for update to authenticated
  using (public.has_role(tenant_id, array['admin', 'estimator']))
  with check (public.has_role(tenant_id, array['admin', 'estimator']));
create policy "estimators add corrections" on public.corrections
  for insert to authenticated
  with check (public.has_role(tenant_id, array['admin', 'estimator']) and user_id = auth.uid());

-- Audit log: tenant admins can read their own tenant's entries
create policy "admins read audit" on public.audit_log
  for select to authenticated using (tenant_id is not null and public.has_role(tenant_id, array['admin']));

-------------------------------------------------------------------------------
-- File storage: one private bucket, every path starts with the tenant id
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('job-files', 'job-files', false)
on conflict (id) do nothing;

create policy "members read their tenant files" on storage.objects
  for select to authenticated
  using (bucket_id = 'job-files'
         and public.is_member(((storage.foldername(name))[1])::uuid));

-------------------------------------------------------------------------------
-- Modules catalogue
-------------------------------------------------------------------------------

insert into public.modules (id, name, description, available) values
  ('quoting',       'Quoting',                    'Reads RFQ emails, builds the job pack, fills the workbook and drafts the reply.', true),
  ('inbox_sorting', 'Inbox sorting',              'Sorts every email and sends a morning summary.', true),
  ('invoices',      'Supplier invoices',          'Files supplier invoices and pulls supplier, amount and due date.', false),
  ('followups',     'Quote follow-ups',           'Drafts a follow-up when a sent quote gets no reply.', false),
  ('awards',        'Awards and purchase orders', 'Spots won work and links it to the original quote.', false)
on conflict (id) do nothing;
