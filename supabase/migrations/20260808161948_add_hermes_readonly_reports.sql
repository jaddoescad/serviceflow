-- Versioned, read-only report contracts for the Hermes operations assistant.
-- Every function is SECURITY INVOKER so the caller's existing RLS policies apply.

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
    select least(greatest(coalesce(p_days, 14), 1), 90) as days,
           least(greatest(coalesce(p_limit, 20), 1), 100) as row_limit
  ),
  pipeline as (
    select lower(coalesce(j.status, 'unknown')) as status, count(*)::integer as jobs
    from public.jobs j
    where j.archived_at is null
    group by 1
  ),
  overdue as (
    select ib.id, ib.invoice_number, ib.contact_id, c.name as customer_name,
           ib.due_on, greatest(ib.calculated_balance_cents, 0)::bigint as balance_cents
    from public.invoice_balances ib
    left join public.contacts c on c.id = ib.contact_id
    where lower(coalesce(ib.direction, '')) = 'receivable'
      and greatest(ib.calculated_balance_cents, 0) > 0
      and ib.due_on < current_date
    order by ib.due_on asc nulls last, greatest(ib.calculated_balance_cents, 0) desc
    limit (select row_limit from params)
  ),
  readiness as (
    select j.id as job_id, j.name, j.status, j.scheduled_on, j.formatted_address,
           c.name as customer_name,
           coalesce(cardinality(j.companycam_project_ids), 0) > 0 as has_companycam_project,
           exists (select 1 from public.job_budgets jb where jb.job_id = j.id) as has_budget,
           exists (select 1 from public.job_assignments ja where ja.job_id = j.id and lower(coalesce(ja.status, 'active')) not in ('cancelled','removed')) as has_assignment,
           public.is_historical_job_accounting_locked(j.id) as accounting_locked
    from public.jobs j
    left join public.contacts c on c.id = j.contact_id
    cross join params p
    where j.archived_at is null
      and j.scheduled_on between current_date and current_date + p.days
    order by j.scheduled_on, j.name
    limit (select row_limit from params)
  ),
  budget_risk as (
    select jf.id as job_id, jf.name, jf.status, jf.formatted_address,
           jf.budget_minutes, jf.used_minutes, jf.budget_percent_used, jf.budget_status
    from public.job_feed jf
    where coalesce(jf.budget_percent_used, 0) >= 90
      and lower(coalesce(jf.status, '')) not in ('completed','complete','archived','cancelled')
    order by jf.budget_percent_used desc nulls last
    limit (select row_limit from params)
  )
  select jsonb_build_object(
    'schema_version', 1,
    'command', 'briefing',
    'as_of', now(),
    'filters', jsonb_build_object('days', (select days from params), 'limit', (select row_limit from params)),
    'summary', jsonb_build_object(
      'active_jobs', (select count(*) from public.jobs j where j.archived_at is null and lower(coalesce(j.status,'')) not in ('completed','complete','cancelled')),
      'scheduled_window_jobs', (select count(*) from readiness),
      'overdue_receivable_cents', coalesce((select sum(o.balance_cents) from overdue o), 0),
      'overdue_invoice_count', (select count(*) from overdue),
      'budget_risk_count', (select count(*) from budget_risk)
    ),
    'pipeline', coalesce((select jsonb_agg(to_jsonb(pipeline) order by jobs desc) from pipeline), '[]'::jsonb),
    'priorities', jsonb_build_object(
      'overdue_receivables', coalesce((select jsonb_agg(to_jsonb(overdue) order by due_on, balance_cents desc) from overdue), '[]'::jsonb),
      'job_readiness', coalesce((select jsonb_agg(to_jsonb(readiness) order by scheduled_on, name) from readiness), '[]'::jsonb),
      'budget_risk', coalesce((select jsonb_agg(to_jsonb(budget_risk) order by budget_percent_used desc) from budget_risk), '[]'::jsonb)
    ),
    'warnings', jsonb_build_array(
      'Invoice status casing is inconsistent; receivables use calculated balances instead of status labels.',
      'Email, Quo, and CompanyCam activity is not included in this database-only briefing.',
      'Historical accounting locks are surfaced and must never be bypassed.'
    ),
    'provenance', jsonb_build_array('public.jobs','public.job_feed','public.job_budgets','public.job_assignments','public.invoice_balances','public.contacts')
  );
$function$;

