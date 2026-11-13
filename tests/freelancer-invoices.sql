begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','fi-admin@example.invalid','{}'),
 ('71000000-0000-4000-8000-000000000002','fi-freelancer@example.invalid','{}'),
 ('71000000-0000-4000-8000-000000000003','fi-other@example.invalid','{}');
update public.user_roles set role='admin' where user_id='71000000-0000-4000-8000-000000000001';
insert into public.hr_people(id,full_name,email) values
 ('72000000-0000-4000-8000-000000000001','Freelancer One','Fi-Freelancer@Example.invalid'),
 ('72000000-0000-4000-8000-000000000002','Freelancer Two','fi-other@example.invalid');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('71000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001'),
 ('71000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001');
insert into public.employees(id,person_id,start_date,status,contract_type) values
 ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','2026-01-01','active','Freelance'),
 ('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','2026-01-01','active','Freelance');
create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.as_user(id text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub','user_clerk_'||id,'workspace_user_id',id,'role','authenticated')::text,true);
$$;

-- Admin writes.
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into public.freelancer_invoices(employee_id,source,sha256,number,issue_date,period_month,amount_ht_cents,vat_cents,amount_ttc_cents)
 values('73000000-0000-4000-8000-000000000001','portal','sha-1','F-1','2026-11-30','2026-11-01',100000,20000,120000);
insert into public.freelancer_billing(employee_id,extra_emails) values('73000000-0000-4000-8000-000000000001','{Billing@Freelancer.Example}');
select pg_temp.assert_true((select count(*) from public.freelancer_invoices)=1,'Admin inserts and sees invoices');
insert into public.freelancer_mailbox_messages(message_id,status,last_error) values('m-1','failed','boom');
select pg_temp.assert_true((select attempts from public.freelancer_mailbox_messages where message_id='m-1')=1,'Admin records a mailbox message');
do $$ begin
 begin insert into public.freelancer_mailbox_messages(message_id,status) values('m-2','pending'); raise exception 'FAILED: bad mailbox status accepted';
 exception when check_violation then null; end;
end; $$;
reset role;

-- Duplicates.
do $$ begin
 begin
  insert into public.freelancer_invoices(employee_id,source,sha256,number) values('73000000-0000-4000-8000-000000000001','email','sha-1','F-2');
  raise exception 'FAILED: duplicate sha accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.freelancer_invoices(employee_id,source,sha256,number) values('73000000-0000-4000-8000-000000000001','email','sha-2','F-1');
  raise exception 'FAILED: duplicate number accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.freelancer_invoices(employee_id,source,sha256,period_month) values('73000000-0000-4000-8000-000000000001','email','sha-3','2026-11-15');
  raise exception 'FAILED: mid-month period accepted';
 exception when check_violation then null; end;
end; $$;
insert into public.freelancer_invoices(employee_id,source,sha256) values('73000000-0000-4000-8000-000000000001','email','sha-4'),('73000000-0000-4000-8000-000000000001','email','sha-5');
-- A rejected invoice frees its number for the corrected one; its file stays a duplicate.
insert into public.freelancer_invoices(employee_id,source,sha256,number,review) values('73000000-0000-4000-8000-000000000001','email','sha-r1','FAC-12','rejected');
insert into public.freelancer_invoices(employee_id,source,sha256,number) values('73000000-0000-4000-8000-000000000001','portal','sha-r2','FAC-12');
select pg_temp.assert_true((select count(*) from public.freelancer_invoices where number='FAC-12')=2,'A corrected invoice reuses a rejected number');
do $$ begin
 begin
  insert into public.freelancer_invoices(employee_id,source,sha256,number) values('73000000-0000-4000-8000-000000000001','email','sha-r3','FAC-12');
  raise exception 'FAILED: a second live FAC-12 accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.freelancer_invoices(employee_id,source,sha256,number) values('73000000-0000-4000-8000-000000000001','email','sha-r1','FAC-13');
  raise exception 'FAILED: the file of a rejected invoice accepted again';
 exception when unique_violation then null; end;
end; $$;

-- Freelancer: no table access, portal RPC shows own invoices only, with no review detail.
select pg_temp.as_user('71000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.freelancer_invoices)=0,'Freelancer cannot select invoices');
select pg_temp.assert_true((select count(*) from public.freelancer_billing)=0,'Freelancer cannot select billing');
do $$ begin
 begin insert into public.freelancer_mailbox_messages(message_id,status) values('m-x','done'); raise exception 'FAILED: freelancer wrote mailbox messages';
 exception when insufficient_privilege then null; end;
end; $$;
select pg_temp.assert_true((select count(*) from public.my_freelancer_invoices())=5,'Freelancer sees own invoices');
select pg_temp.assert_true((select portal_status from public.my_freelancer_invoices() where number='FAC-12' and portal_status<>'received')='not_accepted','Rejected invoice shows as not accepted');
select pg_temp.assert_true((select portal_status='received' and number='F-1' and amount_ttc_cents=120000 from public.my_freelancer_invoices() where number='F-1'),'Received status');
reset role;
update public.freelancer_invoices set review='ok' where sha256='sha-1';
update public.freelancer_invoices set review='ok', paid_at=now() where sha256='sha-4';
select pg_temp.as_user('71000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_true((select portal_status from public.my_freelancer_invoices() where number='F-1')='to_pay','To pay status');
select pg_temp.assert_true((select count(*) from public.my_freelancer_invoices() where portal_status='paid')=1,'Paid status');
reset role;

select pg_temp.as_user('71000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.my_document_types where code='FREELANCE_INVOICE')=0,'FREELANCE_INVOICE is not offered for self-upload');
select pg_temp.assert_true((select count(*) from public.my_document_types where code='RIB')=1,'Other types still listed');
reset role;

-- Another user sees only theirs.
select pg_temp.as_user('71000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.my_freelancer_invoices())=0,'Other freelancer sees nothing of it');
reset role;

-- Known senders: service role only, lowercased.
select pg_temp.assert_true((select count(*) from public.freelancer_known_senders() where employee_id='73000000-0000-4000-8000-000000000001' and email='billing@freelancer.example')=1,'Extra email is a lowercased known sender');
select pg_temp.assert_true((select count(*) from public.freelancer_known_senders() where email='fi-freelancer@example.invalid')=1,'Person email is a known sender');
-- Ended in the last 90 days (final invoice) and preboarding still send; ended earlier does not;
-- a person with an open freelance employment sends for that one only.
insert into public.hr_people(id,full_name,email) values
 ('72000000-0000-4000-8000-000000000003','Recently Ended','fi-recent@example.invalid'),
 ('72000000-0000-4000-8000-000000000004','Long Ended','fi-long@example.invalid'),
 ('72000000-0000-4000-8000-000000000005','Not Started','fi-pre@example.invalid'),
 ('72000000-0000-4000-8000-000000000006','Renewed','fi-renewed@example.invalid');
insert into public.employees(id,person_id,start_date,end_date,status,contract_type) values
 ('73000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000003',current_date-200,current_date-30,'ended','Freelance'),
 ('73000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000004',current_date-400,current_date-91,'ended','Freelance'),
 ('73000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000005',current_date+20,null,'preboarding','Freelance'),
 ('73000000-0000-4000-8000-000000000006','72000000-0000-4000-8000-000000000006',current_date-200,current_date-10,'ended','Freelance'),
 ('73000000-0000-4000-8000-000000000007','72000000-0000-4000-8000-000000000006',current_date-9,null,'active','Freelance');
select pg_temp.assert_true((select count(*) from public.freelancer_known_senders() where email='fi-recent@example.invalid' and employee_id='73000000-0000-4000-8000-000000000003')=1,'Recently ended freelancer is a known sender');
select pg_temp.assert_true((select count(*) from public.freelancer_known_senders() where email='fi-long@example.invalid')=0,'Freelancer ended over 90 days ago is not a sender');
select pg_temp.assert_true((select count(*) from public.freelancer_known_senders() where email='fi-pre@example.invalid')=1,'Preboarding freelancer is a known sender');
select pg_temp.assert_true((select array_agg(employee_id::text) from public.freelancer_known_senders() where email='fi-renewed@example.invalid')=array['73000000-0000-4000-8000-000000000007'],'A renewed freelancer sends for the open employment only');
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$ begin
 begin perform * from public.freelancer_known_senders(); raise exception 'FAILED: authenticated ran known senders';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;

-- Marking paid: one debit pays one invoice unless linked to several in one call.
insert into public.bank_transactions(id,settled_at,month,amount_cents,amount_ht_cents,status,qonto_updated_at,raw) values
 ('fi-tx-1','2026-12-05T10:00:00Z','2026-12-01',-120000,-120000,'completed',now(),'{}');
insert into public.freelancer_invoices(id,employee_id,source,sha256,number,issue_date,amount_ttc_cents) values
 ('74000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','email','sha-p1','P-1','2026-12-01',120000),
 ('74000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000002','email','sha-p2','P-2','2026-12-01',120000),
 ('74000000-0000-4000-8000-000000000003','73000000-0000-4000-8000-000000000002','email','sha-p3','P-3','2026-12-01',60000);
select pg_temp.as_user('71000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$ begin
 begin perform public.freelancer_invoice_mark_paid(array['74000000-0000-4000-8000-000000000001'::uuid],'fi-tx-1','probable','x',now());
  raise exception 'FAILED: non-admin marked an invoice paid';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_true(public.freelancer_invoice_mark_paid(array['74000000-0000-4000-8000-000000000001'::uuid],'fi-tx-1','probable','fi-admin@example.invalid','2026-12-05T10:00:00Z')=1,'Admin marks an invoice paid');
do $$ begin
 begin perform public.freelancer_invoice_mark_paid(array['74000000-0000-4000-8000-000000000002'::uuid],'fi-tx-1','probable','fi-admin@example.invalid',now());
  raise exception 'FAILED: a used debit paid a second invoice';
 exception when sqlstate 'P0409' then null; end;
 begin perform public.freelancer_invoice_mark_paid(array['74000000-0000-4000-8000-000000000001'::uuid],'fi-tx-1','manual','fi-admin@example.invalid',now());
  raise exception 'FAILED: a paid invoice was paid again';
 exception when sqlstate 'P0409' then null; end;
end; $$;
reset role;
select pg_temp.assert_true((select paid_by_transaction_id='fi-tx-1' and version=2 from public.freelancer_invoices where id='74000000-0000-4000-8000-000000000001'),'Paid by the debit');
select pg_temp.assert_true((select paid_at is null from public.freelancer_invoices where id='74000000-0000-4000-8000-000000000002'),'Refused invoice left unpaid');
select pg_temp.assert_true((select state='confirmed' and kind='probable' and decided_by='fi-admin@example.invalid' from public.freelancer_invoice_matches where transaction_id='fi-tx-1'),'Match confirmed');
select pg_temp.assert_true((select count(*) from public.freelancer_invoice_events where kind='paid_confirmed' and invoice_id='74000000-0000-4000-8000-000000000001')=1,'Payment event logged');
-- An explicit link to several invoices, with the service role.
insert into public.bank_transactions(id,settled_at,month,amount_cents,amount_ht_cents,status,qonto_updated_at,raw) values
 ('fi-tx-2','2026-12-06T10:00:00Z','2026-12-01',-180000,-180000,'completed',now(),'{}');
set local role service_role;
select pg_temp.assert_true(public.freelancer_invoice_mark_paid(array['74000000-0000-4000-8000-000000000002'::uuid,'74000000-0000-4000-8000-000000000003'::uuid],'fi-tx-2','manual','admin',now())=2,'Service role links one debit to two invoices');
reset role;
select pg_temp.assert_true((select count(*) from public.freelancer_invoice_events where kind='paid_linked')=2,'Link events logged');

-- Seeds.
select pg_temp.assert_true((select count(*) from public.document_types where code='FREELANCE_INVOICE' and folder='factures' and required_for='{}')=1,'Document type seeded');
select pg_temp.assert_true((select count(*) from public.freelancer_mailbox_settings where id='mailbox' and address='mohamed@quicksort.fr')=1,'Mailbox singleton seeded');
rollback;
