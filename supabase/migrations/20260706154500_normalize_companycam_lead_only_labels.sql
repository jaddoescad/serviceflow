create or replace function public.normalize_companycam_project_lead_flag()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized_labels text[];
begin
  select coalesce(array_agg(label_text), array[]::text[])
  into normalized_labels
  from (
    select nullif(
      trim(regexp_replace(lower(coalesce(
        label->>'value',
        label->>'display_value',
        label->>'name',
        label->>'title',
        label #>> '{}'
      )), '[^a-z0-9]+', ' ', 'g')),
      ''
    ) as label_text
    from jsonb_array_elements(coalesce(new.labels, '[]'::jsonb)) as label
  ) labels
  where label_text is not null;

  new.is_lead =
    ('lead' = any(normalized_labels) or 'leads' = any(normalized_labels))
    and not exists (
      select 1
      from unnest(normalized_labels) as label_text
      where label_text not in ('lead', 'leads')
    );

  return new;
end;
$$;

drop trigger if exists normalize_companycam_project_lead_flag_before_write
on public.companycam_projects;

create trigger normalize_companycam_project_lead_flag_before_write
before insert or update of labels, is_lead
on public.companycam_projects
for each row
execute function public.normalize_companycam_project_lead_flag();

update public.companycam_projects
set is_lead = is_lead;
