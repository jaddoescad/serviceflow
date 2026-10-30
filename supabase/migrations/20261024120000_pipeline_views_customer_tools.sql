-- Pipeline saved views and follow-up facts on board cards; the customers
-- list's filters, sorting, bulk tools and CSV import. Everything acts in the
-- signed-in manager's home company (the web admin has no company switcher).
begin;

-- Saved views ----------------------------------------------------------------
-- Each manager's own named filter sets per pipeline. Built-in views (All, My
-- deals, Follow up, ...) live in the web app; only saved ones are stored.

create table public.pipeline_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pipeline text not null check (pipeline in ('sales', 'jobs')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pipeline_views_name_idx
  on public.pipeline_views (user_id, org_id, pipeline, lower(name));

alter table public.pipeline_views enable row level security;
revoke all on public.pipeline_views from anon, authenticated;
grant select on public.pipeline_views to authenticated;
create policy own_read on public.pipeline_views for select to authenticated
  using (user_id = (select auth.uid()) and org_id = (select private.home_org_id()));

create function public.save_pipeline_view(
  requested_id uuid, requested_pipeline text, requested_name text, requested_config jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  clean_name text := btrim(coalesce(requested_name, ''));
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can save pipeline views.' using errcode = '42501';
  end if;
  if requested_id is null or requested_pipeline is null or requested_pipeline not in ('sales', 'jobs') then
    raise exception 'Unknown pipeline.' using errcode = '22023';
  end if;
  if char_length(clean_name) not between 1 and 60 then
    raise exception 'Name the view in 60 characters or fewer.' using errcode = '22023';
  end if;
  if requested_config is null or jsonb_typeof(requested_config) <> 'object'
    or pg_column_size(requested_config) > 8192 then
    raise exception 'That view has too many filters.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.pipeline_views
    where user_id = auth.uid() and org_id = company and pipeline = requested_pipeline
      and lower(name) = lower(clean_name) and id <> requested_id) then
    raise exception 'You already have a view with that name.' using errcode = '23505';
  end if;
  insert into public.pipeline_views as v (id, org_id, user_id, pipeline, name, config)
  values (requested_id, company, auth.uid(), requested_pipeline, clean_name, requested_config)
  on conflict (id) do update set name = excluded.name, config = excluded.config, updated_at = now()
  where v.user_id = auth.uid() and v.org_id = company and v.pipeline = excluded.pipeline;
  if not found then
    raise exception 'View not found.' using errcode = 'P0002';
  end if;
  return requested_id;
end
$$;
revoke all on function public.save_pipeline_view(uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_pipeline_view(uuid, text, text, jsonb) to authenticated;

create function public.delete_pipeline_view(requested_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.pipeline_views
  where id = requested_id and user_id = auth.uid() and org_id = private.home_org_id()
$$;
revoke all on function public.delete_pipeline_view(uuid) from public, anon;
grant execute on function public.delete_pipeline_view(uuid) to authenticated;

-- Board cards ----------------------------------------------------------------
-- Adds what saved views filter on: the project manager, when the card entered
-- its column (the move into it; otherwise when the record was created), the
-- last sent message or note on the record (or a job's deal), and when its
-- proposal was sent and first viewed.

create or replace function public.get_pipeline_board(requested_pipeline text, include_closed boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  result jsonb;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can open the pipeline.' using errcode = '42501';
  end if;
  if requested_pipeline not in ('sales', 'jobs') then
    raise exception 'Unknown pipeline.' using errcode = '22023';
  end if;

  with records as (
    select l.id, l.id as lead_id, greatest(l.updated_at, pp.moved_at) as updated_at, l.created_at,
      l.source, l.address,
      coalesce(nullif(btrim(c.name), ''), 'Unnamed lead') as name,
      l.estimate_appointment_on as date_on,
      q.id as quote_id, q.status as quote_status, q.amount_cents as value_cents,
      q.sent_at as quote_sent_at, q.viewed_at as quote_viewed_at,
      pp.stage_id as placed_stage_id, pp.moved_at as placed_at,
      private.current_pipeline_stage(l.id) as stage_id
    from public.leads l
    left join public.contacts c on c.id = l.contact_id
    left join public.pipeline_placements pp on pp.record_id = l.id
    left join lateral (
      select q.id, q.status, q.amount_cents, q.sent_at, q.viewed_at from public.quotes q
      where q.lead_id = l.id and q.status <> 'superseded'
      order by (q.status in ('sent', 'accepted')) desc, q.updated_at desc
      limit 1
    ) q on true
    where requested_pipeline = 'sales' and l.org_id = company
      and l.status not in ('won', 'cancelled')
    union all
    select j.id, j.lead_id, greatest(j.updated_at, pp.moved_at), j.created_at, l.source,
      coalesce(j.formatted_address, j.address_line_1),
      j.name, j.scheduled_on, j.accepted_quote_id, null, j.contract_amount_cents,
      null, null,
      pp.stage_id, pp.moved_at,
      private.current_pipeline_stage(j.id)
    from public.jobs j
    left join public.leads l on l.id = j.lead_id
    left join public.pipeline_placements pp on pp.record_id = j.id
    where requested_pipeline = 'jobs' and j.org_id = company
      and j.status in ('scheduled', 'active', 'completed')
      and j.archived_at is null and j.is_feed_visible is not false
  ), stages as (
    select s.*,
      (select count(*) from records r where r.stage_id = s.id) as card_count,
      (select coalesce(sum(r.value_cents), 0) from records r where r.stage_id = s.id) as value_cents
    from public.pipeline_stages s
    where s.org_id = company and s.pipeline = requested_pipeline
  )
  select jsonb_build_object(
    'pipeline', requested_pipeline,
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'position', s.position, 'isClosed', s.is_closed,
        'recordStatus', s.record_status, 'dripsEnabled', s.drips_enabled,
        'count', s.card_count, 'valueCents', s.value_cents) order by s.position)
      from stages s), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'stageId', r.stage_id, 'name', r.name, 'source', r.source,
        'address', r.address, 'dateOn', r.date_on, 'valueCents', r.value_cents,
        'quoteId', r.quote_id, 'quoteStatus', r.quote_status, 'updatedAt', r.updated_at,
        'createdAt', r.created_at,
        'stageEnteredAt', case when r.placed_stage_id = r.stage_id then r.placed_at else r.created_at end,
        'lastTouchAt', (
          select max(t.at) from (
            select max(m.sent_at) as at from public.outbound_messages m
            where m.record_id in (r.id, r.lead_id) and m.status = 'sent'
            union all
            select max(n.created_at) from public.project_notes n
            where n.project_id in (r.id, r.lead_id)
          ) t),
        'quoteSentAt', r.quote_sent_at, 'quoteViewedAt', r.quote_viewed_at,
        'salespersonId', ds.salesperson_id, 'salespersonName', e.full_name,
        'projectManagerId', ds.project_manager_id,
        'labels', coalesce((select jsonb_agg(jsonb_build_object(
            'id', pl.id, 'name', pl.name, 'color', pl.color) order by pl.name)
          from public.project_label_links ll
          join public.project_labels pl on pl.id = ll.label_id
          where ll.project_id = r.id), '[]'::jsonb))
        order by r.updated_at desc, r.id)
      from records r
      join stages s on s.id = r.stage_id
      left join public.deal_settings ds on ds.record_id = r.id
      left join public.employees e on e.id = ds.salesperson_id
      where include_closed or not s.is_closed), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

