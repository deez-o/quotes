-- RFQs without an inbox connection: drag-in uploads and a per-customer forwarding address.

-- Where a job came from.
alter table public.jobs add column if not exists source text not null default 'inbox'
  check (source in ('inbox', 'forward', 'upload'));

-- Uploads and forwards are recorded as connections too, so every message has one.
alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('microsoft', 'google', 'xero', 'forwarding', 'upload'));

-- New worker job kinds.
alter table public.queue_jobs drop constraint if exists queue_jobs_kind_check;
alter table public.queue_jobs add constraint queue_jobs_kind_check
  check (kind in ('mail_notification', 'process_message', 'renew_watch', 'catch_up', 'draft_quote', 'process_upload', 'process_inbound'));

-- Each customer's forwarding address, e.g. demo-asphalt@in.<domain>.
create table if not exists public.inbound_addresses (
  local_part  text primary key check (local_part ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  tenant_id   uuid not null unique references public.tenants on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.inbound_addresses enable row level security;
create policy "members read" on public.inbound_addresses
  for select to authenticated using (public.is_member(tenant_id));

-- Estimators and admins can upload RFQ files straight to storage, but only into
-- <their tenant>/uploads/... The worker files them into the job afterwards.
create policy "members upload rfq files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-files'
    and (storage.foldername(name))[2] = 'uploads'
    and public.has_role(((storage.foldername(name))[1])::uuid, array['admin', 'estimator'])
  );
