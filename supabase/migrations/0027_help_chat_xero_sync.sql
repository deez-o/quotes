-- Checking Xero for quotes the customer accepted or declined there.
alter table public.queue_jobs drop constraint if exists queue_jobs_kind_check;
alter table public.queue_jobs add constraint queue_jobs_kind_check
  check (kind in ('mail_notification', 'process_message', 'renew_watch', 'catch_up', 'draft_quote', 'process_upload', 'process_inbound', 'xero_sync'));

-- The in-app help assistant: each person's conversations (they see their own; quoteout staff see all).
create table if not exists public.help_chats (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  email       text,
  messages    jsonb not null default '[]',
  escalated   boolean not null default false,
  page        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists help_chats_recent on public.help_chats (updated_at desc);
create index if not exists help_chats_user on public.help_chats (tenant_id, user_id, updated_at desc);
alter table public.help_chats enable row level security;
create policy "own chats" on public.help_chats for select to authenticated using (user_id = auth.uid() and public.is_member(tenant_id));

-- Where a quote's won/lost came from, and why it was lost.
alter table public.site_quotes add column if not exists outcome_note text;