-- Customers list --------------------------------------------------------------
-- The customers table: search, filters (lead source, salesperson on any of
-- their deals, status, created date), sorting and paging. Project counts,
-- address and last activity are derived as get_contacts_page did. Status:
-- open = has an open deal; customer = has a job; lost = a lost deal and
-- nothing open or won.

create function public.get_customer_list(
  search_text text default '',
  filters jsonb default '{}'::jsonb,
  sort_key text default 'activity',
  sort_desc boolean default true,
  page_number integer default 1,
  page_size integer default 50)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
with company as materialized (
  select private.home_org_id() as id
), args as materialized (
  select
    lower(btrim(coalesce(search_text, ''))) as search,
    lower(nullif(btrim(filters ->> 'source'), '')) as source,
    filters ->> 'salesperson' = 'none' as unassigned,
    case when filters ->> 'salesperson' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (filters ->> 'salesperson')::uuid end as salesperson,
    nullif(filters ->> 'status', '') as status,
    case when filters ->> 'createdFrom' ~ '^\d{4}-\d{2}-\d{2}$' then (filters ->> 'createdFrom')::date end as created_from,
    case when filters ->> 'createdTo' ~ '^\d{4}-\d{2}-\d{2}$' then (filters ->> 'createdTo')::date end as created_to,
    least(greatest(coalesce(page_size, 50), 1), 2000) as size
), visible_jobs as (
  select j.*, q.status as quote_status, q.accepted_at, coalesce(q.lead_id, j.lead_id) as project_lead_id,
    coalesce(coalesce(q.lead_id, j.lead_id)::text, j.id::text) as project_key
  from public.jobs j left join public.quotes q on q.id = j.accepted_quote_id
  where j.org_id = (select id from company) and j.contact_id is not null
    and j.is_feed_visible is distinct from false
), ranked as (
  select v.*,
    row_number() over (partition by contact_id, project_key
      order by (quote_status is distinct from 'superseded') desc, accepted_at desc nulls last, updated_at desc nulls last, id) as canonical_rank,
    row_number() over (partition by contact_id, project_key
      order by (status not in ('archived', 'cancelled')) desc, updated_at desc nulls last, id) as fallback_rank
  from visible_jobs v
), good_canonical as (
  select * from ranked
  where canonical_rank = 1 and quote_status is distinct from 'superseded' and status not in ('archived', 'cancelled')
), chosen as (
  select * from good_canonical
  union all
  select r.* from ranked r
  where fallback_rank = 1
    and not exists (select 1 from good_canonical g where g.contact_id = r.contact_id and g.project_key = r.project_key)
), projects as (
  select j.contact_id, j.id, 'job' as kind, coalesce(j.updated_at, j.created_at) as activity,
    nullif(trim(concat_ws(', ', nullif(trim(j.city), ''), nullif(trim(j.province), ''), nullif(trim(j.postal_code), ''))), '') as address
  from chosen j
  union all
  select l.contact_id, l.id, 'lead', coalesce(l.updated_at, l.created_at),
    coalesce(nullif(trim(l.address), ''),
      nullif(trim(concat_ws(', ', nullif(trim(l.city), ''), nullif(trim(l.province), ''), nullif(trim(l.postal_code), ''))), ''))
  from public.leads l
  where l.org_id = (select id from company)
    and not exists (select 1 from chosen j where j.contact_id = l.contact_id and j.project_lead_id = l.id)
), counts as (
  select contact_id, count(*) filter (where kind = 'job') as jobs, count(*) filter (where kind = 'lead') as leads
  from projects group by contact_id
), latest as (
  select distinct on (contact_id) contact_id, address, activity
  from projects order by contact_id, activity desc nulls last, (kind = 'job') desc, id
), deals as (
  select l.contact_id,
    count(*) filter (where l.status not in ('won', 'cancelled', 'lost')) as open_deals,
    bool_or(l.status = 'lost') as any_lost,
    array_agg(distinct lower(btrim(l.source))) filter (where nullif(btrim(l.source), '') is not null) as sources,
    array_agg(distinct ds.salesperson_id) filter (where ds.salesperson_id is not null) as salespeople,
    (array_agg(btrim(l.source) order by l.created_at desc)
      filter (where nullif(btrim(l.source), '') is not null))[1] as latest_source,
    (array_agg(ds.salesperson_id order by (l.status not in ('won', 'cancelled', 'lost')) desc, l.created_at desc)
      filter (where ds.salesperson_id is not null))[1] as salesperson_id
  from public.leads l
  left join public.deal_settings ds on ds.record_id = l.id
  where l.org_id = (select id from company)
  group by l.contact_id
), summaries as (
  select c.id, coalesce(nullif(trim(c.name), ''), 'Unnamed contact') as name,
    nullif(trim(c.email), '') as email, nullif(trim(c.phone), '') as phone,
    case when l.contact_id is not null then l.address else nullif(trim(c.metadata ->> 'address'), '') end as address,
    coalesce(n.jobs, 0) as jobs, coalesce(n.leads, 0) as leads,
    coalesce(d.open_deals, 0) as open_deals, coalesce(d.any_lost, false) as any_lost,
    d.sources, d.salespeople, d.salesperson_id,
    coalesce(d.latest_source, nullif(btrim(c.metadata ->> 'lead_source'), '')) as source,
    c.created_at,
    coalesce(l.activity, c.updated_at, c.created_at, '1970-01-01'::timestamptz) as activity
  from public.contacts c
  left join counts n on n.contact_id = c.id
  left join latest l on l.contact_id = c.id
  left join deals d on d.contact_id = c.id
  where c.org_id = (select id from company) and c.kind = 'customer'
), matched as materialized (
  select s.* from summaries s cross join args a
  where (a.search = '' or exists (
      select 1 from unnest(array[s.name, s.email, s.phone, s.address]) v
      where strpos(lower(coalesce(v, '')), a.search) > 0))
    and (a.source is null or a.source = any(coalesce(s.sources, '{}')) or a.source = lower(coalesce(s.source, '')))
    and (not a.unassigned or s.salespeople is null)
    and (a.salesperson is null or a.salesperson = any(coalesce(s.salespeople, '{}')))
    and (a.status is null
      or (a.status = 'open' and s.open_deals > 0)
      or (a.status = 'customer' and s.jobs > 0)
      or (a.status = 'lost' and s.any_lost and s.open_deals = 0 and s.jobs = 0))
    and (a.created_from is null or (s.created_at at time zone 'America/Toronto')::date >= a.created_from)
    and (a.created_to is null or (s.created_at at time zone 'America/Toronto')::date <= a.created_to)
), totals as (
  select count(*) as total from matched
), ordered as (
  select m.*, row_number() over (order by
      (case when sort_key = 'name' and not sort_desc then m.name end) collate "en-CA-x-icu" asc,
      (case when sort_key = 'name' and sort_desc then m.name end) collate "en-CA-x-icu" desc,
      case when sort_key = 'created' and not sort_desc then m.created_at end asc,
      case when sort_key = 'created' and sort_desc then m.created_at end desc,
      case when sort_key = 'deals' and not sort_desc then m.leads end asc,
      case when sort_key = 'deals' and sort_desc then m.leads end desc,
      case when sort_key = 'jobs' and not sort_desc then m.jobs end asc,
      case when sort_key = 'jobs' and sort_desc then m.jobs end desc,
      case when sort_key = 'activity' and not sort_desc then m.activity end asc,
      m.activity desc, m.name collate "en-CA-x-icu", m.id) as seq
  from matched m
), bounds as (
  select a.size,
    (least(greatest(coalesce(page_number, 1), 1), greatest(1, ((select total from totals) + a.size - 1) / a.size)) - 1)
      * a.size as skip
  from args a
), page as (
  select o.* from ordered o, bounds b where o.seq > b.skip and o.seq <= b.skip + b.size
)
select jsonb_build_object(
  'total', (select total from totals),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'email', p.email, 'phone', p.phone, 'address', p.address,
      'jobCount', p.jobs, 'leadCount', p.leads, 'openDealCount', p.open_deals,
      'projectCount', p.jobs + p.leads, 'source', p.source,
      'salespersonId', p.salesperson_id,
      'salespersonName', (select coalesce(e.full_name, e.email) from public.employees e where e.id = p.salesperson_id),
      'createdAt', p.created_at, 'lastActivityAt', p.activity)
    order by p.seq) from page p), '[]'::jsonb));
