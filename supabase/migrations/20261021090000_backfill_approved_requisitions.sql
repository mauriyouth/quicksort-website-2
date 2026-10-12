-- Hiring needs created before approval-at-creation are still drafts (or pending
-- approval) and the approval step no longer exists. Promote them so applications
-- can be opened against them, recording the owner as the deciding actor.
update public.opportunities
set status='approved', decided_by=owner_email, decided_at=coalesce(updated_at, now())
where status in ('draft','pending_approval');
