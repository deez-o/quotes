-- An RFQ (email job) drafted into an editable quote: the quote keeps a link to its job,
-- one quote per job, and remembers what the AI read so the estimator can see it.
alter table public.site_quotes
  add column if not exists job_id uuid references public.jobs on delete set null,
  add column if not exists rfq_summary jsonb;

create unique index if not exists site_quotes_one_per_job on public.site_quotes (tenant_id, job_id) where job_id is not null;

-- System-made quotes (from the worker) have no person behind them.
alter table public.site_quotes alter column created_by drop not null;