$$;
revoke all on function public.get_customer_list(text, jsonb, text, boolean, integer, integer) from public, anon;
grant execute on function public.get_customer_list(text, jsonb, text, boolean, integer, integer) to authenticated;

-- What the customers page offers in its filters, bulk tools and import.
create function public.get_customer_list_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_member(company) then
    raise exception 'You do not have access to this company.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'company', (select jsonb_build_object('id', o.id, 'name', o.name)
      from public.organizations o where o.id = company),
    'sources', coalesce((select jsonb_agg(x.source order by lower(x.source))
      from (
        select distinct on (lower(s.source)) s.source
        from (
          select btrim(l.source) as source from public.leads l
          where l.org_id = company and nullif(btrim(l.source), '') is not null
          union all
          select btrim(c.metadata ->> 'lead_source') from public.contacts c
          where c.org_id = company and c.kind = 'customer' and nullif(btrim(c.metadata ->> 'lead_source'), '') is not null
        ) s
        order by lower(s.source), s.source
      ) x), '[]'::jsonb),
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', coalesce(e.full_name, e.email))
        order by coalesce(e.full_name, e.email))
      from public.org_members m join public.employees e on e.id = m.user_id
      where m.org_id = company and m.is_active), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'dripsEnabled', s.drips_enabled) order by s.position)
      from public.pipeline_stages s
      where s.org_id = company and s.pipeline = 'sales' and not s.is_closed), '[]'::jsonb));
