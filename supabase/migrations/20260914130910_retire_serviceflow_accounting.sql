-- ServiceFlow only. Dated, dependency-checked accounting removal.
-- All rows and 1006 destination objects verified before this transaction.
-- Private rollback snapshot retained outside Git; no cascading drops.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
lock table public.accounts, public.transactions, public.invoices, public.invoice_lines, public.invoice_job_allocations, public.invoice_line_time_entries, public.transaction_allocations, public.documents, public.evidence_links, public.verification_events, public.acquisition_attributions, private.integration_events in access exclusive mode;
do $check$ begin
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.accounts t) <> '3afeaa8d205ec401b110a77575edca96' then raise exception 'Snapshot changed: accounts'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.transactions t) <> '07cd280da5d93c0c7dfdd5e2202ffacd' then raise exception 'Snapshot changed: transactions'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.invoices t) <> '2563c74bb10130e98ba6dfef0bc109f8' then raise exception 'Snapshot changed: invoices'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.invoice_lines t) <> '31d708dadc7e57c1d8d52237cc16389f' then raise exception 'Snapshot changed: invoice_lines'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.invoice_job_allocations t) <> 'd3f7f77da18fbae01c4faef1b2282930' then raise exception 'Snapshot changed: invoice_job_allocations'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.invoice_line_time_entries t) <> '1a7f6878fa7f16c0e31a7f54600deb97' then raise exception 'Snapshot changed: invoice_line_time_entries'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.transaction_allocations t) <> '36e85c98f33edcfc7e69a0c36b13053f' then raise exception 'Snapshot changed: transaction_allocations'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.documents t) <> '37179f9073cb1043edb338fe944519a9' then raise exception 'Snapshot changed: documents'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.evidence_links t) <> 'e2b02b7fddc5dd11d967b45e3dea8a5d' then raise exception 'Snapshot changed: evidence_links'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.verification_events t) <> 'b09933478d7a53fcb3c000866e15635b' then raise exception 'Snapshot changed: verification_events'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.acquisition_attributions t) <> 'c6e43dcebf1d72a744570f2764814a44' then raise exception 'Snapshot changed: acquisition_attributions'; end if;
if (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from private.integration_events t where provider='material_supplier_portal') <> '505a150f48606154591228a897adf657' then raise exception 'Integration snapshot changed'; end if;
end $check$;
create temp table removal_manifest(table_name text, id uuid, primary key(table_name,id)) on commit drop;
insert into removal_manifest select 'documents',id from public.documents where kind in ('accounting_report','bank_activity_csv','bank_activity_observation','bank_activity_snapshot','bank_csv','bank_feed','bank_feed_snapshot','bank_payment_detail_observation','bank_transfer_batch','bank_transfer_confirmation','bank_transfer_detail','credit_card_csv','credit_card_statement','dripjobs_invoice_observation','etransfer_report','invoice','labour_invoice','management_job_cost_record','material_invoice','needs_review','not_invoice','original_invoice','parking_receipt','payment_receipt','receipt','reconciliation_workbook','supplier_invoice_export','tax_workbook');
insert into removal_manifest select 'evidence_links',id from public.evidence_links where entity_type in ('invoice','transaction') or document_id in(select id from removal_manifest where table_name='documents');
insert into removal_manifest select 'verification_events',id from public.verification_events where entity_type in ('account_balance','bank_allocation','contractor','invoice','invoice_item','invoice_job_allocation','invoice_line','invoice_payment','job_allocation','job_cost_allocation','job_sales_commission','other_payment','payment','payment_event','sales_commission_ledger_row','time_allocation','transaction','transaction_allocation','transaction_sync') or (entity_type='document' and entity_id in(select id::text from removal_manifest where table_name='documents'));
insert into removal_manifest select 'acquisition_attributions',id from public.acquisition_attributions where invoice_id is not null;
insert into removal_manifest select 'integration_events',id from private.integration_events where provider='material_supplier_portal';
do $manifest$ begin
if (select count(*) from removal_manifest where table_name='documents') <> 996 then raise exception 'Manifest differs: documents'; end if;
if (select count(*) from removal_manifest where table_name='evidence_links') <> 1508 then raise exception 'Manifest differs: evidence_links'; end if;
if (select count(*) from removal_manifest where table_name='verification_events') <> 8883 then raise exception 'Manifest differs: verification_events'; end if;
if (select count(*) from removal_manifest where table_name='acquisition_attributions') <> 71 then raise exception 'Manifest differs: acquisition_attributions'; end if;
if (select count(*) from removal_manifest where table_name='integration_events') <> 357 then raise exception 'Manifest differs: integration_events'; end if;
end $manifest$;
do $dependencies$ begin
if exists(select 1 from public.dripjobs_sales_deals t join removal_manifest m on m.id=t.source_document_id and m.table_name='documents') then raise exception 'Operational document dependency: dripjobs_sales_deals'; end if;
if exists(select 1 from public.dripjobs_lead_report_rows t join removal_manifest m on m.id=t.source_document_id and m.table_name='documents') then raise exception 'Operational document dependency: dripjobs_lead_report_rows'; end if;
if exists(select 1 from public.dripjobs_proposal_report_rows t join removal_manifest m on m.id=t.source_document_id and m.table_name='documents') then raise exception 'Operational document dependency: dripjobs_proposal_report_rows'; end if;
if exists(select 1 from public.evidence_links e join removal_manifest d on d.id=e.document_id and d.table_name='documents' where not exists(select 1 from removal_manifest m where m.table_name='evidence_links' and m.id=e.id)) then raise exception 'Unreviewed evidence dependency'; end if;
end $dependencies$;
CREATE OR REPLACE FUNCTION public.hermes_job_360(p_query text, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with params as (
    select nullif(btrim(coalesce(p_query, '')), '') as query,
           least(greatest(coalesce(p_limit, 10), 1), 25) as row_limit
  ),
  matched as (
    select j.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           jf.budget_minutes, jf.used_minutes, jf.budget_percent_used, jf.budget_status,
           public.is_historical_job_accounting_locked(j.id) as accounting_locked
    from public.jobs j
    left join public.contacts c on c.id = j.contact_id
    left join public.job_feed jf on jf.id = j.id
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
    'provenance', jsonb_build_array('public.jobs','public.contacts','public.job_feed','public.job_tasks','public.job_issues','public.job_assignments','public.time_entries')
  );
$function$;

CREATE OR REPLACE FUNCTION public.hermes_briefing(p_days integer DEFAULT 14, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with params as (
    select least(greatest(coalesce(p_days,14),1),90) days,
           least(greatest(coalesce(p_limit,20),1),100) row_limit
  ),
  pipeline as (
    select lower(coalesce(j.status,'unknown')) status,count(*)::integer jobs
    from public.jobs j where j.archived_at is null group by 1
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
      'budget_risk_count',(select count(*) from public.job_feed jf where coalesce(jf.budget_percent_used,0)>=90 and lower(coalesce(jf.status,'')) not in ('completed','complete','archived','cancelled'))
    ),
    'pipeline',coalesce((select jsonb_agg(to_jsonb(pipeline) order by jobs desc) from pipeline),'[]'::jsonb),
    'priorities',jsonb_build_object(
      'job_readiness',coalesce((select jsonb_agg(to_jsonb(readiness_rows) order by scheduled_on,name) from readiness_rows),'[]'::jsonb),
      'budget_risk',coalesce((select jsonb_agg(to_jsonb(budget_rows) order by budget_percent_used desc) from budget_rows),'[]'::jsonb)
    ),
    'warnings',jsonb_build_array('Email, Quo, and CompanyCam activity is not included in this database-only briefing.','Historical accounting locks are surfaced and must never be bypassed.'),
    'provenance',jsonb_build_array('public.jobs','public.job_feed','public.job_budgets','public.job_assignments','public.contacts')
  );
$function$;

CREATE OR REPLACE FUNCTION public.hermes_data_quality(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with params as (select least(greatest(coalesce(p_limit,50),1),200) row_limit),
  issues as (
    select 'scheduled_job_missing_companycam'::text issue,j.id::text record_id,j.name label,j.updated_at
    from public.jobs j where j.archived_at is null and j.scheduled_on>=current_date and coalesce(cardinality(j.companycam_project_ids),0)=0
    union all
    select 'active_job_missing_contact',j.id::text,j.name,j.updated_at from public.jobs j where j.archived_at is null and j.contact_id is null
    union all
    select 'job_missing_start_date',j.id::text,j.name,j.updated_at from public.jobs j where j.archived_at is null and lower(coalesce(j.status,'')) in ('in progress','in_progress','active','completed','complete') and j.started_on is null
    union all
    select 'contact_missing_email_and_phone',c.id::text,c.name,c.updated_at from public.contacts c where nullif(btrim(coalesce(c.email,'')),'') is null and nullif(btrim(coalesce(c.phone,'')),'') is null
  ),
  samples as (select * from issues order by updated_at desc limit (select row_limit from params))
  select jsonb_build_object(
    'schema_version',1,'command','data-quality','as_of',now(),'filters',jsonb_build_object('limit',(select row_limit from params)),
    'summary',coalesce((select jsonb_object_agg(issue,n) from (select issue,count(*) n from issues group by issue) x),'{}'::jsonb),
    'rows',coalesce((select jsonb_agg(to_jsonb(samples) order by updated_at desc) from samples),'[]'::jsonb),
    'warnings',jsonb_build_array('These are triage signals, not automatic corrections.','Historical jobs must remain locked unless the user explicitly names one and requests a narrow correction.'),
    'provenance',jsonb_build_array('public.jobs','public.contacts')
  );
$function$;

CREATE OR REPLACE FUNCTION public.hermes_customer_360(p_query text, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with params as (
    select nullif(btrim(coalesce(p_query, '')), '') as query,
           lower(nullif(btrim(coalesce(p_query, '')), '')) as query_lower,
           regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g') as query_digits,
           least(greatest(coalesce(p_limit, 10), 1), 25) as row_limit
  ),
  matched as (
    select c.*,
           case
             when c.id::text = p.query then 100
             when lower(coalesce(c.email, '')) = p.query_lower then 98
             when p.query_digits <> '' and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = p.query_digits then 97
             when lower(c.name) = p.query_lower then 95
             when lower(c.name) like p.query_lower || '%' then 85
             else 70
           end as match_score
    from public.contacts c
    cross join params p
    where p.query is not null
      and (
        c.id::text = p.query
        or c.name ilike '%' || p.query || '%'
        or coalesce(c.email, '') ilike '%' || p.query || '%'
        or coalesce(c.phone, '') ilike '%' || p.query || '%'
        or (p.query_digits <> '' and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || p.query_digits || '%')
      )
    order by match_score desc, c.updated_at desc
    limit (select row_limit from params)
  ),
  records as (
    select jsonb_build_object(
      'match_score', c.match_score,
      'customer', jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'email', c.email,
        'phone', c.phone,
        'kind', c.kind,
        'updated_at', c.updated_at
      ),
      'summary', jsonb_build_object(
        'lead_count', (select count(*) from public.leads l where l.contact_id = c.id),
        'quote_count', (
          select count(*)
          from public.quotes q
          join public.leads l on l.id = q.lead_id
          where l.contact_id = c.id
        ),
        'job_count', (select count(*) from public.jobs j where j.contact_id = c.id),
        'contract_amount_cents', coalesce((
          select sum(coalesce(j.contract_amount_cents, 0))
          from public.jobs j
          where j.contact_id = c.id
        ), 0)
      ),
      'jobs', coalesce((
        select jsonb_agg(x.item order by x.updated_at desc)
        from (
          select jsonb_build_object(
            'id', j.id,
            'name', j.name,
            'status', j.status,
            'address', j.formatted_address,
            'scheduled_on', j.scheduled_on,
            'started_on', j.started_on,
            'completed_on', j.completed_on,
            'companycam_project_ids', to_jsonb(j.companycam_project_ids),
            'contract_amount_cents', coalesce(j.contract_amount_cents, 0),
            'source', j.source,
            'updated_at', j.updated_at,
            'accounting_locked', public.is_historical_job_accounting_locked(j.id)
          ) as item,
          j.updated_at
          from public.jobs j
          where j.contact_id = c.id
          order by j.updated_at desc
          limit 20
        ) x
      ), '[]'::jsonb),
      'leads', coalesce((
        select jsonb_agg(x.item order by x.updated_at desc)
        from (
          select jsonb_build_object(
            'id', l.id,
            'status', l.status,
            'pipeline_stage', l.pipeline_stage_raw,
            'source', l.source,
            'address', l.address,
            'estimate_scheduled_on', l.estimate_scheduled_on,
            'captured_at', l.captured_at,
            'updated_at', l.updated_at
          ) as item,
          l.updated_at
          from public.leads l
          where l.contact_id = c.id
          order by l.updated_at desc
          limit 20
        ) x
      ), '[]'::jsonb),
      'quotes', coalesce((
        select jsonb_agg(x.item order by x.updated_at desc)
        from (
          select jsonb_build_object(
            'id', q.id,
            'proposal_id', q.dripjobs_proposal_id,
            'lead_id', q.lead_id,
            'name', q.name,
            'status', q.status,
            'amount_cents', q.amount_cents,
            'tax_cents', q.tax_cents,
            'accepted_at', q.accepted_at,
            'valid_until', q.valid_until,
            'source', q.source,
            'created_at', q.created_at,
            'updated_at', q.updated_at
          ) as item,
          q.updated_at
          from public.quotes q
          join public.leads l on l.id = q.lead_id
          where l.contact_id = c.id
          order by q.updated_at desc
          limit 20
        ) x
      ), '[]'::jsonb)
    ) as item
    from matched c
  )
  select jsonb_build_object(
    'schema_version', 1,
    'retrieval_version', 'customer-rag-v1',
    'command', 'customer',
    'as_of', now(),
    'filters', jsonb_build_object('query', p_query, 'limit', (select row_limit from params)),
    'match_count', (select count(*) from records),
    'rows', coalesce((select jsonb_agg(item) from records), '[]'::jsonb),
    'warnings', case
      when (select query from params) is null then jsonb_build_array('A non-empty customer search is required.')
      else '[]'::jsonb
    end,
    'provenance', jsonb_build_array(
      'public.contacts',
      'public.leads',
      'public.quotes',
      'public.jobs'
    )
  );
$function$;


drop view public.accounting_exceptions;
drop view public.invoice_balances;
drop view public.job_financial_summary;
drop function public.hermes_cash_summary(integer);
delete from public.acquisition_attributions t using removal_manifest m where m.table_name='acquisition_attributions' and t.id=m.id;
alter table public.acquisition_attributions drop constraint acquisition_attributions_invoice_id_fkey;
drop table public.invoice_line_time_entries;
drop table public.transaction_allocations;
drop table public.invoice_job_allocations;
drop table public.invoice_lines;
drop table public.invoices;
drop table public.transactions;
drop table public.accounts;
delete from public.evidence_links t using removal_manifest m where m.table_name='evidence_links' and t.id=m.id;
delete from public.verification_events t using removal_manifest m where m.table_name='verification_events' and t.id=m.id;
delete from public.documents t using removal_manifest m where m.table_name='documents' and t.id=m.id;
delete from private.integration_events t using removal_manifest m where m.table_name='integration_events' and t.id=m.id;
notify pgrst,'reload schema';
commit;
