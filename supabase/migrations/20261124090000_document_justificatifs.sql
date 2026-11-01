-- Justificatifs: proofs an employee hands in for reimbursements and benefits
-- (Navigo, mutuelle, proof of address…). They file under their own Drive folder (07_Justificatifs,
-- see FOLDER_LABELS in apps/admin/server/documents/folders.ts) and their own
-- section of the documents panel. None is required for any contract.
insert into public.document_types
  (code, label, owner_kinds, folder, requires_expiry, default_validity_months, warn_days, sensitive, required_for, requirement_group, position)
values
  ('TRANSPORT_PASS', 'Justificatif de transport (Navigo)', '{person}', 'justificatifs', false, null, '{}', false, '{}', null, 70),
  ('MUTUELLE',       'Attestation mutuelle / dispense',    '{person}', 'justificatifs', false, null, '{}', false, '{}', null, 71),
  ('JUSTIF_OTHER',   'Autre justificatif',                 '{person}', 'justificatifs', false, null, '{}', false, '{}', null, 79)
on conflict (code) do nothing;

-- Proof of address is a justificatif too. Files already uploaded stay where
-- they are; new ones land in 07_Justificatifs.
update public.document_types set folder = 'justificatifs', position = 72 where code = 'JUSTIF_DOMICILE';
