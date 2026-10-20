begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('26000000-0000-4000-8000-000000000001','leave-admin@example.invalid','{}'),
 ('26000000-0000-4000-8000-000000000002','leave-employee@example.invalid','{}'),
 ('26000000-0000-4000-8000-000000000003','leave-sales@example.invalid','{}');
update public.user_roles set role='admin' where user_id='26000000-0000-4000-8000-000000000001';
update public.user_roles set role='sales' where user_id='26000000-0000-4000-8000-000000000003';
insert into public.hr_people(id,full_name,email) values
 ('26000000-0000-4000-8000-000000000011','Leave Mix','leave-mix@example.invalid'),
 ('26000000-0000-4000-8000-000000000012','Leave MidStart','leave-mid@example.invalid'),
 ('26000000-0000-4000-8000-000000000013','Leave Ended','leave-ended@example.invalid'),
 ('26000000-0000-4000-8000-000000000014','Leave Future','leave-future@example.invalid'),
 ('26000000-0000-4000-8000-000000000015','Leave Overdraw','leave-overdraw@example.invalid');
-- m0: first day of the current month; m1: the previous month. All fixtures
-- are anchored on these so the accrual window math is date-independent.
create temporary table leave_anchor as
 select date_trunc('month', current_date)::date as m0, (date_trunc('month', current_date)::date - interval '1 month')::date as m1;
insert into public.employees(id,person_id,start_date,end_date,status) values
 ('26000000-0000-4000-8000-000000000021','26000000-0000-4000-8000-000000000011',(select m1 from leave_anchor),null,'active'),
 ('26000000-0000-4000-8000-000000000022','26000000-0000-4000-8000-000000000012',(select m1 + 14 from leave_anchor),null,'preboarding'),
 ('26000000-0000-4000-8000-000000000023','26000000-0000-4000-8000-000000000013',(select m0 - interval '3 months' from leave_anchor)::date,(select m1 + 9 from leave_anchor),'ended'),
 ('26000000-0000-4000-8000-000000000024','26000000-0000-4000-8000-000000000014',(select m0 + interval '1 month' from leave_anchor)::date,null,'active'),
 ('26000000-0000-4000-8000-000000000025','26000000-0000-4000-8000-000000000015',(select m1 from leave_anchor),null,'active');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('26000000-0000-4000-8000-000000000002','26000000-0000-4000-8000-000000000011','26000000-0000-4000-8000-000000000001');
-- Consumption fixtures, inserted directly (RLS is exercised through the
-- balance function itself). One full + one half paid_leave day, one full +
-- one half rtt day for the mix employee; five full paid_leave days for the
-- overdrawn employee.
insert into public.cra_months(employee_id,month) values
 ('26000000-0000-4000-8000-000000000021',(select m1 from leave_anchor)),
 ('26000000-0000-4000-8000-000000000025',(select m1 from leave_anchor));
insert into public.cra_entries(employee_id,month,day,part,status,project_id) values
 ('26000000-0000-4000-8000-000000000021',(select m1 from leave_anchor),(select m1 + 9 from leave_anchor),'am','paid_leave',null),
 ('26000000-0000-4000-8000-000000000021',(select m1 from leave_anchor),(select m1 + 10 from leave_anchor),'full','paid_leave',null),
 ('26000000-0000-4000-8000-000000000021',(select m1 from leave_anchor),(select m1 + 11 from leave_anchor),'full','rtt',null),
 ('26000000-0000-4000-8000-000000000021',(select m1 from leave_anchor),(select m1 + 12 from leave_anchor),'pm','rtt',null),
 ('26000000-0000-4000-8000-000000000025',(select m1 from leave_anchor),(select m1 + 9 from leave_anchor),'full','paid_leave',null),
 ('26000000-0000-4000-8000-000000000025',(select m1 from leave_anchor),(select m1 + 10 from leave_anchor),'full','paid_leave',null),
 ('26000000-0000-4000-8000-000000000025',(select m1 from leave_anchor),(select m1 + 11 from leave_anchor),'full','paid_leave',null),
 ('26000000-0000-4000-8000-000000000025',(select m1 from leave_anchor),(select m1 + 12 from leave_anchor),'full','paid_leave',null),
 ('26000000-0000-4000-8000-000000000025',(select m1 from leave_anchor),(select m1 + 13 from leave_anchor),'full','paid_leave',null);
