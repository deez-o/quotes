-- Run once per environment (not a migration: needs pg_cron, pg_net and Vault, and the app's URL).
-- Makes a random token in Vault (nobody needs to see or copy it) and calls the worker every minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'worker_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'worker_cron_token', 'Signs the every-minute call to /api/cron/worker');
  end if;
end $$;

select cron.unschedule('quotes-worker') where exists (select 1 from cron.job where jobname = 'quotes-worker');
select cron.schedule('quotes-worker', '* * * * *', $job$
  select net.http_get(
    url := 'https://quoteout.app/api/cron/worker',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'worker_cron_token' limit 1)),
    timeout_milliseconds := 290000
  );
$job$);
