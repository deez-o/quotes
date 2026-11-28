-- ON CONFLICT (tenant_id, dedupe_key) can't use a partial index. A full unique index
-- behaves the same: NULL dedupe keys never clash with each other.
create unique index if not exists queue_jobs_dedupe_all on public.queue_jobs (tenant_id, dedupe_key);
drop index if exists public.queue_jobs_dedupe;
