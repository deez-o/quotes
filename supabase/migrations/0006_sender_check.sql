-- Forwarded RFQs are only accepted from the customer's own people (admins and estimators),
-- so a spammer who learns the forwarding address cannot create jobs. Worker/webhook only.
create or replace function public.is_sender_member(t uuid, sender text)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where m.tenant_id = t
       and lower(u.email) = lower(trim(sender))
       and m.role in ('admin', 'estimator')
  );
$$;
revoke execute on function public.is_sender_member(uuid, text) from public, anon, authenticated;