create or replace function public.hermes_job_360(
  p_query text,
  p_limit integer default 10
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (
    select nullif(btrim(coalesce(p_query, '')), '') as query,
           least(greatest(coalesce(p_limit, 10), 1), 25) as row_limit
  ),
  matched as (
    select j.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           jf.budget_minutes, jf.used_minutes, jf.budget_percent_used, jf.budget_status,
           fs.contract_amount_cents as summary_contract_amount_cents,
           fs.receivable_cents, fs.labour_cost_cents, fs.material_cost_cents, fs.total_cost_cents,
           public.is_historical_job_accounting_locked(j.id) as accounting_locked
    from public.jobs j
    left join public.contacts c on c.id = j.contact_id
    left join public.job_feed jf on jf.id = j.id
    left join public.job_financial_summary fs on fs.job_id = j.id
    cross join params p
    where p.query is not null
      and (j.id::text = p.query
        or j.name ilike '%' || p.query || '%'
        or coalesce(j.formatted_address, '') ilike '%' || p.query || '%'
        or coalesce(c.name, '') ilike '%' || p.query || '%'
        or coalesce(c.email, '') ilike '%' || p.query || '%'
        or coalesce(c.phone, '') ilike '%' || p.query || '%')
    order by case when j.id::text = p.query then 0 when lower(j.name) = lower(p.query) then 1 else 2 end,
             j.updated_at desc
    limit (select row_limit from params)
  ),
  records as (
    select jsonb_build_object(
      'job', jsonb_build_object(
        'id', m.id, 'name', m.name, 'status', m.status, 'address', m.formatted_address,
        'scheduled_on', m.scheduled_on, 'started_on', m.started_on, 'completed_on', m.completed_on,
        'companycam_project_ids', to_jsonb(m.companycam_project_ids), 'source', m.source,
        'updated_at', m.updated_at, 'accounting_locked', m.accounting_locked
      ),
      'customer', jsonb_build_object('id', m.contact_id, 'name', m.customer_name, 'email', m.customer_email, 'phone', m.customer_phone),
      'operations', jsonb_build_object(
        'budget_minutes', m.budget_minutes, 'used_minutes', m.used_minutes,
        'budget_percent_used', m.budget_percent_used, 'budget_status', m.budget_status,
        'open_tasks', (select count(*) from public.job_tasks jt where jt.job_id = m.id and lower(coalesce(jt.status,'')) not in ('completed','complete','done','cancelled')),
        'issue_count', (select count(*) from public.job_issues ji where ji.job_id = m.id),
        'assignment_count', (select count(*) from public.job_assignments ja where ja.job_id = m.id and lower(coalesce(ja.status,'active')) not in ('cancelled','removed'))
      ),
      'financials', jsonb_build_object(
        'contract_amount_cents', coalesce(m.summary_contract_amount_cents, m.contract_amount_cents, 0),
        'receivable_cents', coalesce(m.receivable_cents, 0),
        'labour_cost_cents', coalesce(m.labour_cost_cents, 0),
        'material_cost_cents', coalesce(m.material_cost_cents, 0),
        'total_cost_cents', coalesce(m.total_cost_cents, 0),
        'gross_profit_cents', coalesce(m.summary_contract_amount_cents, m.contract_amount_cents, 0) - coalesce(m.total_cost_cents, 0)
      ),
      'recent_time_entries', coalesce((
        select jsonb_agg(x.item order by x.started_at desc)
        from (
          select jsonb_build_object('employee_name', te.employee_name, 'started_at', te.started_at, 'ended_at', te.ended_at, 'status', te.status, 'is_on_site', te.is_on_site) as item,
                 te.started_at
          from public.time_entries te where te.job_id = m.id order by te.started_at desc limit 10
        ) x
      ), '[]'::jsonb)
    ) as item
    from matched m
  )
  select jsonb_build_object(
    'schema_version', 1, 'command', 'job', 'as_of', now(),
    'filters', jsonb_build_object('query', p_query, 'limit', (select row_limit from params)),
    'match_count', (select count(*) from records),
    'rows', coalesce((select jsonb_agg(item) from records), '[]'::jsonb),
    'warnings', case when (select query from params) is null then jsonb_build_array('A non-empty job search is required.') else '[]'::jsonb end,
    'provenance', jsonb_build_array('public.jobs','public.contacts','public.job_feed','public.job_financial_summary','public.job_tasks','public.job_issues','public.job_assignments','public.time_entries')
  );
$function$;

create or replace function public.hermes_customer_360(
  p_query text,
  p_limit integer default 10
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (
    select nullif(btrim(coalesce(p_query, '')), '') as query,
           least(greatest(coalesce(p_limit, 10), 1), 25) as row_limit
  ),
  matched as (
    select c.*
    from public.contacts c cross join params p
    where p.query is not null
      and (c.id::text = p.query or c.name ilike '%' || p.query || '%'
        or coalesce(c.email,'') ilike '%' || p.query || '%'
        or coalesce(c.phone,'') ilike '%' || p.query || '%')
    order by case when c.id::text = p.query then 0 when lower(c.name) = lower(p.query) then 1 else 2 end,
             c.updated_at desc
    limit (select row_limit from params)
  ),
  records as (
    select jsonb_build_object(
      'customer', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'kind', c.kind, 'updated_at', c.updated_at),
      'summary', jsonb_build_object(
        'lead_count', (select count(*) from public.leads l where l.contact_id = c.id),
        'quote_count', (select count(*) from public.quotes q join public.leads l on l.id = q.lead_id where l.contact_id = c.id),
        'job_count', (select count(*) from public.jobs j where j.contact_id = c.id),
        'contract_amount_cents', coalesce((select sum(coalesce(fs.contract_amount_cents, j.contract_amount_cents, 0)) from public.jobs j left join public.job_financial_summary fs on fs.job_id=j.id where j.contact_id=c.id),0),
        'receivable_cents', coalesce((select sum(greatest(ib.calculated_balance_cents,0)) from public.invoice_balances ib where ib.contact_id=c.id and lower(coalesce(ib.direction,''))='receivable'),0)
      ),
      'jobs', coalesce((
        select jsonb_agg(x.item order by x.updated_at desc)
        from (
          select jsonb_build_object('id',j.id,'name',j.name,'status',j.status,'address',j.formatted_address,'scheduled_on',j.scheduled_on,'started_on',j.started_on,'completed_on',j.completed_on,'updated_at',j.updated_at,'accounting_locked',public.is_historical_job_accounting_locked(j.id)) item,
                 j.updated_at
          from public.jobs j where j.contact_id=c.id order by j.updated_at desc limit 20
        ) x
      ),'[]'::jsonb),
      'leads', coalesce((
        select jsonb_agg(x.item order by x.updated_at desc)
        from (
          select jsonb_build_object('id',l.id,'status',l.status,'pipeline_stage',l.pipeline_stage_raw,'source',l.source,'estimate_scheduled_on',l.estimate_scheduled_on,'updated_at',l.updated_at) item,
                 l.updated_at
          from public.leads l where l.contact_id=c.id order by l.updated_at desc limit 20
        ) x
      ),'[]'::jsonb),
      'open_receivables', coalesce((
        select jsonb_agg(x.item order by x.due_on asc nulls last)
        from (
          select jsonb_build_object('invoice_id',ib.id,'invoice_number',ib.invoice_number,'issued_on',ib.issued_on,'due_on',ib.due_on,'status',ib.status,'balance_cents',greatest(ib.calculated_balance_cents,0)) item,
                 ib.due_on
          from public.invoice_balances ib
          where ib.contact_id=c.id and lower(coalesce(ib.direction,''))='receivable' and greatest(ib.calculated_balance_cents,0)>0
          order by ib.due_on asc nulls last limit 20
        ) x
      ),'[]'::jsonb)
    ) item
    from matched c
  )
  select jsonb_build_object(
    'schema_version',1,'command','customer','as_of',now(),
    'filters',jsonb_build_object('query',p_query,'limit',(select row_limit from params)),
    'match_count',(select count(*) from records),
    'rows',coalesce((select jsonb_agg(item) from records),'[]'::jsonb),
    'warnings',case when (select query from params) is null then jsonb_build_array('A non-empty customer search is required.') else '[]'::jsonb end,
    'provenance',jsonb_build_array('public.contacts','public.leads','public.quotes','public.jobs','public.job_financial_summary','public.invoice_balances')
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
    select l.id as lead_id, l.status, l.pipeline_stage_raw, l.source, l.estimate_scheduled_on,
           l.updated_at, c.id as contact_id, c.name, c.email, c.phone,
           q.id as quote_id, q.name as quote_name, q.status as quote_status, q.amount_cents,
           q.valid_until, q.updated_at as quote_updated_at,
           greatest(l.updated_at, coalesce(q.updated_at,l.updated_at)) as activity_at
    from public.leads l
    join public.contacts c on c.id=l.contact_id
    left join lateral (
      select q0.* from public.quotes q0 where q0.lead_id=l.id order by q0.updated_at desc limit 1
    ) q on true
    cross join params p
    where not exists (select 1 from public.jobs j where j.lead_id=l.id and lower(coalesce(j.status,'')) not in ('cancelled','archived'))
      and lower(coalesce(l.status,'')) not in ('lost','cancelled','won','completed','archived')
      and greatest(l.updated_at, coalesce(q.updated_at,l.updated_at)) < now() - make_interval(days => p.days)
    order by activity_at asc
    limit (select row_limit from params)
  )
  select jsonb_build_object(
    'schema_version',1,'command','followups','as_of',now(),
    'filters',jsonb_build_object('inactive_days',(select days from params),'limit',(select row_limit from params)),
    'summary',jsonb_build_object('candidate_count',(select count(*) from candidates),'quoted_value_cents',coalesce((select sum(amount_cents) from candidates),0)),
    'rows',coalesce((select jsonb_agg(to_jsonb(candidates) order by activity_at) from candidates),'[]'::jsonb),
    'warnings',jsonb_build_array('Candidates are database-only. Check Gmail and Quo before recommending contact.','Do not send messages without explicit user approval.'),
    'provenance',jsonb_build_array('public.leads','public.contacts','public.quotes','public.jobs')
  );
$function$;

create or replace function public.hermes_job_readiness(
  p_days integer default 14,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (
    select least(greatest(coalesce(p_days,14),1),90) days,
           least(greatest(coalesce(p_limit,50),1),200) row_limit
  ),
  rows as (
    select j.id as job_id,j.name,j.status,j.scheduled_on,j.formatted_address,c.name as customer_name,
           exists(select 1 from public.job_budgets b where b.job_id=j.id) has_budget,
           exists(select 1 from public.job_tasks t where t.job_id=j.id) has_tasks,
           exists(select 1 from public.job_assignments a where a.job_id=j.id and lower(coalesce(a.status,'active')) not in ('cancelled','removed')) has_assignment,
           coalesce(cardinality(j.companycam_project_ids),0)>0 has_companycam_project,
           public.is_historical_job_accounting_locked(j.id) accounting_locked
    from public.jobs j left join public.contacts c on c.id=j.contact_id cross join params p
    where j.archived_at is null and j.scheduled_on between current_date and current_date+p.days
    order by j.scheduled_on,j.name limit (select row_limit from params)
  )
  select jsonb_build_object(
    'schema_version',1,'command','readiness','as_of',now(),
    'filters',jsonb_build_object('days',(select days from params),'limit',(select row_limit from params)),
    'summary',jsonb_build_object('scheduled_jobs',(select count(*) from rows),'missing_budget',(select count(*) from rows where not has_budget),'missing_assignment',(select count(*) from rows where not has_assignment),'missing_companycam_project',(select count(*) from rows where not has_companycam_project)),
    'rows',coalesce((select jsonb_agg(to_jsonb(rows) order by scheduled_on,name) from rows),'[]'::jsonb),
    'warnings',jsonb_build_array('CompanyCam project presence does not prove that required photos or checklists are complete.'),
    'provenance',jsonb_build_array('public.jobs','public.contacts','public.job_budgets','public.job_tasks','public.job_assignments')
  );
$function$;

create or replace function public.hermes_cash_summary(p_limit integer default 50)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (select least(greatest(coalesce(p_limit,50),1),200) row_limit),
  open_items as (
    select ib.id as invoice_id,ib.invoice_number,ib.status,ib.issued_on,ib.due_on,c.name as customer_name,
           greatest(ib.calculated_balance_cents,0)::bigint balance_cents,
           case when ib.due_on<current_date then current_date-ib.due_on else 0 end days_overdue
    from public.invoice_balances ib left join public.contacts c on c.id=ib.contact_id
    where lower(coalesce(ib.direction,''))='receivable' and greatest(ib.calculated_balance_cents,0)>0
    order by (ib.due_on<current_date) desc,ib.due_on asc nulls last,balance_cents desc
    limit (select row_limit from params)
  )
  select jsonb_build_object(
    'schema_version',1,'command','cash','as_of',now(),'filters',jsonb_build_object('limit',(select row_limit from params)),
    'summary',jsonb_build_object('open_receivable_cents',coalesce((select sum(greatest(ib.calculated_balance_cents,0)) from public.invoice_balances ib where lower(coalesce(ib.direction,''))='receivable' and greatest(ib.calculated_balance_cents,0)>0),0),'open_invoice_count',(select count(*) from public.invoice_balances ib where lower(coalesce(ib.direction,''))='receivable' and greatest(ib.calculated_balance_cents,0)>0),'overdue_receivable_cents',coalesce((select sum(greatest(ib.calculated_balance_cents,0)) from public.invoice_balances ib where lower(coalesce(ib.direction,''))='receivable' and greatest(ib.calculated_balance_cents,0)>0 and ib.due_on<current_date),0)),
    'rows',coalesce((select jsonb_agg(to_jsonb(open_items) order by days_overdue desc,due_on,balance_cents desc) from open_items),'[]'::jsonb),
    'warnings',jsonb_build_array('Invoice status casing is inconsistent; totals use calculated balances.','Read-only report; it does not create or allocate payments.'),
    'provenance',jsonb_build_array('public.invoice_balances','public.contacts')
  );
$function$;

create or replace function public.hermes_data_quality(p_limit integer default 50)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (select least(greatest(coalesce(p_limit,50),1),200) row_limit),
  issues as (
    select 'scheduled_job_missing_companycam'::text issue,j.id::text record_id,j.name label,j.updated_at
    from public.jobs j where j.archived_at is null and j.scheduled_on>=current_date and coalesce(cardinality(j.companycam_project_ids),0)=0
    union all
    select 'active_job_missing_contact',j.id::text,j.name,j.updated_at from public.jobs j where j.archived_at is null and j.contact_id is null
    union all
    select 'job_missing_start_date',j.id::text,j.name,j.updated_at from public.jobs j where j.archived_at is null and lower(coalesce(j.status,'')) in ('in progress','in_progress','active','completed','complete') and j.started_on is null
    union all
    select 'open_receivable_missing_due_date',ib.id::text,coalesce(ib.invoice_number,ib.id::text),ib.updated_at from public.invoice_balances ib where lower(coalesce(ib.direction,''))='receivable' and greatest(ib.calculated_balance_cents,0)>0 and ib.due_on is null
    union all
    select 'contact_missing_email_and_phone',c.id::text,c.name,c.updated_at from public.contacts c where nullif(btrim(coalesce(c.email,'')),'') is null and nullif(btrim(coalesce(c.phone,'')),'') is null
  ),
  samples as (select * from issues order by updated_at desc limit (select row_limit from params))
  select jsonb_build_object(
    'schema_version',1,'command','data-quality','as_of',now(),'filters',jsonb_build_object('limit',(select row_limit from params)),
    'summary',coalesce((select jsonb_object_agg(issue,n) from (select issue,count(*) n from issues group by issue) x),'{}'::jsonb),
    'rows',coalesce((select jsonb_agg(to_jsonb(samples) order by updated_at desc) from samples),'[]'::jsonb),
    'warnings',jsonb_build_array('These are triage signals, not automatic corrections.','Historical jobs must remain locked unless the user explicitly names one and requests a narrow correction.'),
    'provenance',jsonb_build_array('public.jobs','public.invoice_balances','public.contacts')
  );
$function$;

revoke all on function public.hermes_briefing(integer,integer) from public, anon;
revoke all on function public.hermes_job_360(text,integer) from public, anon;
revoke all on function public.hermes_customer_360(text,integer) from public, anon;
revoke all on function public.hermes_followups(integer,integer) from public, anon;
revoke all on function public.hermes_job_readiness(integer,integer) from public, anon;
revoke all on function public.hermes_cash_summary(integer) from public, anon;
revoke all on function public.hermes_data_quality(integer) from public, anon;

grant execute on function public.hermes_briefing(integer,integer) to authenticated, service_role;
grant execute on function public.hermes_job_360(text,integer) to authenticated, service_role;
grant execute on function public.hermes_customer_360(text,integer) to authenticated, service_role;
grant execute on function public.hermes_followups(integer,integer) to authenticated, service_role;
grant execute on function public.hermes_job_readiness(integer,integer) to authenticated, service_role;
grant execute on function public.hermes_cash_summary(integer) to authenticated, service_role;
grant execute on function public.hermes_data_quality(integer) to authenticated, service_role;
