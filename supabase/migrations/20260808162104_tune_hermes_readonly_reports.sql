-- Correct aggregate totals so they are independent of display limits and use
-- stable source activity for follow-up aging (sync updates are not activity).

create or replace function public.hermes_briefing(
  p_days integer default 14,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (
    select least(greatest(coalesce(p_days,14),1),90) days,
           least(greatest(coalesce(p_limit,20),1),100) row_limit
  ),
  pipeline as (
    select lower(coalesce(j.status,'unknown')) status,count(*)::integer jobs
    from public.jobs j where j.archived_at is null group by 1
  ),
  overdue_rows as (
    select ib.id,ib.invoice_number,ib.contact_id,c.name customer_name,ib.due_on,
           greatest(ib.calculated_balance_cents,0)::bigint balance_cents
    from public.invoice_balances ib left join public.contacts c on c.id=ib.contact_id
    where lower(coalesce(ib.direction,''))='receivable'
      and greatest(ib.calculated_balance_cents,0)>0 and ib.due_on<current_date
    order by ib.due_on,greatest(ib.calculated_balance_cents,0) desc
    limit (select row_limit from params)
  ),
  readiness_rows as (
    select j.id job_id,j.name,j.status,j.scheduled_on,j.formatted_address,c.name customer_name,
           coalesce(cardinality(j.companycam_project_ids),0)>0 has_companycam_project,
           exists(select 1 from public.job_budgets b where b.job_id=j.id) has_budget,
           exists(select 1 from public.job_assignments a where a.job_id=j.id and lower(coalesce(a.status,'active')) not in ('cancelled','removed')) has_assignment,
           public.is_historical_job_accounting_locked(j.id) accounting_locked
    from public.jobs j left join public.contacts c on c.id=j.contact_id cross join params p
    where j.archived_at is null and lower(coalesce(j.status,'')) not in ('archived','cancelled','completed','complete')
      and j.scheduled_on between current_date and current_date+p.days
    order by j.scheduled_on,j.name limit (select row_limit from params)
  ),
  budget_rows as (
    select jf.id job_id,jf.name,jf.status,jf.formatted_address,jf.budget_minutes,jf.used_minutes,
           jf.budget_percent_used,jf.budget_status
    from public.job_feed jf
    where coalesce(jf.budget_percent_used,0)>=90
      and lower(coalesce(jf.status,'')) not in ('completed','complete','archived','cancelled')
    order by jf.budget_percent_used desc nulls last limit (select row_limit from params)
  )
  select jsonb_build_object(
    'schema_version',1,'command','briefing','as_of',now(),
    'filters',jsonb_build_object('days',(select days from params),'limit',(select row_limit from params)),
    'summary',jsonb_build_object(
      'active_jobs',(select count(*) from public.jobs j where j.archived_at is null and lower(coalesce(j.status,'')) not in ('completed','complete','cancelled','archived')),
      'scheduled_window_jobs',(select count(*) from public.jobs j cross join params p where j.archived_at is null and lower(coalesce(j.status,'')) not in ('archived','cancelled','completed','complete') and j.scheduled_on between current_date and current_date+p.days),
      'overdue_receivable_cents',coalesce((select sum(greatest(ib.calculated_balance_cents,0)) from public.invoice_balances ib where lower(coalesce(ib.direction,''))='receivable' and greatest(ib.calculated_balance_cents,0)>0 and ib.due_on<current_date),0),
      'overdue_invoice_count',(select count(*) from public.invoice_balances ib where lower(coalesce(ib.direction,''))='receivable' and greatest(ib.calculated_balance_cents,0)>0 and ib.due_on<current_date),
      'budget_risk_count',(select count(*) from public.job_feed jf where coalesce(jf.budget_percent_used,0)>=90 and lower(coalesce(jf.status,'')) not in ('completed','complete','archived','cancelled'))
    ),
    'pipeline',coalesce((select jsonb_agg(to_jsonb(pipeline) order by jobs desc) from pipeline),'[]'::jsonb),
    'priorities',jsonb_build_object(
      'overdue_receivables',coalesce((select jsonb_agg(to_jsonb(overdue_rows) order by due_on,balance_cents desc) from overdue_rows),'[]'::jsonb),
      'job_readiness',coalesce((select jsonb_agg(to_jsonb(readiness_rows) order by scheduled_on,name) from readiness_rows),'[]'::jsonb),
      'budget_risk',coalesce((select jsonb_agg(to_jsonb(budget_rows) order by budget_percent_used desc) from budget_rows),'[]'::jsonb)
    ),
    'warnings',jsonb_build_array('Invoice status casing is inconsistent; receivables use calculated balances instead of status labels.','Email, Quo, and CompanyCam activity is not included in this database-only briefing.','Historical accounting locks are surfaced and must never be bypassed.'),
    'provenance',jsonb_build_array('public.jobs','public.job_feed','public.job_budgets','public.job_assignments','public.invoice_balances','public.contacts')
  );
$function$;

create or replace function public.hermes_followups(
  p_days integer default 7,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (
    select least(greatest(coalesce(p_days,7),1),90) days,
           least(greatest(coalesce(p_limit,50),1),200) row_limit
  ),
  candidates as (
    select l.id lead_id,l.status,l.pipeline_stage_raw,l.source,l.estimate_scheduled_on,
           c.id contact_id,c.name,c.email,c.phone,q.id quote_id,q.name quote_name,
           q.status quote_status,q.amount_cents,q.valid_until,
           coalesce(q.updated_at,l.captured_at,l.created_at) activity_at
    from public.leads l join public.contacts c on c.id=l.contact_id
    left join lateral (select q0.* from public.quotes q0 where q0.lead_id=l.id order by q0.updated_at desc limit 1) q on true
    cross join params p
    where not exists(select 1 from public.jobs j where j.lead_id=l.id and lower(coalesce(j.status,'')) not in ('cancelled','archived'))
      and lower(coalesce(l.status,'')) not in ('lost','cancelled','won','completed','archived')
      and coalesce(q.updated_at,l.captured_at,l.created_at)<now()-make_interval(days=>p.days)
  ),
  candidate_rows as (
    select * from candidates order by activity_at asc limit (select row_limit from params)
  )
  select jsonb_build_object(
    'schema_version',1,'command','followups','as_of',now(),
    'filters',jsonb_build_object('inactive_days',(select days from params),'limit',(select row_limit from params)),
    'summary',jsonb_build_object('candidate_count',(select count(*) from candidates),'quoted_value_cents',coalesce((select sum(amount_cents) from candidates),0)),
    'rows',coalesce((select jsonb_agg(to_jsonb(candidate_rows) order by activity_at) from candidate_rows),'[]'::jsonb),
    'warnings',jsonb_build_array('Candidates are database-only. Check Gmail and Quo before recommending contact.','Do not send messages without explicit user approval.'),
    'provenance',jsonb_build_array('public.leads','public.contacts','public.quotes','public.jobs')
  );
$function$;
