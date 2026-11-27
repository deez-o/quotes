-- Billing: each company's Stripe customer and subscription, and where its payments stand.
alter table public.tenants
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_status text not null default 'none',
  add column if not exists past_due_since timestamptz;

alter table public.tenants drop constraint if exists tenants_billing_status_check;
alter table public.tenants add constraint tenants_billing_status_check
  check (billing_status in ('none', 'pending', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'));

create unique index if not exists tenants_stripe_customer on public.tenants (stripe_customer_id) where stripe_customer_id is not null;

-- Stripe sends the same event more than once sometimes; handle each one once.
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
