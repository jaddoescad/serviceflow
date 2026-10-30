-- Blasts (one email or text to a whole audience of customers), the public
-- estimate request form that drops new requests into Estimate Requested,
-- and editing a company's pipeline columns.
begin;

-- Blasts -----------------------------------------------------------------

create table public.blasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  audience text not null check (audience in
    ('not_in_pipelines', 'not_in_sales', 'not_in_jobs', 'jobs_only', 'sales_only', 'everyone')),
  channel text not null check (channel in ('email', 'sms')),
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  status text not null default 'draft' check (status in ('draft', 'sent')),
  recipient_count integer not null default 0,
  sent_at timestamptz,
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index blasts_org_idx on public.blasts (org_id, created_at desc);
alter table public.outbound_messages add column blast_id uuid references public.blasts(id) on delete set null;

alter table public.blasts enable row level security;
revoke all on public.blasts from anon, authenticated;
grant select on public.blasts to authenticated;
create policy org_manager_read on public.blasts for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- Customers with somewhere to send the channel, not opted out. "In the sales
-- pipeline" means an open deal; "in the jobs pipeline" means any job.
create function private.blast_audience(company uuid, requested_audience text, requested_channel text)
returns table (contact_id uuid)
language sql stable security definer set search_path = ''
as $$
  select c.id
  from public.contacts c
  cross join lateral (
    select
      exists (select 1 from public.leads l where l.contact_id = c.id and l.status not in ('won', 'cancelled')) as in_sales,
      exists (select 1 from public.jobs j where j.contact_id = c.id and j.status <> 'cancelled' and j.archived_at is null) as in_jobs
  ) p
  where c.org_id = company and c.kind = 'customer'
    and case requested_channel when 'email' then nullif(btrim(c.email), '') is not null
      else nullif(btrim(c.phone), '') is not null end
    and not exists (select 1 from public.message_opt_outs o where o.contact_id = c.id and o.channel = requested_channel)
    and case requested_audience
      when 'not_in_pipelines' then not p.in_sales and not p.in_jobs
      when 'not_in_sales' then not p.in_sales
      when 'not_in_jobs' then not p.in_jobs
      when 'jobs_only' then p.in_jobs
      when 'sales_only' then p.in_sales
      else true end
$$;
revoke all on function private.blast_audience(uuid, text, text) from public, anon, authenticated;

create function public.count_blast_audience(requested_audience text, requested_channel text)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can send blasts.' using errcode = '42501';
  end if;
  return (select count(*) from private.blast_audience(company, requested_audience, requested_channel));
end
$$;

create function public.save_blast(
  requested_id uuid, requested_name text, requested_audience text, requested_channel text,
  requested_subject text, requested_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := coalesce((select org_id from public.blasts where id = requested_id), private.home_org_id());
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can edit blasts.' using errcode = '42501';
  end if;
  if exists (select 1 from public.blasts where id = requested_id and status = 'sent') then
    raise exception 'This blast was already sent.' using errcode = '22023';
  end if;
  if requested_channel = 'email' and nullif(btrim(requested_subject), '') is null then
    raise exception 'Add a subject line.' using errcode = '22023';
  end if;
  insert into public.blasts as b (id, org_id, name, audience, channel, subject, body)
  values (requested_id, company, btrim(requested_name), requested_audience, requested_channel,
    nullif(btrim(requested_subject), ''), btrim(requested_body))
  on conflict (id) do update set
    name = excluded.name, audience = excluded.audience, channel = excluded.channel,
    subject = excluded.subject, body = excluded.body, updated_at = now()
  where b.org_id = company;
  return requested_id;
end
$$;

create function public.send_blast(requested_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  blast public.blasts%rowtype;
  queued integer;
begin
  select * into blast from public.blasts where id = requested_id for update;
  if not found or not private.is_org_manager(blast.org_id) then
    raise exception 'Only managers can send blasts.' using errcode = '42501';
  end if;
  if blast.status = 'sent' then
    raise exception 'This blast was already sent.' using errcode = '22023';
  end if;
  if blast.channel = 'sms' and not exists (
    select 1 from private.org_messaging where org_id = blast.org_id
      and quo_api_key is not null and quo_from_number is not null) then
    raise exception 'Connect Quo in Settings to send texts.' using errcode = '22023';
  end if;
  insert into public.outbound_messages (org_id, contact_id, blast_id, channel, subject, body)
  select blast.org_id, a.contact_id, blast.id, blast.channel, blast.subject, blast.body
  from private.blast_audience(blast.org_id, blast.audience, blast.channel) a;
  get diagnostics queued = row_count;
  update public.blasts set status = 'sent', sent_at = now(), recipient_count = queued, updated_at = now()
  where id = requested_id;
  return queued;
end
$$;

create function public.delete_blast(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  blast public.blasts%rowtype;
begin
  select * into blast from public.blasts where id = requested_id;
  if not found then
    return;
  end if;
  if not private.is_org_manager(blast.org_id) then
    raise exception 'Only managers can delete blasts.' using errcode = '42501';
  end if;
  if blast.status = 'sent' then
    raise exception 'Sent blasts stay as a record.' using errcode = '22023';
  end if;
  delete from public.blasts where id = requested_id;
end
$$;

create function public.get_blasts()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see blasts.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'audience', b.audience, 'channel', b.channel, 'subject', b.subject,
      'body', b.body, 'status', b.status, 'recipientCount', b.recipient_count, 'sentAt', b.sent_at,
      'createdAt', b.created_at,
      'delivered', (select count(*) from public.outbound_messages m where m.blast_id = b.id and m.status = 'sent'),
      'skipped', (select count(*) from public.outbound_messages m where m.blast_id = b.id and m.status in ('skipped', 'failed')))
      order by b.created_at desc)
    from public.blasts b where b.org_id = company
  ), '[]'::jsonb);
