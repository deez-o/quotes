-- The every-minute worker timer runs inside Supabase (pg_cron + pg_net, see supabase/ops/worker_timer.sql)
-- because Vercel's Hobby plan only allows daily cron jobs. The timer signs its call with a random token
-- kept in Supabase Vault; the app checks it with this function (service role only).
create or replace function public.check_worker_token(t text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected text;
begin
  if t is null or length(t) < 32 then
    return false;
  end if;
  select decrypted_secret into expected from vault.decrypted_secrets where name = 'worker_cron_token' limit 1;
  return expected is not null and expected = t;
end;
$$;

revoke all on function public.check_worker_token(text) from public, anon, authenticated;
grant execute on function public.check_worker_token(text) to service_role;