create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.balance(target uuid, leave_kind text) returns public.leave_balance language sql stable as $$
 select * from public.employee_leave_balances() where employee_id=target and kind=leave_kind;
$$;
select set_config('request.jwt.claims','{"sub":"26000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- (a) Half-day mix: am/pm weigh 0.5, full weighs 1, per kind.
select pg_temp.assert_true((select accrued from pg_temp.balance('26000000-0000-4000-8000-000000000021','cp'))=4.16,'Two months accrue 4.16 CP days at the seeded rate');
select pg_temp.assert_true((select consumed from pg_temp.balance('26000000-0000-4000-8000-000000000021','cp'))=1.5,'A morning and a full day consume exactly 1.5 CP days');
select pg_temp.assert_true((select available from pg_temp.balance('26000000-0000-4000-8000-000000000021','cp'))=2.66,'CP available nets consumption at 0.5 granularity');
select pg_temp.assert_true((select accrued from pg_temp.balance('26000000-0000-4000-8000-000000000021','rtt'))=1.6,'Two months accrue 1.6 RTT days at the seeded rate');
select pg_temp.assert_true((select consumed from pg_temp.balance('26000000-0000-4000-8000-000000000021','rtt'))=1.5,'A full day and an afternoon consume exactly 1.5 RTT days');
select pg_temp.assert_true((select available from pg_temp.balance('26000000-0000-4000-8000-000000000021','rtt'))=0.1,'RTT available nets consumption at 0.5 granularity');
-- (b) Month window: a mid-month start accrues its whole start month; an ended
-- employee accrues through the end month and no further. The preboarding
-- status on the mid-month employee must not block accrual.
select pg_temp.assert_true((select accrued from pg_temp.balance('26000000-0000-4000-8000-000000000022','cp'))=4.16,'A mid-month start accrues the whole start month');
select pg_temp.assert_true((select accrued from pg_temp.balance('26000000-0000-4000-8000-000000000023','cp'))=6.24,'An ended employee accrues through the end month only');
-- (c) A future start date yields no balance rows at all.
select pg_temp.assert_true(not exists(select 1 from public.employee_leave_balances() where employee_id='26000000-0000-4000-8000-000000000024'),'Future start date yields no balance rows');
-- (d) Overdraw: consumed above accrued shows a negative available.
select pg_temp.assert_true((select available from pg_temp.balance('26000000-0000-4000-8000-000000000025','cp'))=-0.84,'Overdrawn CP shows a negative available');
-- (e) Editing the CP rate reprices every employee retroactively.
update public.leave_accrual_settings set rate=2.5 where kind='cp';
select pg_temp.assert_true((select accrued from pg_temp.balance('26000000-0000-4000-8000-000000000022','cp'))=5.00,'A rate edit reprices all past months');
select pg_temp.assert_true((select accrued from pg_temp.balance('26000000-0000-4000-8000-000000000022','rtt'))=1.6,'The untouched RTT rate keeps accruing at 0.8');
-- Row visibility: the admin sees every accessible employee, two rows each.
select pg_temp.assert_true((select count(*) from public.employee_leave_balances())=8,'Admin sees two balance rows per accessible employee');
-- (f) An authenticated non-HR, non-owner role gets zero rows.
select set_config('request.jwt.claims','{"sub":"26000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.employee_leave_balances())=0,'Sales role gets no balance rows');
do $$ begin
 begin perform (select count(*) from public.leave_accrual_settings); raise exception 'FAILED: Sales role can read the settings table';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
-- The employee themself sees only their own two rows.
select set_config('request.jwt.claims','{"sub":"26000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.employee_leave_balances())=2,'Employee sees only their own balances');
select pg_temp.assert_true((select available from pg_temp.balance('26000000-0000-4000-8000-000000000021','cp'))=3.5,'Employee CP balance reflects the repriced rate');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.employee_leave_balances()','execute'),'Anonymous balance read is denied');
rollback;
