create index business_audit_logs_actor_idx
on public.business_audit_logs(actor_id)
where actor_id is not null;
