-- The deal quick view: who owns a deal or job, whether its drips are
-- paused, notes, to-dos, and an activity feed built from what ServiceFlow
-- already records (new leads, proposal and invoice views, payments,
-- appointments, messages, stage moves, notes).
begin;

create table public.deal_settings (
  record_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  salesperson_id uuid references public.employees(id) on delete set null,
  project_manager_id uuid references public.employees(id) on delete set null,
  drips_paused boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.project_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_notes_project_idx on public.project_notes (project_id, created_at desc);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text check (char_length(notes) <= 4000),
  due_on date,
  assigned_to uuid references public.employees(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.employees(id) on delete set null,
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index todos_org_idx on public.todos (org_id, completed_at, due_on);
create index todos_project_idx on public.todos (project_id);

alter table public.deal_settings enable row level security;
alter table public.project_notes enable row level security;
alter table public.todos enable row level security;
revoke all on public.deal_settings, public.project_notes, public.todos from anon, authenticated;
grant select on public.deal_settings, public.project_notes, public.todos to authenticated;
create policy org_member_read on public.deal_settings for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_member_read on public.project_notes for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_member_read on public.todos for select to authenticated
  using (org_id in (select private.my_org_ids()));

create function private.require_project_manager(requested_project uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.org_of_project(requested_project);
begin
  if company is null then
    raise exception 'Deal or job not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can change deals and jobs.' using errcode = '42501';
  end if;
  perform private.set_acting_org(company);
  return company;
end
$$;
revoke all on function private.require_project_manager(uuid) from public, anon, authenticated;

-- Paused deals keep their place but get no new drips; leaving a column still
-- cancels what that column queued.
create or replace function private.sync_drips(target_record uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  current_stage uuid := private.current_pipeline_stage(target_record);
  latest public.drip_enrollments%rowtype;
  stage public.pipeline_stages%rowtype;
  enrollment uuid;
begin
  select * into latest from public.drip_enrollments
  where record_id = target_record and left_at is null
  order by entered_at desc limit 1
  for update;
  if found then
    if latest.stage_id is not distinct from current_stage then
      return;
    end if;
    update public.drip_enrollments set left_at = now() where id = latest.id;
    update public.outbound_messages set status = 'cancelled', error = 'Left the stage before sending.'
    where enrollment_id = latest.id and status = 'queued';
  end if;
  if current_stage is null
    or exists (select 1 from public.deal_settings where record_id = target_record and drips_paused) then
    return;
  end if;
  select * into stage from public.pipeline_stages where id = current_stage;
  if not stage.drips_enabled
    or not exists (select 1 from public.drip_steps where stage_id = stage.id and is_enabled) then
    return;
  end if;
  insert into public.drip_enrollments (org_id, record_id, stage_id)
  values (stage.org_id, target_record, stage.id)
  returning id into enrollment;
  insert into public.outbound_messages (
    org_id, record_id, contact_id, enrollment_id, drip_step_id, channel, subject, body,
    scheduled_for, created_by)
  select stage.org_id, target_record,
    coalesce((select contact_id from public.leads where id = target_record),
      (select contact_id from public.jobs where id = target_record)),
    enrollment, s.id, s.channel, s.subject, s.body,
    now() + make_interval(mins => s.delay_minutes), null
  from public.drip_steps s
  where s.stage_id = stage.id and s.is_enabled;
end
$$;

create function public.set_deal_settings(
  requested_record uuid, requested_salesperson uuid, requested_project_manager uuid,
  requested_drips_paused boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.require_project_manager(requested_record);
begin
  if exists (
    select 1 from unnest(array[requested_salesperson, requested_project_manager]) person
    where person is not null and not exists (
      select 1 from public.org_members
      where org_id = company and user_id = person and is_active)) then
    raise exception 'Choose someone on your team.' using errcode = '22023';
  end if;
  insert into public.deal_settings as d (record_id, org_id, salesperson_id, project_manager_id, drips_paused)
  values (requested_record, company, requested_salesperson, requested_project_manager,
    coalesce(requested_drips_paused, false))
  on conflict (record_id) do update set
    salesperson_id = excluded.salesperson_id, project_manager_id = excluded.project_manager_id,
    drips_paused = excluded.drips_paused, updated_at = now();
  if requested_drips_paused then
    update public.outbound_messages set status = 'cancelled', error = 'Drips paused for this deal.'
    where record_id = requested_record and status = 'queued' and drip_step_id is not null;
  end if;
end
$$;

create function public.save_project_note(requested_id uuid, requested_project uuid, requested_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.require_project_manager(requested_project);
begin
  insert into public.project_notes as n (id, org_id, project_id, body)
  values (requested_id, company, requested_project, btrim(requested_body))
  on conflict (id) do update set body = excluded.body, updated_at = now()
  where n.project_id = requested_project;
  return requested_id;
end
$$;

create function public.delete_project_note(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_project_manager((select project_id from public.project_notes where id = requested_id));
  delete from public.project_notes where id = requested_id;
end
$$;

-- To-dos may stand alone or belong to a deal or job.
create function public.save_todo(
  requested_id uuid, requested_project uuid, requested_title text, requested_notes text,
  requested_due_on date, requested_assigned_to uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := coalesce(
    (select org_id from public.todos where id = requested_id),
    private.org_of_project(requested_project),
    private.home_org_id());
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can edit to-dos.' using errcode = '42501';
  end if;
  if requested_project is not null and private.org_of_project(requested_project) is distinct from company then
    raise exception 'Deal or job not found.' using errcode = 'P0002';
  end if;
  if requested_assigned_to is not null and not exists (
    select 1 from public.org_members where org_id = company and user_id = requested_assigned_to and is_active) then
    raise exception 'Assign someone on your team.' using errcode = '22023';
  end if;
  insert into public.todos as t (id, org_id, project_id, title, notes, due_on, assigned_to)
  values (requested_id, company, requested_project, btrim(requested_title),
    nullif(btrim(requested_notes), ''), requested_due_on, requested_assigned_to)
  on conflict (id) do update set
    project_id = excluded.project_id, title = excluded.title, notes = excluded.notes,
    due_on = excluded.due_on, assigned_to = excluded.assigned_to, updated_at = now()
  where t.org_id = company;
  return requested_id;
end
$$;

create function public.set_todo_done(requested_id uuid, requested_done boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_org_manager((select org_id from public.todos where id = requested_id)) then
    raise exception 'Only managers can edit to-dos.' using errcode = '42501';
  end if;
  update public.todos set
    completed_at = case when requested_done then coalesce(completed_at, now()) end,
    completed_by = case when requested_done then coalesce(completed_by, auth.uid()) end,
    updated_at = now()
  where id = requested_id;
end
$$;

create function public.delete_todo(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_org_manager((select org_id from public.todos where id = requested_id)) then
    raise exception 'Only managers can edit to-dos.' using errcode = '42501';
  end if;
  delete from public.todos where id = requested_id;
end
$$;

create function public.get_todos(requested_filter text default 'open', requested_project uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := coalesce(private.org_of_project(requested_project), private.home_org_id());
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see to-dos.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'projectId', t.project_id, 'projectName', d.name, 'title', t.title,
      'notes', t.notes, 'dueOn', t.due_on, 'assignedTo', t.assigned_to, 'assigneeName', a.full_name,
      'createdByName', c.full_name, 'createdAt', t.created_at, 'completedAt', t.completed_at)
      order by t.completed_at desc nulls first, t.due_on nulls last, t.created_at desc)
    from public.todos t
    left join public.project_directory d on d.id = t.project_id
    left join public.employees a on a.id = t.assigned_to
    left join public.employees c on c.id = t.created_by
    where t.org_id = company
      and (requested_project is null or t.project_id = requested_project)
      and (requested_filter = 'all'
        or (requested_filter = 'open' and t.completed_at is null)
        or (requested_filter = 'done' and t.completed_at is not null))
  ), '[]'::jsonb);
end
$$;

-- Everything that happened on a deal or job, or company-wide when no record
-- is given. Each source is capped before merging so the feed stays fast.
create function public.get_activity_feed(requested_record uuid default null, max_rows integer default 200)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := coalesce(private.org_of_project(requested_record), private.home_org_id());
  lead_ids uuid[];
  job_ids uuid[];
  record_ids uuid[];
  cap integer := least(greatest(coalesce(max_rows, 200), 1), 500);
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see activity.' using errcode = '42501';
  end if;
  if requested_record is not null then
    lead_ids := array(
      select id from public.leads where id = requested_record
      union select lead_id from public.jobs where id = requested_record and lead_id is not null);
    job_ids := array(
      select id from public.jobs where id = requested_record
      union select id from public.jobs where lead_id = requested_record);
    record_ids := lead_ids || job_ids;
  end if;

  return coalesce((
    select jsonb_agg(e order by e ->> 'at' desc)
    from (
      select e from (
        (select jsonb_build_object('at', l.created_at, 'type', 'lead', 'title', 'New lead',
            'detail', l.source, 'recordId', l.id, 'customerName', c.name) as e
         from public.leads l left join public.contacts c on c.id = l.contact_id
         where l.org_id = company and (lead_ids is null or l.id = any(lead_ids))
         order by l.created_at desc limit cap)
        union all
        (select jsonb_build_object('at', ev.at, 'type', ev.kind, 'title', ev.title, 'detail', q.name,
            'recordId', coalesce(j.id, q.lead_id), 'customerName', c.name)
         from public.quotes q
         join public.leads l on l.id = q.lead_id
         left join public.contacts c on c.id = l.contact_id
         left join public.jobs j on j.accepted_quote_id = q.id
         cross join lateral (values
           (q.sent_at, 'proposal_sent', 'Proposal sent'),
           (q.viewed_at, 'proposal_viewed', 'Proposal viewed'),
           (coalesce(q.signed_at, q.accepted_at), 'proposal_accepted', 'Proposal accepted'),
           (q.declined_at, 'proposal_declined', 'Proposal declined')) ev(at, kind, title)
         where q.org_id = company and ev.at is not null and (lead_ids is null or q.lead_id = any(lead_ids))
         order by ev.at desc limit cap)
        union all
        (select jsonb_build_object('at', ev.at, 'type', ev.kind, 'title', ev.title,
            'detail', format('Invoice #%s %s', i.number, i.name), 'recordId', i.job_id, 'customerName', c.name)
         from public.invoices i
         join public.jobs j on j.id = i.job_id
         left join public.contacts c on c.id = j.contact_id
         cross join lateral (values
           (i.sent_at, 'invoice_sent', 'Invoice sent'),
           (i.viewed_at, 'invoice_viewed', 'Invoice viewed')) ev(at, kind, title)
         where i.org_id = company and ev.at is not null and (job_ids is null or i.job_id = any(job_ids))
         order by ev.at desc limit cap)
        union all
        (select jsonb_build_object('at', p.created_at, 'type', 'payment', 'title', 'Payment recorded',
            'detail', format('%s on invoice #%s', to_char(p.amount_cents / 100.0, 'FM$999,999,990.00'), i.number),
            'recordId', i.job_id, 'customerName', c.name)
         from public.invoice_payments p
         join public.invoices i on i.id = p.invoice_id
         join public.jobs j on j.id = i.job_id
         left join public.contacts c on c.id = j.contact_id
         where p.org_id = company and (job_ids is null or i.job_id = any(job_ids))
         order by p.created_at desc limit cap)
        union all
        (select jsonb_build_object('at', ev.at, 'type', ev.kind, 'title', ev.title,
            'detail', format('Change order #%s %s', o.number, o.name), 'recordId', o.job_id, 'customerName', c.name)
         from public.change_orders o
         join public.jobs j on j.id = o.job_id
         left join public.contacts c on c.id = j.contact_id
         cross join lateral (values
           (o.sent_at, 'change_order_sent', 'Change order sent'),
           (o.signed_at, 'change_order_accepted', 'Change order accepted'),
           (o.declined_at, 'change_order_declined', 'Change order declined')) ev(at, kind, title)
         where o.org_id = company and ev.at is not null and (job_ids is null or o.job_id = any(job_ids))
         order by ev.at desc limit cap)
        union all
        (select jsonb_build_object('at', a.created_at, 'type', 'appointment', 'title', 'Appointment scheduled',
            'detail', format('%s · %s', a.title, to_char(a.starts_at at time zone o.timezone, 'Mon DD, HH12:MI AM')),
            'recordId', a.project_id, 'customerName', d.name)
         from public.appointments a
         join public.organizations o on o.id = a.org_id
         left join public.project_directory d on d.id = a.project_id
         where a.org_id = company and (record_ids is null or a.project_id = any(record_ids))
         order by a.created_at desc limit cap)
        union all
        (select jsonb_build_object('at', coalesce(m.sent_at, m.scheduled_for),
            'type', 'message_' || m.status,
            'title', case m.status when 'sent' then (case m.channel when 'email' then 'Email sent' else 'Text sent' end)
              when 'skipped' then 'Message skipped' when 'failed' then 'Message failed' else 'Message cancelled' end,
            'detail', coalesce(m.subject, left(m.body, 120)), 'recordId', m.record_id, 'customerName', c.name)
         from public.outbound_messages m
         left join public.contacts c on c.id = m.contact_id
         where m.org_id = company and m.status in ('sent', 'failed', 'skipped')
           and (record_ids is null or m.record_id = any(record_ids))
         order by coalesce(m.sent_at, m.scheduled_for) desc limit cap)
        union all
        (select jsonb_build_object('at', p.moved_at, 'type', 'stage', 'title', 'Moved to ' || s.name,
            'detail', e.full_name, 'recordId', p.record_id, 'customerName', d.name)
         from public.pipeline_placements p
         join public.pipeline_stages s on s.id = p.stage_id
         left join public.employees e on e.id = p.moved_by
         left join public.project_directory d on d.id = p.record_id
         where p.org_id = company and (record_ids is null or p.record_id = any(record_ids))
         order by p.moved_at desc limit cap)
        union all
        (select jsonb_build_object('at', n.created_at, 'type', 'note', 'title', 'Note added',
            'detail', left(n.body, 160), 'recordId', n.project_id, 'customerName', d.name)
         from public.project_notes n
         left join public.project_directory d on d.id = n.project_id
         where n.org_id = company and (record_ids is null or n.project_id = any(record_ids))
         order by n.created_at desc limit cap)
      ) merged
      order by e ->> 'at' desc
      limit cap
    ) feed(e)
  ), '[]'::jsonb);
end
$$;

-- Everything the quick view shows for one deal or job.
create function public.get_deal_overview(requested_record uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.org_of_project(requested_record);
  lead_row public.leads%rowtype;
  job_row public.jobs%rowtype;
  deal_lead uuid;
  stage public.pipeline_stages%rowtype;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can open deals.' using errcode = '42501';
  end if;
  select * into job_row from public.jobs where id = requested_record;
  if found then
    deal_lead := job_row.lead_id;
  else
    deal_lead := requested_record;
  end if;
  select * into lead_row from public.leads where id = deal_lead;
  select * into stage from public.pipeline_stages where id = private.current_pipeline_stage(requested_record);

  return (select jsonb_build_object(
    'id', requested_record,
    'kind', case when job_row.id is null then 'lead' else 'job' end,
    'leadId', deal_lead,
    'name', coalesce(job_row.name, c.name, 'Unnamed lead'),
    'source', lead_row.source,
    'address', coalesce(job_row.formatted_address, job_row.address_line_1, lead_row.address),
    'createdAt', coalesce(job_row.created_at, lead_row.created_at),
    'valueCents', coalesce(job_row.contract_amount_cents, (
      select q.amount_cents from public.quotes q where q.lead_id = deal_lead and q.status <> 'superseded'
      order by (q.status in ('sent', 'accepted')) desc, q.updated_at desc limit 1)),
    'contact', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone),
    'stage', case when stage.id is null then null
      else jsonb_build_object('id', stage.id, 'name', stage.name, 'pipeline', stage.pipeline) end,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.position)
      from public.pipeline_stages s
      where s.org_id = company and s.pipeline = coalesce(stage.pipeline, case when job_row.id is null then 'sales' else 'jobs' end)), '[]'::jsonb),
    'settings', jsonb_build_object(
      'salespersonId', ds.salesperson_id, 'projectManagerId', ds.project_manager_id,
      'dripsPaused', coalesce(ds.drips_paused, false)),
    'nextDrip', (
      select jsonb_build_object('channel', m.channel, 'subject', m.subject, 'body', left(m.body, 160),
        'scheduledFor', m.scheduled_for)
      from public.outbound_messages m
      where m.record_id = requested_record and m.status = 'queued' and m.drip_step_id is not null
      order by m.scheduled_for limit 1),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'body', n.body, 'createdAt', n.created_at, 'authorName', e.full_name)
        order by n.created_at desc)
      from public.project_notes n left join public.employees e on e.id = n.created_by
      where n.project_id in (requested_record, deal_lead)), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'channel', m.channel, 'subject', m.subject, 'body', m.body, 'status', m.status,
        'error', m.error, 'at', coalesce(m.sent_at, m.scheduled_for), 'isDrip', m.drip_step_id is not null)
        order by coalesce(m.sent_at, m.scheduled_for) desc)
      from public.outbound_messages m
      where m.record_id in (requested_record, deal_lead) and m.status <> 'cancelled'), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'name', q.name, 'status', q.status, 'amountCents', q.amount_cents, 'sentAt', q.sent_at)
        order by q.created_at desc)
      from public.quotes q where q.lead_id = deal_lead and q.status <> 'superseded'), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'startsAt', a.starts_at, 'status', a.status, 'assigneeName', e.full_name)
        order by a.starts_at desc)
      from public.appointments a left join public.employees e on e.id = a.assigned_to
      where a.project_id in (requested_record, deal_lead)), '[]'::jsonb),
    'invoices', case when job_row.id is null then '[]'::jsonb else public.get_invoices(job_row.id) end,
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', coalesce(e.full_name, e.email))
        order by e.full_name)
      from public.org_members om join public.employees e on e.id = om.user_id
      where om.org_id = company and om.is_active), '[]'::jsonb))
  from (select 1) one
  left join public.contacts c on c.id = coalesce(job_row.contact_id, lead_row.contact_id)
  left join public.deal_settings ds on ds.record_id = requested_record);
