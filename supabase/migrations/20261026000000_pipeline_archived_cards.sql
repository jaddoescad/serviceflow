-- Archived deals and jobs stay on the board: each column lists them last,
-- faded, in the column they were archived from. Archiving a deal is DripJobs'
-- "Cancel deal" (status cancelled, as the DripJobs import already marks
-- them); restoring puts it back in that column. Cards also carry the
-- customer and drip pause the card menu needs.
begin;

-- The column an archived deal belongs to: where it was archived from, else
-- the imported DripJobs column, else the first column.
create function private.archived_deal_stage(company uuid, raw_stage text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.pipeline_stages s
  where s.org_id = company and s.pipeline = 'sales'
  order by lower(s.name) = lower(btrim(coalesce(raw_stage, ''))) desc, s.position
  limit 1
$$;
revoke all on function private.archived_deal_stage(uuid, text) from public, anon, authenticated;

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
      case when l.status = 'cancelled'
        then coalesce(pp.stage_id, private.archived_deal_stage(l.org_id, l.pipeline_stage_raw))
        else private.current_pipeline_stage(l.id) end as stage_id,
      l.status = 'cancelled' as archived, l.contact_id
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
      and l.status <> 'won'
    union all
    select j.id, j.lead_id, greatest(j.updated_at, pp.moved_at), j.created_at, l.source,
      coalesce(j.formatted_address, j.address_line_1),
      j.name, j.scheduled_on, j.accepted_quote_id, null, j.contract_amount_cents,
      null, null,
      pp.stage_id, pp.moved_at,
      case when j.archived_at is null and j.status <> 'archived' then private.current_pipeline_stage(j.id)
        else coalesce(pp.stage_id, private.derived_pipeline_stage(j.org_id, 'jobs',
          case when j.status in ('scheduled', 'active') then j.status else 'completed' end, null, true)) end,
      j.archived_at is not null or j.status = 'archived', j.contact_id
    from public.jobs j
    left join public.leads l on l.id = j.lead_id
    left join public.pipeline_placements pp on pp.record_id = j.id
    where requested_pipeline = 'jobs' and j.org_id = company
      and j.status in ('scheduled', 'active', 'completed', 'archived')
      and j.is_feed_visible is not false
  ), stages as (
    select s.*,
      (select count(*) from records r where r.stage_id = s.id and not r.archived) as card_count,
      (select coalesce(sum(r.value_cents), 0) from records r where r.stage_id = s.id and not r.archived) as value_cents
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
        'contactId', r.contact_id, 'dripsPaused', coalesce(ds.drips_paused, false),
        'archived', r.archived,
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

create function public.set_deal_archived(requested_record uuid, requested_archived boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  deal public.leads%rowtype;
  column_id uuid;
  stage public.pipeline_stages%rowtype;
begin
  select * into deal from public.leads where id = requested_record for update;
  if not found or not private.is_org_manager(deal.org_id) then
    raise exception 'Deal not found.' using errcode = 'P0002';
  end if;
  perform private.set_acting_org(deal.org_id);

  if requested_archived then
    if deal.status = 'cancelled' then
      return;
    end if;
    if deal.status = 'won' then
      raise exception 'This deal is already a job.' using errcode = '22023';
    end if;
    -- Remember the column so the card stays there, faded, and restores to it.
    column_id := private.current_pipeline_stage(deal.id);
    if column_id is not null then
      insert into public.pipeline_placements as p (record_id, org_id, stage_id)
      values (deal.id, deal.org_id, column_id)
      on conflict (record_id) do update
        set stage_id = excluded.stage_id,
          moved_at = case when p.stage_id = excluded.stage_id then p.moved_at else now() end;
    end if;
    update public.leads set status = 'cancelled', updated_at = now() where id = deal.id;
  else
    if deal.status <> 'cancelled' then
      return;
    end if;
    select * into stage from public.pipeline_stages
    where id = coalesce(
      (select pp.stage_id from public.pipeline_placements pp where pp.record_id = deal.id),
      private.archived_deal_stage(deal.org_id, deal.pipeline_stage_raw));
    if not found then
      raise exception 'Add a column to the sales pipeline first.' using errcode = 'P0002';
    end if;
    update public.leads set status = stage.record_status, updated_at = now() where id = deal.id;
    insert into public.pipeline_placements as p (record_id, org_id, stage_id)
    values (deal.id, deal.org_id, stage.id)
    on conflict (record_id) do update
      set stage_id = excluded.stage_id, moved_at = now(), moved_by = auth.uid();
  end if;
end
$$;
revoke all on function public.set_deal_archived(uuid, boolean) from public, anon;
grant execute on function public.set_deal_archived(uuid, boolean) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
