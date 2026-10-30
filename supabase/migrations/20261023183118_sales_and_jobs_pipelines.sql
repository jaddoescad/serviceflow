-- Sales and jobs pipelines: each company's board columns, and which column a
-- lead or job sits in. Leads and jobs keep their status; a column maps to the
-- status its cards have, so moving a card also sets that status. A record with
-- no placement (or whose status changed elsewhere) shows in the column its
-- status implies.
begin;

-- The web admin has no company switcher. People in several companies act in
-- the one they joined first.
create function private.home_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.is_active and o.status = 'active'
  order by m.created_at, m.org_id
  limit 1
$$;
revoke all on function private.home_org_id() from public, anon;
grant execute on function private.home_org_id() to authenticated;

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.acting_org_id()
    references public.organizations(id) on delete cascade,
  pipeline text not null check (pipeline in ('sales', 'jobs')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position integer not null,
  record_status text not null,
  -- Lost deals and finished jobs stay hidden until asked for.
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, pipeline, name),
  check (
    (pipeline = 'sales' and record_status in
      ('new', 'contacted', 'estimate_scheduled', 'estimated', 'proposal_sent', 'lost'))
    or (pipeline = 'jobs' and record_status in ('scheduled', 'active', 'completed'))
  )
);
create index pipeline_stages_org_idx on public.pipeline_stages (org_id, pipeline, position);

create table public.pipeline_placements (
  record_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  moved_at timestamptz not null default now(),
  moved_by uuid default auth.uid() references public.employees(id) on delete set null
);
create index pipeline_placements_stage_idx on public.pipeline_placements (stage_id);

create function private.pipeline_placement_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  stage public.pipeline_stages%rowtype;
  record_org uuid;
begin
  select * into stage from public.pipeline_stages where id = new.stage_id;
  if stage.pipeline = 'sales' then
    select org_id into record_org from public.leads where id = new.record_id;
  else
    select org_id into record_org from public.jobs where id = new.record_id;
  end if;
  if record_org is null or record_org <> stage.org_id then
    raise exception 'That card does not belong in this pipeline.' using errcode = '42501';
  end if;
  new.org_id := stage.org_id;
  return new;
end
$$;
revoke all on function private.pipeline_placement_guard() from public, anon, authenticated;
create trigger pipeline_placement_guard before insert or update on public.pipeline_placements
  for each row execute function private.pipeline_placement_guard();

-- DripJobs' columns, so Ottawa Painters' imported stage names line up.
create function private.seed_pipeline_stages(company uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.pipeline_stages (org_id, pipeline, name, position, record_status, is_closed)
  select company, s.pipeline, s.name, s.position, s.record_status, s.is_closed
  from (values
    ('sales', 'Cold Leads', 1, 'new', false),
    ('sales', 'Warm Leads', 2, 'contacted', false),
    ('sales', 'Rejected Lead', 3, 'lost', true),
    ('sales', 'Estimate Requested', 4, 'contacted', false),
    ('sales', 'Estimate Scheduled', 5, 'estimate_scheduled', false),
    ('sales', 'In Draft', 6, 'estimated', false),
    ('sales', 'Proposal(s) Sent', 7, 'proposal_sent', false),
    ('sales', 'Proposal On Hold (0-1 month)', 8, 'proposal_sent', false),
    ('sales', 'Proposal On Hold (1-6months)', 9, 'proposal_sent', false),
    ('sales', 'Proposal(s) Rejected', 10, 'lost', true),
    ('jobs', 'Project Accepted', 1, 'scheduled', false),
    ('jobs', 'Pending Schedule', 2, 'scheduled', false),
    ('jobs', 'Project Scheduled', 3, 'scheduled', false),
    ('jobs', 'Project In Progress', 4, 'active', false),
    ('jobs', 'Work Finished', 5, 'completed', false),
    ('jobs', 'Review Request', 6, 'completed', false),
    ('jobs', 'Project Complete', 7, 'completed', true)
  ) as s(pipeline, name, position, record_status, is_closed)
  on conflict (org_id, pipeline, name) do nothing
$$;
revoke all on function private.seed_pipeline_stages(uuid) from public, anon, authenticated;

create function private.seed_new_company_pipelines()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.seed_pipeline_stages(new.id);
  return new;
end
$$;
revoke all on function private.seed_new_company_pipelines() from public, anon, authenticated;
create trigger seed_pipelines after insert on public.organizations
  for each row execute function private.seed_new_company_pipelines();

select private.seed_pipeline_stages(id) from public.organizations;

-- The column a record's status implies. Several columns can share a status:
-- the imported DripJobs stage name wins, then lost deals that had a proposal,
-- finished jobs and jobs with a date go to the last such column.
create function private.derived_pipeline_stage(
  company uuid, requested_pipeline text, record_status text, raw_stage text, prefer_last boolean)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.pipeline_stages s
  where s.org_id = company and s.pipeline = requested_pipeline and s.record_status = $3
  order by lower(s.name) = lower(btrim(coalesce(raw_stage, ''))) desc,
    case when prefer_last then -s.position else s.position end
  limit 1
$$;
revoke all on function private.derived_pipeline_stage(uuid, text, text, text, boolean) from public, anon, authenticated;

-- One query per board: every open card with what its card shows. Closed
-- columns report counts and totals; their cards load only when asked for.
create function public.get_pipeline_board(requested_pipeline text, include_closed boolean default false)
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
    select l.id, l.updated_at, l.status, l.source, l.address,
      coalesce(nullif(btrim(c.name), ''), 'Unnamed lead') as name,
      l.estimate_appointment_on as date_on,
      q.id as quote_id, q.status as quote_status, q.amount_cents as value_cents,
      coalesce(
        (select p.stage_id from public.pipeline_placements p
         join public.pipeline_stages s on s.id = p.stage_id
         where p.record_id = l.id and s.record_status = l.status),
        private.derived_pipeline_stage(l.org_id, 'sales', l.status, l.pipeline_stage_raw,
          l.status = 'lost' and q.id is not null)) as stage_id
    from public.leads l
    left join public.contacts c on c.id = l.contact_id
    left join lateral (
      select q.id, q.status, q.amount_cents from public.quotes q
      where q.lead_id = l.id and q.status <> 'superseded'
      order by (q.status in ('sent', 'accepted')) desc, q.updated_at desc
      limit 1
    ) q on true
    where requested_pipeline = 'sales' and l.org_id = company
      and l.status not in ('won', 'cancelled')
    union all
    select j.id, j.updated_at, j.status, l.source,
      coalesce(j.formatted_address, j.address_line_1),
      j.name, j.scheduled_on, j.accepted_quote_id, null, j.contract_amount_cents,
      coalesce(
        (select p.stage_id from public.pipeline_placements p
         join public.pipeline_stages s on s.id = p.stage_id
         where p.record_id = j.id and s.record_status = j.status),
        private.derived_pipeline_stage(j.org_id, 'jobs', j.status, null,
          j.status = 'completed' or (j.status = 'scheduled' and j.scheduled_on is not null)))
    from public.jobs j
    left join public.leads l on l.id = j.lead_id
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
        'count', s.card_count, 'valueCents', s.value_cents) order by s.position)
      from stages s), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'stageId', r.stage_id, 'name', r.name, 'source', r.source,
        'address', r.address, 'dateOn', r.date_on, 'valueCents', r.value_cents,
        'quoteId', r.quote_id, 'quoteStatus', r.quote_status, 'updatedAt', r.updated_at,
        'labels', coalesce((select jsonb_agg(jsonb_build_object(
            'id', pl.id, 'name', pl.name, 'color', pl.color) order by pl.name)
          from public.project_label_links ll
          join public.project_labels pl on pl.id = ll.label_id
          where ll.project_id = r.id), '[]'::jsonb))
        order by r.updated_at desc, r.id)
      from records r join stages s on s.id = r.stage_id
      where include_closed or not s.is_closed), '[]'::jsonb)
  ) into result;
  return result;