end
$$;
revoke all on function public.get_customer_list_options() from public, anon;
grant execute on function public.get_customer_list_options() to authenticated;

-- Duplicate detection -------------------------------------------------------
-- Emails match lower-cased and trimmed; phones on their last ten digits.

create function private.phone_match_key(value text)
returns text
language sql immutable set search_path = ''
as $$
  select case when length(d) >= 7 then right(d, 10) end
  from (select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') as d) x
$$;
revoke all on function private.phone_match_key(text) from public, anon, authenticated;

create function public.find_customer_matches(requested_emails text[], requested_phones text[])
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can import customers.' using errcode = '42501';
  end if;
  if coalesce(cardinality(requested_emails), 0) > 10000 or coalesce(cardinality(requested_phones), 0) > 10000 then
    raise exception 'Check up to 10,000 rows at a time.' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'email', lower(btrim(c.email)),
      'phoneKey', private.phone_match_key(c.phone)))
    from public.contacts c
    where c.org_id = company and c.kind = 'customer'
      and (lower(btrim(c.email)) = any(coalesce(requested_emails, '{}'))
        or private.phone_match_key(c.phone) = any(coalesce(requested_phones, '{}')))), '[]'::jsonb);
end
$$;
revoke all on function public.find_customer_matches(text[], text[]) from public, anon;
grant execute on function public.find_customer_matches(text[], text[]) to authenticated;

