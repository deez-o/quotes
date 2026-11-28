-- Business: send quotes from the company's own connected Outlook mailbox (kept in their Sent Items).
alter table public.tenant_settings add column if not exists send_from_mailbox boolean not null default false;
alter table public.quote_sends add column if not exists sent_via text not null default 'quoteout' check (sent_via in ('quoteout', 'mailbox'));