end
$$;

-- Estimate request form --------------------------------------------------

create function public.get_request_form(requested_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('companyName', o.name, 'phone', o.phone)
  from public.organizations o
  where o.slug = requested_slug and o.status = 'active'
$$;

-- A customer asks for an estimate. Matches an existing customer by email or
-- phone, opens a deal in Estimate Requested and keeps their message as a note.
create function public.submit_estimate_request(
  requested_slug text, requested_name text, requested_email text, requested_phone text,
  requested_address text, requested_details text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := (select id from public.organizations where slug = requested_slug and status = 'active');
  clean_email text := lower(nullif(btrim(requested_email), ''));
  clean_phone text := nullif(regexp_replace(coalesce(requested_phone, ''), '\D', '', 'g'), '');
  customer uuid;
  deal uuid := gen_random_uuid();
  requested_stage uuid;
begin
  if company is null then
    raise exception 'This request form is not available.' using errcode = 'P0002';
  end if;
  if nullif(btrim(requested_name), '') is null or char_length(requested_name) > 120
    or (clean_email is null and clean_phone is null)
    or char_length(coalesce(requested_email, '')) > 200 or char_length(coalesce(requested_phone, '')) > 40
    or char_length(coalesce(requested_address, '')) > 300 or char_length(coalesce(requested_details, '')) > 4000 then
    raise exception 'Enter your name and an email or phone number.' using errcode = '22023';
  end if;
  if clean_email is not null and clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Check your email address.' using errcode = '22023';
  end if;
  if (select count(*) from public.leads where org_id = company and source = 'Website Request'
      and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'We are receiving a lot of requests. Please call us instead.' using errcode = '54000';
  end if;
  perform set_config('serviceflow.org_id', company::text, true);

  select id into customer from public.contacts
  where org_id = company and kind = 'customer'
    and ((clean_email is not null and lower(email) = clean_email)
      or (clean_phone is not null and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = right(clean_phone, 10)))
  order by updated_at desc limit 1;
  if customer is null then
    customer := gen_random_uuid();
    insert into public.contacts (id, kind, name, email, phone, normalized_email, normalized_phone, metadata, org_id)
    values (customer, 'customer', btrim(requested_name), clean_email, nullif(btrim(requested_phone), ''),
      clean_email, clean_phone, jsonb_build_object('source', 'website_request'), company);
  end if;

  insert into public.leads (id, contact_id, status, source, address, created_at, captured_at, metadata, org_id)
  values (deal, customer, 'contacted', 'Website Request', nullif(btrim(requested_address), ''), now(), now(),
    jsonb_build_object('created_by', 'website_request'), company);
  select id into requested_stage from public.pipeline_stages
  where org_id = company and pipeline = 'sales' and name = 'Estimate Requested';
  if requested_stage is not null then
    insert into public.pipeline_placements (record_id, org_id, stage_id, moved_by)
    values (deal, company, requested_stage, null);
  end if;
  if nullif(btrim(requested_details), '') is not null then
    insert into public.project_notes (org_id, project_id, body, created_by)
    values (company, deal, 'Request: ' || btrim(requested_details), null);
  end if;
end
$$;

-- Pipeline columns ------------------------------------------------------

create function public.save_pipeline_stage(
  requested_id uuid, requested_pipeline text, requested_name text, requested_record_status text,
  requested_is_closed boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.pipeline_stages%rowtype;
  company uuid;
begin
  select * into existing from public.pipeline_stages where id = requested_id for update;
  company := coalesce(existing.org_id, private.home_org_id());
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can edit the pipeline.' using errcode = '42501';
  end if;
  if existing.id is null then
    insert into public.pipeline_stages (id, org_id, pipeline, name, position, record_status, is_closed)
    values (requested_id, company, requested_pipeline, btrim(requested_name),
      coalesce((select max(position) from public.pipeline_stages where org_id = company and pipeline = requested_pipeline), 0) + 1,
      requested_record_status, coalesce(requested_is_closed, false));
  else
    if requested_record_status <> existing.record_status and (
      exists (select 1 from public.pipeline_placements where stage_id = existing.id)
      or not exists (select 1 from public.pipeline_stages where org_id = company and pipeline = existing.pipeline
        and record_status = existing.record_status and id <> existing.id)) then
      raise exception 'Move the cards out of "%" before changing what it counts as.', existing.name using errcode = '22023';
    end if;
    update public.pipeline_stages set name = btrim(requested_name), record_status = requested_record_status,
      is_closed = coalesce(requested_is_closed, false), updated_at = now()
    where id = existing.id;
  end if;
  return requested_id;
end
$$;

create function public.move_pipeline_stage(requested_id uuid, requested_direction integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  stage public.pipeline_stages%rowtype;
  neighbour public.pipeline_stages%rowtype;
begin
  select * into stage from public.pipeline_stages where id = requested_id for update;
  if not found or not private.is_org_manager(stage.org_id) then
    raise exception 'Only managers can edit the pipeline.' using errcode = '42501';
  end if;
  select * into neighbour from public.pipeline_stages
  where org_id = stage.org_id and pipeline = stage.pipeline
    and case when requested_direction < 0 then position < stage.position else position > stage.position end
  order by case when requested_direction < 0 then -position else position end
  limit 1 for update;
  if not found then
    return;
  end if;
  update public.pipeline_stages set position = neighbour.position, updated_at = now() where id = stage.id;
  update public.pipeline_stages set position = stage.position, updated_at = now() where id = neighbour.id;
end
$$;

-- A column can go when no card sits in it by hand and another column still
-- covers its status, so no deal or job is left without a column.
create function public.delete_pipeline_stage(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  stage public.pipeline_stages%rowtype;
begin
  select * into stage from public.pipeline_stages where id = requested_id for update;
  if not found or not private.is_org_manager(stage.org_id) then
    raise exception 'Only managers can edit the pipeline.' using errcode = '42501';
  end if;
  if exists (select 1 from public.pipeline_placements where stage_id = stage.id) then
    raise exception 'Move the cards out of "%" first.', stage.name using errcode = '22023';
  end if;
  if not exists (select 1 from public.pipeline_stages where org_id = stage.org_id and pipeline = stage.pipeline
      and record_status = stage.record_status and id <> stage.id) then
    raise exception '"%" is the last column for its status; add another before deleting it.', stage.name using errcode = '22023';
  end if;
  delete from public.pipeline_stages where id = stage.id;
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'count_blast_audience(text, text)',
    'save_blast(uuid, text, text, text, text, text)',
    'send_blast(uuid)',
    'delete_blast(uuid)',
    'get_blasts()',
    'save_pipeline_stage(uuid, text, text, text, boolean)',
    'move_pipeline_stage(uuid, integer)',
    'delete_pipeline_stage(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array['get_request_form(text)', 'submit_estimate_request(text, text, text, text, text, text)'] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to anon, authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