-- CSV import ----------------------------------------------------------------
-- Creates customers in the home company, up to 500 per call, skipping rows
-- that match an existing customer by email or phone. With a column, each new
-- customer also gets a deal there; its drips stay paused unless asked for.
-- Rows carry their own ids, so a retried call reports rows it already made.

create function public.import_customers(
  requested_batch uuid, requested_rows jsonb,
  requested_stage uuid default null, send_drips boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  stage public.pipeline_stages%rowtype;
  item record;
  name_value text;
  email_value text;
  phone_value text;
  address_value text;
  source_value text;
  new_deal uuid;
  created integer := 0;
  duplicates integer := 0;
  invalid integer := 0;
  deals integer := 0;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can import customers.' using errcode = '42501';
  end if;
  if requested_batch is null or jsonb_typeof(requested_rows) is distinct from 'array'
    or jsonb_array_length(requested_rows) > 500 then
    raise exception 'Import up to 500 rows at a time.' using errcode = '22023';
  end if;
  if requested_stage is not null then
    select * into stage from public.pipeline_stages
    where id = requested_stage and org_id = company and pipeline = 'sales' and not is_closed;
    if not found then
      raise exception 'Choose an open sales pipeline column.' using errcode = 'P0002';
    end if;
  end if;
  perform private.set_acting_org(company);

  for item in
    select * from jsonb_to_recordset(requested_rows)
      as x(id uuid, name text, email text, phone text, address text, source text)
  loop
    name_value := nullif(btrim(item.name), '');
    email_value := nullif(lower(btrim(item.email)), '');
    phone_value := nullif(btrim(item.phone), '');
    address_value := nullif(btrim(item.address), '');
    source_value := nullif(btrim(item.source), '');
    if item.id is null or name_value is null or length(name_value) > 160
      or length(email_value) > 320
      or (email_value is not null and email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
      or length(phone_value) > 60 or length(address_value) > 500 or length(source_value) > 120 then
      invalid := invalid + 1;
      continue;
    end if;
    if exists (select 1 from public.contacts where id = item.id) then
      if exists (select 1 from public.contacts where id = item.id and org_id = company
          and metadata ->> 'import_batch' = requested_batch::text) then
        created := created + 1;
        deals := deals + (select count(*) from public.leads
          where contact_id = item.id and metadata ->> 'import_batch' = requested_batch::text);
      else
        invalid := invalid + 1;
      end if;
      continue;
    end if;
    if exists (
      select 1 from public.contacts c
      where c.org_id = company and c.kind = 'customer'
        and ((email_value is not null and lower(btrim(c.email)) = email_value)
          or private.phone_match_key(c.phone) = private.phone_match_key(phone_value))) then
      duplicates := duplicates + 1;
      continue;
    end if;

    insert into public.contacts (id, org_id, kind, name, email, phone, normalized_email, normalized_phone, metadata)
    values (item.id, company, 'customer', name_value, email_value, phone_value, email_value,
      nullif(regexp_replace(coalesce(phone_value, ''), '[^0-9]', '', 'g'), ''),
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'import', 'import_batch', requested_batch, 'created_by', auth.uid(),
        'address', address_value, 'lead_source', source_value)));
    created := created + 1;

    if stage.id is not null then
      new_deal := gen_random_uuid();
      -- Paused before the deal exists, so creating it queues no drips.
      insert into public.deal_settings (record_id, org_id, drips_paused) values (new_deal, company, true);
      insert into public.leads (id, contact_id, org_id, status, source, address, created_at, captured_at, metadata)
      values (new_deal, item.id, company, stage.record_status, source_value, address_value, now(), now(),
        jsonb_build_object('created_by', auth.uid(), 'import_batch', requested_batch));
      insert into public.pipeline_placements (record_id, org_id, stage_id) values (new_deal, company, stage.id);
      if send_drips then
        update public.deal_settings set drips_paused = false, updated_at = now() where record_id = new_deal;
        perform private.sync_drips(new_deal);
      end if;
      deals := deals + 1;
    end if;
  end loop;

  return jsonb_build_object('created', created, 'duplicates', duplicates, 'invalid', invalid, 'deals', deals);
