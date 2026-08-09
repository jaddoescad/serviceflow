-- Add the identifiers and compact business evidence required by the fast
-- customer RAG command. The function remains read-only and SECURITY INVOKER.

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
        'invoice_count', (select count(*) from public.invoice_balances ib where ib.contact_id = c.id and lower(coalesce(ib.direction, '')) = 'receivable'),
        'contract_amount_cents', coalesce((
          select sum(coalesce(fs.contract_amount_cents, j.contract_amount_cents, 0))
          from public.jobs j
          left join public.job_financial_summary fs on fs.job_id = j.id
          where j.contact_id = c.id
        ), 0),
        'invoiced_cents', coalesce((
          select sum(ib.total_cents)
          from public.invoice_balances ib
          where ib.contact_id = c.id and lower(coalesce(ib.direction, '')) = 'receivable'
        ), 0),
        'receivable_cents', coalesce((
          select sum(greatest(ib.calculated_balance_cents, 0))
          from public.invoice_balances ib
          where ib.contact_id = c.id and lower(coalesce(ib.direction, '')) = 'receivable'
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
            'contract_amount_cents', coalesce(fs.contract_amount_cents, j.contract_amount_cents, 0),
            'receivable_cents', coalesce(fs.receivable_cents, 0),
            'labour_cost_cents', coalesce(fs.labour_cost_cents, 0),
            'material_cost_cents', coalesce(fs.material_cost_cents, 0),
            'total_cost_cents', coalesce(fs.total_cost_cents, 0),
            'source', j.source,
            'updated_at', j.updated_at,
            'accounting_locked', public.is_historical_job_accounting_locked(j.id)
          ) as item,
          j.updated_at
          from public.jobs j
          left join public.job_financial_summary fs on fs.job_id = j.id
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
      ), '[]'::jsonb),
      'invoices', coalesce((
        select jsonb_agg(x.item order by x.issued_on desc nulls last)
        from (
          select jsonb_build_object(
            'id', ib.id,
            'invoice_number', ib.invoice_number,
            'status', ib.status,
            'category', ib.category,
            'issued_on', ib.issued_on,
            'due_on', ib.due_on,
            'total_cents', ib.total_cents,
            'paid_cents', ib.allocated_payment_cents,
            'balance_cents', ib.calculated_balance_cents,
            'source_system', ib.source_system
          ) as item,
          ib.issued_on
          from public.invoice_balances ib
          where ib.contact_id = c.id and lower(coalesce(ib.direction, '')) = 'receivable'
          order by ib.issued_on desc nulls last
          limit 30
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
      'public.jobs',
      'public.job_financial_summary',
      'public.invoice_balances'
    )
  );
$function$;

revoke all on function public.hermes_customer_360(text, integer) from public, anon;
grant execute on function public.hermes_customer_360(text, integer) to authenticated, service_role;
