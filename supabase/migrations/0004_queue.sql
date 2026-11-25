-- Job queue (Postgres-backed). The webhook only records a notification and
-- queues a job; the worker does the heavy lifting, one job at a time per tenant.

create table public.queue_jobs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants on delete cascade,
  kind        text not null check (kind in ('mail_notification', 'process_message', 'renew_watch', 'catch_up', 'draft_quote')),
  payload     jsonb not null default '{}',
  dedupe_key  text,                       -- e.g. connection id + provider message id
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  attempts    integer not null default 0,
  run_after   timestamptz not null default now(),
  last_error  text,
  locked_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A notification for the same message twice does nothing.
create unique index queue_jobs_dedupe on public.queue_jobs (tenant_id, dedupe_key) where dedupe_key is not null;
create index queue_jobs_ready on public.queue_jobs (status, run_after);

-- Worker only: RLS on with no policies.
alter table public.queue_jobs enable row level security;
comment on table public.queue_jobs is 'Worker only. RLS on with no policies by design.';

-- Find the tenant for an incoming Microsoft notification quickly.
create unique index if not exists mail_watches_subscription on public.mail_watches (subscription_id) where subscription_id is not null;
create index if not exists messages_content_hash on public.messages (tenant_id, content_hash);

-- Claim the next ready job (skip locked rows so several workers can run safely).
create or replace function public.claim_next_job()
returns setof public.queue_jobs
language sql security definer set search_path = public as $$
  update public.queue_jobs q
     set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
   where q.id = (
     select id from public.queue_jobs
      where status = 'queued' and run_after <= now()
      order by run_after, id
      for update skip locked
      limit 1
   )
  returning q.*;
$$;
revoke execute on function public.claim_next_job() from public, anon, authenticated;
