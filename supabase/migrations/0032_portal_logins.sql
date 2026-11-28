-- Tender portal logins (EstimateOne, Tenderlink...): stored like other connections, the password
-- encrypted in connection_secrets (service role only). Used to fetch tender documents automatically.
alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('microsoft', 'google', 'xero', 'forwarding', 'upload', 'estimateone', 'tenderlink', 'buildingconnected', 'procore', 'aconex'));
alter table public.connections drop constraint if exists connections_purpose_check;
alter table public.connections add constraint connections_purpose_check
  check (purpose in ('mailbox', 'files', 'accounting', 'portal'));

alter table public.queue_jobs drop constraint if exists queue_jobs_kind_check;
alter table public.queue_jobs add constraint queue_jobs_kind_check
  check (kind in ('mail_notification', 'process_message', 'renew_watch', 'catch_up', 'draft_quote', 'process_upload', 'process_inbound', 'xero_sync', 'portal_fetch'));

-- What happened when documents were fetched from a portal, shown on the quote.
alter table public.site_quotes add column if not exists portal_fetch jsonb;
