-- Estimators and admins can delete an RFQ job (site quotes already allow it). Its attachments,
-- drafts and runs go with it (on delete cascade); emails stay, unlinked.
create policy "estimators delete jobs" on public.jobs
  for delete to authenticated
  using (public.has_role(tenant_id, array['admin', 'estimator']));
