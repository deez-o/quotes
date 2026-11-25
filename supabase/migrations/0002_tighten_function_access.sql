-- Access helpers: callable by signed-in users only (policies need them), never by anonymous visitors.
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.has_role(uuid, text[]) from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, text[]) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

-- Fixed search path on the audit trigger function.
alter function public.audit_log_append_only() set search_path = public;

-- connection_secrets and mail_watches intentionally have RLS on and no policies:
-- only the worker (service role) may touch them.
comment on table public.connection_secrets is 'Worker only. RLS on with no policies by design.';
comment on table public.mail_watches is 'Worker only. RLS on with no policies by design.';