end
$$;
revoke all on function public.import_customers(uuid, jsonb, uuid, boolean) from public, anon;
grant execute on function public.import_customers(uuid, jsonb, uuid, boolean) to authenticated;

-- Bulk tools ------------------------------------------------------------------
-- Act on deals and jobs by id, and on the open deals of chosen customers.
-- Both return how many deals or jobs they covered.

create function private.bulk_targets(company uuid, requested_records uuid[], requested_contacts uuid[])
returns table (id uuid, job_id uuid, lead_id uuid)
language sql stable security definer set search_path = ''
as $$
  select l.id, null::uuid, l.id from public.leads l
  where l.org_id = company
    and (l.id = any(coalesce(requested_records, '{}'))
      or (l.contact_id = any(coalesce(requested_contacts, '{}')) and l.status not in ('won', 'cancelled', 'lost')))
  union
  select j.id, j.id, null::uuid from public.jobs j
  where j.org_id = company and j.id = any(coalesce(requested_records, '{}'))
$$;
revoke all on function private.bulk_targets(uuid, uuid[], uuid[]) from public, anon, authenticated;

create function private.require_bulk_manager(requested_records uuid[], requested_contacts uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change deals and jobs.' using errcode = '42501';
  end if;
  if coalesce(cardinality(requested_records), 0) + coalesce(cardinality(requested_contacts), 0) > 1000 then
    raise exception 'Choose up to 1,000 at a time.' using errcode = '22023';
  end if;
  perform private.set_acting_org(company);
  return company;
end
$$;
revoke all on function private.require_bulk_manager(uuid[], uuid[]) from public, anon, authenticated;

create function public.bulk_assign_salesperson(
  requested_records uuid[], requested_contacts uuid[], requested_salesperson uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.require_bulk_manager(requested_records, requested_contacts);
  covered integer;
begin
  if requested_salesperson is not null and not exists (
    select 1 from public.org_members
    where org_id = company and user_id = requested_salesperson and is_active) then
    raise exception 'Choose someone on your team.' using errcode = '22023';
  end if;
  with targets as (
    select t.id from private.bulk_targets(company, requested_records, requested_contacts) t
  ), written as (
    insert into public.deal_settings as d (record_id, org_id, salesperson_id)
    select t.id, company, requested_salesperson from targets t
    on conflict (record_id) do update set salesperson_id = excluded.salesperson_id, updated_at = now()
    where d.salesperson_id is distinct from excluded.salesperson_id
    returning 1
  )
  select count(*) into covered from targets;
  return covered;
end
$$;
revoke all on function public.bulk_assign_salesperson(uuid[], uuid[], uuid) from public, anon;
grant execute on function public.bulk_assign_salesperson(uuid[], uuid[], uuid) to authenticated;

create function public.bulk_add_label(
  requested_records uuid[], requested_contacts uuid[], requested_label uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.require_bulk_manager(requested_records, requested_contacts);
  covered integer;
begin
  if not exists (select 1 from public.project_labels where id = requested_label and org_id = company) then
    raise exception 'Label not found.' using errcode = 'P0002';
  end if;
  insert into public.project_workspace (project_id, job_id, lead_id, org_id)
  select t.id, t.job_id, t.lead_id, company
  from private.bulk_targets(company, requested_records, requested_contacts) t
  on conflict (project_id) do nothing;
  -- Trashed deals and jobs keep their labels as they are.
  insert into public.project_label_links (project_id, label_id, org_id)
  select t.id, requested_label, company
  from private.bulk_targets(company, requested_records, requested_contacts) t
  join public.project_workspace w on w.project_id = t.id and w.trashed_at is null
  on conflict do nothing;
  select count(*) into covered
  from private.bulk_targets(company, requested_records, requested_contacts) t
  join public.project_workspace w on w.project_id = t.id and w.trashed_at is null;
  return covered;
end
$$;
revoke all on function public.bulk_add_label(uuid[], uuid[], uuid) from public, anon;
grant execute on function public.bulk_add_label(uuid[], uuid[], uuid) to authenticated;

commit;