end
$$;
revoke all on function public.get_pipeline_board(text, boolean) from public, anon;
grant execute on function public.get_pipeline_board(text, boolean) to authenticated;

-- Moving a card sets the record's status to the column's; jobs go through
-- set_job_status so completion dates and labour budgets follow.
create function public.move_pipeline_card(requested_record uuid, requested_stage uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target public.pipeline_stages%rowtype;
  current_status text;
begin
  select * into target from public.pipeline_stages where id = requested_stage;
  if not found then
    raise exception 'Column not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(target.org_id) then
    raise exception 'Only managers can move cards.' using errcode = '42501';
  end if;
  perform private.set_acting_org(target.org_id);

  if target.pipeline = 'sales' then
    select status into current_status from public.leads
    where id = requested_record and org_id = target.org_id for update;
    if not found then
      raise exception 'Deal not found.' using errcode = 'P0002';
    end if;
    if current_status in ('won', 'cancelled') then
      raise exception 'This deal is already closed.' using errcode = '22023';
    end if;
    if current_status <> target.record_status then
      update public.leads set status = target.record_status, updated_at = now()
      where id = requested_record;
    end if;
  else
    select status into current_status from public.jobs
    where id = requested_record and org_id = target.org_id for update;
    if not found then
      raise exception 'Job not found.' using errcode = 'P0002';
    end if;
    if current_status not in ('scheduled', 'active', 'completed') then
      raise exception 'This job is cancelled or archived.' using errcode = '22023';
    end if;
    if current_status <> target.record_status then
      perform private.set_job_status__unscoped(requested_record, target.record_status);
    end if;
  end if;

  insert into public.pipeline_placements (record_id, org_id, stage_id)
  values (requested_record, target.org_id, target.id)
  on conflict (record_id) do update
    set stage_id = excluded.stage_id, moved_at = now(), moved_by = auth.uid();
end
$$;
revoke all on function public.move_pipeline_card(uuid, uuid) from public, anon;
grant execute on function public.move_pipeline_card(uuid, uuid) to authenticated;

alter table public.pipeline_stages enable row level security;
alter table public.pipeline_placements enable row level security;
revoke all on public.pipeline_stages, public.pipeline_placements from anon, authenticated;
grant select on public.pipeline_stages, public.pipeline_placements to authenticated;

create policy org_member_read on public.pipeline_stages for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_member_read on public.pipeline_placements for select to authenticated
  using (org_id in (select private.my_org_ids()));

select pg_notify('pgrst', 'reload schema');

commit;
