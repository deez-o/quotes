-- The worker may now run for up to 800 s (big RFQs with drawing pages): only reclaim a "running"
-- job after 15 minutes, and give up after 3 tries so one bad RFQ can't loop for ever.
create or replace function public.claim_next_job()
returns setof public.queue_jobs
language plpgsql security definer set search_path = public as $$
begin
  update public.queue_jobs
     set status = 'failed', last_error = coalesce(last_error, 'Stopped 3 times without finishing (too big or too slow to read).'), updated_at = now()
   where status = 'running' and locked_at < now() - interval '15 minutes' and attempts >= 3;
  return query
  update public.queue_jobs q
     set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
   where q.id = (
     select id from public.queue_jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and locked_at < now() - interval '15 minutes')
      order by run_after, id
      for update skip locked
      limit 1
   )
  returning q.*;
end $$;
revoke execute on function public.claim_next_job() from public, anon, authenticated;
