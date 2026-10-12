-- Backfill pricing-line end dates (sales.md §8.11). The line shape is
-- name + daily rate + end date (see 20261028090000_extension_tjm_profiles.
-- sql); rows written by older code carry an explicit day volume (`days`)
-- instead. Where the window start is known, the end date is derived so the
-- Mon–Fri day count in [start, end] equals the stored volume exactly —
-- line value is unchanged. Rows without any start date fall back to the
-- contract end date so the line still spans the contract window.

create or replace function private.weekday_volume_end(start_date date, day_count numeric)
returns date
language sql stable
as $$
  -- First date d such that the number of Mon–Fri days in
  -- [start_date, d] equals day_count.
  select min(d::date)
  from generate_series(
    start_date,
    start_date + (ceil(day_count * 7 / 5) + 10)::int,
    interval '1 day'
  ) as d
  where (
    select count(*)
    from generate_series(start_date, d::date, interval '1 day') as g(x)
    where extract(isodow from x) between 1 and 5
  ) = greatest(round(day_count), 1)::bigint
$$;

-- Initial contract lines (sales_projects.tjm_profiles).
update public.sales_projects as p
set tjm_profiles = coalesce((
  select jsonb_agg(
    case
      when elem ->> 'end_date' is null
        and (elem ->> 'days')::numeric is not null
        and (elem ->> 'days')::numeric > 0
      then jsonb_build_object(
        'name', coalesce(elem ->> 'name', ''),
        'tjm', coalesce(elem -> 'tjm', '0'::jsonb),
        'end_date', coalesce(
          private.weekday_volume_end(p.start_date::date, (elem ->> 'days')::numeric),
          p.end_date
        )::text)
      else elem
    end
    order by ord)
  from jsonb_array_elements(p.tjm_profiles) with ordinality as t(elem, ord)
), '[]'::jsonb)
where jsonb_typeof(p.tjm_profiles) = 'array'
  and exists (
    select 1 from jsonb_array_elements(p.tjm_profiles) as e(elem)
    where e.elem ->> 'end_date' is null
      and (e.elem ->> 'days')::numeric is not null
      and (e.elem ->> 'days')::numeric > 0
  );

-- Extension lines (sales_project_extensions.tjm_profiles): legacy régie
-- extensions only had flat tjm/estimated_days — seed one unnamed line
-- whose weekday volume matches the generated amount.
update public.sales_project_extensions as e
set tjm_profiles = jsonb_build_array(jsonb_build_object(
      'name', '',
      'tjm', e.tjm,
      'end_date', coalesce(
        private.weekday_volume_end(e.start_date::date, e.estimated_days),
        e.end_date
      )::text))
where e.pricing_model = 'regie'
  and e.tjm is not null
  and jsonb_array_length(e.tjm_profiles) = 0;

drop function private.weekday_volume_end(date, numeric);
