-- Leads open in the app like jobs: the description is the one the website
-- shows (the project workspace's, else what the job or lead was imported
-- with), and every open lead starts with the company's document templates,
-- like the one pager a salesperson fills at the estimate. A job made from a
-- lead starts from the lead's filled copy instead of a blank one.
begin;

-- Nothing was ever written to the app-only table; it becomes a view of the
-- shared description under the same name so released apps keep working.
do $$
begin
  if exists (select 1 from public.job_descriptions) then
    raise exception 'job_descriptions has rows; move them to project_workspace first';
  end if;
end $$;
alter table public.job_descriptions rename to job_descriptions_retired;

-- `job_id` is any project's id: a job's or a lead's.
create view public.job_descriptions with (security_invoker = true) as
select job.id as job_id, job.org_id,
  case when workspace.description is not null then workspace.description else coalesce(
    nullif(btrim(job.metadata ->> 'project_description'), ''),
    nullif(btrim(job.metadata ->> 'companycam_description'), ''),
    nullif(btrim(job.metadata ->> 'description'), ''),
    nullif(btrim(job.metadata ->> 'scope_description'), ''),
    nullif(btrim(lead.metadata ->> 'project_description'), ''),
    nullif(btrim(lead.metadata ->> 'companycam_description'), ''),
    nullif(btrim(lead.metadata ->> 'description'), '')
  ) end as body
from public.jobs job
left join public.project_workspace workspace on workspace.job_id = job.id
left join public.leads lead on lead.id = job.lead_id
union all
select lead.id, lead.org_id,
  case when workspace.description is not null then workspace.description else coalesce(
    nullif(btrim(lead.metadata ->> 'project_description'), ''),
    nullif(btrim(lead.metadata ->> 'companycam_description'), ''),
    nullif(btrim(lead.metadata ->> 'description'), ''),
    nullif(btrim(lead.metadata ->> 'scope_description'), '')
  ) end
from public.leads lead
left join public.project_workspace workspace on workspace.lead_id = lead.id;
revoke all on public.job_descriptions from anon, authenticated;
grant select on public.job_descriptions to authenticated;

create or replace view public.job_feed with (security_invoker = true) as
 SELECT job.id,
    job.name,
    job.status,
    job.formatted_address,
    job.address_line_1,
    job.address_line_2,
    job.city,
    job.province,
    job.postal_code,
    job.country,
    job.latitude,
    job.longitude,
    job.companycam_project_ids,
    job.scheduled_on,
    job.started_on,
    job.completed_on,
    job.is_feed_visible,
    job.updated_at,
    budget.budget_minutes,
    usage.used_minutes,
        CASE
            WHEN budget.budget_minutes IS NULL OR budget.budget_minutes = 0 THEN NULL::numeric
            ELSE round(usage.used_minutes::numeric / budget.budget_minutes::numeric * 100::numeric, 2)
        END AS budget_percent_used,
        CASE
            WHEN budget.budget_minutes IS NULL THEN 'not_configured'::text
            WHEN usage.used_minutes > budget.budget_minutes THEN 'over_budget'::text
            WHEN job.status = 'completed'::text THEN 'complete'::text
            ELSE 'active'::text
        END AS budget_status,
    job.lead_id,
    job.org_id,
    rate.budget_hourly_rate_cents,
    ( SELECT nullif(description.body, '')
           FROM job_descriptions description
          WHERE description.job_id = job.id) AS description
   FROM jobs job
     LEFT JOIN LATERAL ( SELECT source.budget_minutes,
            COALESCE(source.hourly_rate_cents, NULLIF(source.metadata ->> 'formula_hourly_rate_cents'::text, ''::text)::integer) AS hourly_rate_cents
           FROM job_budgets source
          WHERE source.job_id = job.id AND (source.status = ANY (ARRAY['active'::text, 'closed'::text]))
          ORDER BY (source.status = 'active'::text) DESC, (source.source = ANY (ARRAY['manual'::text, 'project_budget'::text])) DESC, (source.source = 'manual'::text) DESC, source.version DESC, source.updated_at DESC, source.id
         LIMIT 1) budget ON true
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN budget.budget_minutes > 0 THEN COALESCE(budget.hourly_rate_cents, ( SELECT NULLIF(org.settings #>> '{labour_budget,planning_hourly_rate_cents}'::text[], ''::text)::integer AS "nullif"
                       FROM organizations org
                      WHERE org.id = job.org_id), 3000)
                    ELSE NULL::integer
                END AS budget_hourly_rate_cents) rate ON true
     LEFT JOIN LATERAL ( SELECT private.job_budget_used_minutes(job.id, rate.budget_hourly_rate_cents) AS used_minutes) usage ON true
  WHERE job.is_feed_visible;

drop table public.job_descriptions_retired;

-- The app saves through the website's description path; managers only.
create or replace function public.set_job_description(requested_job_id uuid, requested_body text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  company uuid := private.org_of_project(requested_job_id);
  body text := btrim(coalesce(requested_body, ''));
begin
  if company is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can edit descriptions.' using errcode = '42501';
  end if;
  perform public.save_workspace_description(requested_job_id, body);
  return body;
end
$$;
revoke execute on function public.set_job_description(uuid, text) from public, anon;
grant execute on function public.set_job_description(uuid, text) to authenticated;

-- Open leads get a copy of each template, as new jobs do.
create function private.add_lead_document_templates()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status in ('new', 'contacted', 'estimate_scheduled', 'estimated', 'proposal_sent') then
    insert into public.project_documents (project_id, name, kind, body_html, mime_type, byte_size, created_by, updated_by)
    select new.id, t.name, 'page', t.body_html, 'text/html', char_length(t.body_html), null, null
    from public.project_document_templates t
    where t.org_id = new.org_id
    order by t.created_at;
  end if;
  return null;
end
$$;
revoke all on function private.add_lead_document_templates() from public, anon, authenticated;
create trigger add_document_templates after insert on public.leads
  for each row execute function private.add_lead_document_templates();

-- A job made from a lead starts each template page from the lead's copy.
create or replace function private.add_job_document_templates()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.archived_at is null and new.status not in ('completed', 'archived', 'cancelled') then
    insert into public.project_documents (project_id, name, kind, body_html, mime_type, byte_size, created_by, updated_by)
    select new.id, t.name, 'page', page.body_html, 'text/html', char_length(page.body_html), null, null
    from public.project_document_templates t
    cross join lateral (
      select coalesce((
        select d.body_html from public.project_documents d
        where new.lead_id is not null and d.project_id = new.lead_id and d.kind = 'page' and d.name = t.name
        order by d.updated_at desc
        limit 1
      ), t.body_html) as body_html
    ) page
    where t.org_id = new.org_id
    order by t.created_at;
  end if;
  return null;
end
$$;

-- Open leads that don't have them yet.
insert into public.project_documents (project_id, name, kind, body_html, mime_type, byte_size, created_by, updated_by)
select lead.id, t.name, 'page', t.body_html, 'text/html', char_length(t.body_html), null, null
from public.leads lead
join public.project_document_templates t on t.org_id = lead.org_id
where lead.status in ('new', 'contacted', 'estimate_scheduled', 'estimated', 'proposal_sent')
  and not exists (select 1 from public.jobs job where job.lead_id = lead.id)
  and not exists (select 1 from public.project_documents d where d.project_id = lead.id and d.name = t.name)
order by lead.created_at, t.created_at;

select pg_notify('pgrst', 'reload schema');

commit;
