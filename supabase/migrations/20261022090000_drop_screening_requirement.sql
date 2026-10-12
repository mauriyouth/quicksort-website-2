-- Screening evidence was redundant with the required move comment (rationale).
-- Stage moves no longer require a recorded screening summary/recommendation;
-- the move_application rationale carries that context instead.
create or replace function public.hr_application_requirements(application_id uuid,to_stage text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.hr_applications; items jsonb:='[]'; k text;
begin
 if not private.hr_operator() then raise exception 'HR access required.'; end if;
 select * into a from public.hr_applications where id=application_id;
 if not found then raise exception 'Application not found.'; end if;
 if to_stage not in ('hire','application','screening','hr_interview','technical_interview','client_presentation','decision','offer','contract') then raise exception 'Unknown recruitment stage.'; end if;
 if to_stage in ('technical_interview','client_presentation','decision','offer','contract') then
 items:=items||jsonb_build_array(jsonb_build_object('key','hr_interview','label','HR interview held with a scorecard','done',exists(select 1 from public.interviews i where i.application_id=a.id and i.kind='hr' and i.status='completed' and jsonb_array_length(i.scorecard)>0))); end if;
 if to_stage in ('client_presentation','decision','offer','contract') then
 items:=items||jsonb_build_array(jsonb_build_object('key','technical_interview','label','Technical interview held with a scorecard','done',exists(select 1 from public.interviews i where i.application_id=a.id and i.kind='technical' and i.status='completed' and jsonb_array_length(i.scorecard)>0))); end if;
 if to_stage in ('decision','offer','contract') then
 items:=items||jsonb_build_array(jsonb_build_object('key','interviews','label','No interviews awaiting completion','done',not exists(select 1 from public.interviews i where i.application_id=a.id and i.status='scheduled'))); end if;
 if to_stage='offer' then
 items:=items||jsonb_build_array(jsonb_build_object('key','approval','label','Approved employment offer on file','done',exists(select 1 from public.offers o where o.application_id=a.id and o.status in ('approved','shared','accepted')))); end if;
 if to_stage='contract' then
 items:=items||jsonb_build_array(jsonb_build_object('key','offer','label','Accepted offer on file','done',exists(select 1 from public.offers o where o.application_id=a.id and o.status='accepted'))); end if;
 if to_stage='hire' then
 items:=public.hr_application_requirements(application_id,'decision')||jsonb_build_array(
 jsonb_build_object('key','stage','label','Application is at Contract','done',a.stage='contract' and a.status='active'),
 jsonb_build_object('key','offer','label','Accepted offer on file','done',exists(select 1 from public.offers where offers.application_id=a.id and status='accepted')),
 jsonb_build_object('key','signatures','label','Candidate and employer have signed the linked contract','done',exists(select 1 from public.contracts c join public.contract_signatures s on s.contract_id=c.id and s.document_sha256=c.document_sha256 join public.contract_countersignatures cs on cs.contract_id=c.id and cs.document_sha256=c.document_sha256 where c.application_id=a.id and c.person_id=a.person_id and exists(select 1 from public.offers o where o.id=c.offer_id and o.status='accepted'))),
 jsonb_build_object('key','employment','label','No other open employment period','done',not exists(select 1 from public.employees where person_id=a.person_id and status<>'ended')));
 end if;
 return items;
end;
$$;
