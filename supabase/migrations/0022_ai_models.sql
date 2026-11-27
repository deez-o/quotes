-- Which AI model quoteout uses (picked in Admin), and side-by-side test runs of models on real RFQs.
create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.platform_settings enable row level security;

create table if not exists public.ai_trials (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null,
  tenant_id   uuid not null references public.tenants on delete cascade,
  job_id      uuid references public.jobs on delete cascade,
  model       text not null,
  scope       jsonb,
  total_ex_gst numeric,
  questions   int,
  cost_usd    numeric,
  latency_ms  int,
  error       text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists ai_trials_batch on public.ai_trials (batch_id);
create index if not exists ai_trials_recent on public.ai_trials (created_at desc);
alter table public.ai_trials enable row level security;