end
$$;

-- Pipeline cards carry their salesperson for filtering.
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
    select l.id, greatest(l.updated_at, pp.moved_at) as updated_at, l.created_at, l.source, l.address,
      coalesce(nullif(btrim(c.name), ''), 'Unnamed lead') as name,
      l.estimate_appointment_on as date_on,
      q.id as quote_id, q.status as quote_status, q.amount_cents as value_cents,
      private.current_pipeline_stage(l.id) as stage_id
    from public.leads l
    left join public.contacts c on c.id = l.contact_id
    left join public.pipeline_placements pp on pp.record_id = l.id
    left join lateral (
      select q.id, q.status, q.amount_cents from public.quotes q
      where q.lead_id = l.id and q.status <> 'superseded'
      order by (q.status in ('sent', 'accepted')) desc, q.updated_at desc
      limit 1
    ) q on true
    where requested_pipeline = 'sales' and l.org_id = company
      and l.status not in ('won', 'cancelled')
    union all
    select j.id, greatest(j.updated_at, pp.moved_at), j.created_at, l.source,
      coalesce(j.formatted_address, j.address_line_1),
      j.name, j.scheduled_on, j.accepted_quote_id, null, j.contract_amount_cents,
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
        'salespersonId', ds.salesperson_id, 'salespersonName', e.full_name,
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

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'set_deal_settings(uuid, uuid, uuid, boolean)',
    'save_project_note(uuid, uuid, text)',
    'delete_project_note(uuid)',
    'save_todo(uuid, uuid, text, text, date, uuid)',
    'set_todo_done(uuid, boolean)',
    'delete_todo(uuid)',
    'get_todos(text, uuid)',
    'get_activity_feed(uuid, integer)',
    'get_deal_overview(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
