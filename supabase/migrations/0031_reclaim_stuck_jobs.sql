-- A job whose run was cut off (deploy, timeout) stays "running" forever. Pick it up again after 10 minutes.
create or replace function public.claim_next_job()
returns setof public.queue_jobs
language sql security definer set search_path = public as $$
  update public.queue_jobs q
     set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
   where q.id = (
     select id from public.queue_jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and locked_at < now() - interval '10 minutes')
      order by run_after, id
      for update skip locked
      limit 1
   )
  returning q.*;
$$;
revoke execute on function public.claim_next_job() from public, anon, authenticated;
