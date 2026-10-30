-- Drips: more placeholders (filled as each message goes out), live previews
-- and test sends from the step editor, review-request and aftercare
-- templates for a completed jobs stage, and per-deal pause/resume and skip.
-- Each stage keeps its one list of steps; drip_steps and drip_enrollments
-- are unchanged.
begin;

-- Placeholders ---------------------------------------------------------------

-- Customer and company placeholders. The queue, inbox and activity list
-- call this for every message they show or send.
create or replace function private.fill_placeholders(template text, customer text, company text, company_phone text)
returns text
language sql immutable set search_path = ''
as $$
  select replace(replace(replace(replace(replace(replace(template,
    '{{first_name}}', coalesce(nullif(split_part(btrim(coalesce(customer, '')), ' ', 1), ''), 'there')),
    '{{last_name}}', btrim(regexp_replace(btrim(coalesce(customer, '')), '^\S+\s*', ''))),
    '{{full_name}}', btrim(coalesce(customer, ''))),
    '{{name}}', btrim(coalesce(customer, ''))),
    '{{company}}', coalesce(company, '')),
    '{{company_phone}}', coalesce(company_phone, ''))
$$;
revoke all on function private.fill_placeholders(text, text, text, text) from public, anon, authenticated;

-- Every drip placeholder's value for one deal or job, keyed by name without
-- braces. Proposal and document links need the site address, so they are
-- only filled when one is given (the send-messages function fills them
-- otherwise). With make_portal a customer without a portal link gets one.
create function private.placeholder_values(
  target_record uuid, company uuid, customer_id uuid, base_url text, make_portal boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  org public.organizations%rowtype;
  job_row public.jobs%rowtype;
  lead_row public.leads%rowtype;
  customer public.contacts%rowtype;
  seller public.employees%rowtype;
  next_visit timestamptz;
  site text := coalesce(nullif(rtrim(btrim(base_url), '/'), ''), 'https://serviceflow-admin.vercel.app');
  full_name text;
  portal text;
  proposal text;
  result jsonb;
begin
  select * into org from public.organizations where id = company;
  if target_record is not null then
    select * into job_row from public.jobs where id = target_record and org_id = company;
    select * into lead_row from public.leads where id = coalesce(job_row.lead_id, target_record) and org_id = company;
  end if;
  select * into customer from public.contacts
  where id = coalesce(customer_id, job_row.contact_id, lead_row.contact_id) and org_id = company;
  -- A job without its own salesperson uses its deal's.
  select e.* into seller
  from public.deal_settings d
  join public.employees e on e.id = d.salesperson_id
  where d.org_id = company and d.record_id in (target_record, lead_row.id)
  order by d.record_id = target_record desc
  limit 1;
  select min(a.starts_at) into next_visit
  from public.appointments a
  where a.org_id = company and a.project_id in (target_record, lead_row.id)
    and a.status = 'scheduled' and a.starts_at > now();
  if customer.id is not null and customer.kind = 'customer' then
    if make_portal then
      insert into public.customer_portals (contact_id, org_id, token)
      values (customer.id, company, private.new_public_token())
      on conflict (contact_id) do nothing;
    end if;
    select site || '/portal/' || p.token into portal
    from public.customer_portals p where p.contact_id = customer.id and p.org_id = company;
  end if;

  full_name := btrim(coalesce(customer.name, ''));
  result := jsonb_build_object(
    'first_name', coalesce(nullif(split_part(full_name, ' ', 1), ''), 'there'),
    'last_name', btrim(regexp_replace(full_name, '^\S+\s*', '')),
    'full_name', full_name,
    'name', full_name,
    'company', coalesce(org.name, ''),
    'company_phone', coalesce(org.phone, ''),
    'salesperson_name', coalesce(btrim(seller.full_name), ''),
    'salesperson_phone', coalesce(btrim(seller.phone), ''),
    'project_address', coalesce(nullif(btrim(job_row.formatted_address), ''), nullif(btrim(job_row.address_line_1), ''),
      nullif(btrim(lead_row.address), ''), ''),
    'appointment_date', coalesce(to_char(next_visit at time zone org.timezone, 'FMDay, FMMonth FMDD'), ''),
    'appointment_time', coalesce(to_char(next_visit at time zone org.timezone, 'FMHH12:MI AM'), ''),
    'review_link', coalesce(org.settings #>> '{reviews,link}', ''),
    'portal_link', coalesce(portal, ''));
  if base_url is not null then
    select site || '/p/' || q.public_token into proposal
    from public.quotes q
    where q.lead_id = lead_row.id and q.status in ('sent', 'accepted') and q.public_token is not null
    order by q.sent_at desc nulls last
    limit 1;
    result := result || jsonb_build_object('proposal_link', coalesce(proposal, ''), 'document_link', coalesce(proposal, ''));
  end if;
  return result;
end
$$;
revoke all on function private.placeholder_values(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;

-- Made-up customer and deal for previews and test sends without a deal; the
-- company, its review link and the signed-in salesperson are real.
create function private.sample_placeholder_values(company uuid, base_url text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'first_name', 'Alex', 'last_name', 'Martin', 'full_name', 'Alex Martin', 'name', 'Alex Martin',
    'company', o.name, 'company_phone', coalesce(o.phone, ''),
    'salesperson_name', coalesce(btrim(e.full_name), ''), 'salesperson_phone', coalesce(btrim(e.phone), ''),
    'project_address', '123 Main Street',
    'appointment_date', to_char((now() at time zone coalesce(o.timezone, 'America/Toronto'))::date + 2, 'FMDay, FMMonth FMDD'),
    'appointment_time', '10:00 AM',
    'review_link', coalesce(o.settings #>> '{reviews,link}', ''),
    'portal_link', site || '/portal/example',
    'proposal_link', site || '/p/example',
    'document_link', site || '/p/example')
  from public.organizations o
  cross join (select coalesce(nullif(rtrim(btrim(base_url), '/'), ''), 'https://serviceflow-admin.vercel.app') as site) s
  left join public.employees e on e.id = auth.uid()
  where o.id = company
$$;
revoke all on function private.sample_placeholder_values(uuid, text) from public, anon, authenticated;

create function private.render_placeholders(template text, vals jsonb)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  item record;
  result text := template;
begin
  if result is null or strpos(result, '{{') = 0 then
    return result;
  end if;
  for item in select key, value from jsonb_each_text(coalesce(vals, '{}'::jsonb)) loop
    result := replace(result, '{{' || item.key || '}}', coalesce(item.value, ''));
  end loop;
  return result;
end
$$;
revoke all on function private.render_placeholders(text, jsonb) from public, anon, authenticated;

-- Deal placeholders are filled as the queue claims a message, so a drip
-- queued days ago still names the current salesperson and next visit.
-- Proposal and document links are left for the send-messages function. A
-- failure leaves the text as it was rather than holding up the queue.
create function private.fill_message_on_claim()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  text_in text := coalesce(new.subject, '') || coalesce(new.body, '');
  vals jsonb;
begin
  if strpos(text_in, '{{') = 0 then
    return new;
  end if;
  begin
    vals := private.placeholder_values(new.record_id, new.org_id, new.contact_id, null,
      strpos(text_in, '{{portal_link}}') > 0);
    new.subject := left(private.render_placeholders(new.subject, vals), 200);
    new.body := left(private.render_placeholders(new.body, vals), 10000);
  exception when others then
    raise warning 'Placeholder fill failed for message %: %', new.id, sqlerrm;
  end;
  return new;
end
$$;
revoke all on function private.fill_message_on_claim() from public, anon, authenticated;

create trigger fill_placeholders_on_claim
  before update of status on public.outbound_messages
  for each row when (old.status = 'queued' and new.status = 'sending')
  execute function private.fill_message_on_claim();

-- Previews and test sends ------------------------------------------------------

-- Deals and jobs to preview a step against: the pipeline's most recent.
create function public.get_drip_preview_records(requested_pipeline text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can preview drips.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.updated_at desc)
    from (
      select l.id, coalesce(nullif(btrim(c.name), ''), 'Unnamed lead') as name, l.updated_at
      from public.leads l
      left join public.contacts c on c.id = l.contact_id
      where requested_pipeline = 'sales' and l.org_id = company and l.status not in ('won', 'cancelled')
      union all
      select j.id, j.name, j.updated_at
      from public.jobs j
      where requested_pipeline = 'jobs' and j.org_id = company
        and j.status in ('scheduled', 'active', 'completed')
        and j.archived_at is null and j.is_feed_visible is not false
      order by updated_at desc
      limit 40
    ) r
  ), '[]'::jsonb);
end
$$;

-- A step's subject and message as one deal (or the sample customer) would
-- get them, and which placeholders it uses that have no value there.
create function public.preview_drip_message(
  requested_subject text, requested_body text, requested_record uuid, requested_base_url text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  template text := coalesce(requested_subject, '') || ' ' || coalesce(requested_body, '');
  vals jsonb;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can preview drips.' using errcode = '42501';
  end if;
  if requested_record is not null and private.org_of_project(requested_record) is distinct from company then
    raise exception 'Deal or job not found.' using errcode = 'P0002';
  end if;
  vals := case when requested_record is null
    then private.sample_placeholder_values(company, requested_base_url)
    else private.placeholder_values(requested_record, company, null, requested_base_url,
      strpos(template, '{{portal_link}}') > 0) end;
  return jsonb_build_object(
    'subject', private.render_placeholders(requested_subject, vals),
    'body', private.render_placeholders(requested_body, vals),
    'empty', coalesce((
      select jsonb_agg(v.key order by v.key) from jsonb_each_text(vals) v
      where coalesce(v.value, '') = '' and strpos(template, '{{' || v.key || '}}') > 0), '[]'::jsonb));
end
$$;

-- Queues a step, filled for one deal (or the sample customer), to the
-- signed-in person instead of the customer. Returns where it goes.
create function public.send_drip_test(
  requested_channel text, requested_subject text, requested_body text, requested_record uuid,
  requested_base_url text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  template text := coalesce(requested_subject, '') || ' ' || coalesce(requested_body, '');
  me public.employees%rowtype;
  address text;
  vals jsonb;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can send test messages.' using errcode = '42501';
  end if;
  if requested_channel is null or requested_channel not in ('email', 'sms')
    or nullif(btrim(requested_body), '') is null then
    raise exception 'Write a message to send.' using errcode = '22023';
  end if;
  if requested_record is not null and private.org_of_project(requested_record) is distinct from company then
    raise exception 'Deal or job not found.' using errcode = 'P0002';
  end if;
  select * into me from public.employees where id = auth.uid();
  address := case requested_channel
    when 'email' then coalesce(nullif(btrim(me.email), ''),
      nullif(btrim((select email from auth.users where id = auth.uid())), ''))
    else nullif(btrim(me.phone), '') end;
  if address is null then
    raise exception '%', case requested_channel
      when 'email' then 'Your account has no email address.'
      else 'Your profile has no mobile number for test texts.' end using errcode = '22023';
  end if;
  vals := case when requested_record is null
    then private.sample_placeholder_values(company, requested_base_url)
    else private.placeholder_values(requested_record, company, null, requested_base_url,
      strpos(template, '{{portal_link}}') > 0) end;
  insert into public.outbound_messages (org_id, channel, subject, body, to_override)
  values (company, requested_channel,
    case when requested_channel = 'email' then left('[Test] ' || coalesce(
      nullif(btrim(private.render_placeholders(requested_subject, vals)), ''), 'Test message'), 200) end,
    left(case when requested_channel = 'sms' then '[Test] ' else '' end
      || btrim(private.render_placeholders(requested_body, vals)), 10000),
    address);
  return address;
end
$$;

-- The Drips page also needs each stage's record status (templates go on a
-- completed jobs stage).
create or replace function public.get_drip_settings(requested_pipeline text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see drips.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'isClosed', s.is_closed, 'dripsEnabled', s.drips_enabled,
      'recordStatus', s.record_status,
      'steps', coalesce((select jsonb_agg(jsonb_build_object(
          'id', d.id, 'delayMinutes', d.delay_minutes, 'channel', d.channel,
          'subject', d.subject, 'body', d.body, 'enabled', d.is_enabled)
          order by d.delay_minutes, d.position)
        from public.drip_steps d where d.stage_id = s.id), '[]'::jsonb))
      order by s.position)
    from public.pipeline_stages s
    where s.org_id = company and s.pipeline = requested_pipeline
  ), '[]'::jsonb);
end
$$;

-- Review requests and aftercare ----------------------------------------------

-- Kept in organizations.settings.reviews: the review link and how many days
-- after a job is completed the review request and aftercare check-in go out.
create function public.get_review_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  reviews jsonb;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see review settings.' using errcode = '42501';
  end if;
  select coalesce(settings -> 'reviews', '{}'::jsonb) into reviews from public.organizations where id = company;
  return jsonb_build_object(
    'reviewLink', nullif(reviews ->> 'link', ''),
    'reviewDelayDays', coalesce((reviews ->> 'request_delay_days')::integer, 3),
    'aftercareDelayDays', coalesce((reviews ->> 'aftercare_delay_days')::integer, 30));
end
$$;

create function public.save_review_settings(
  requested_link text, requested_review_delay_days integer, requested_aftercare_delay_days integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  link text := nullif(btrim(requested_link), '');
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change review settings.' using errcode = '42501';
  end if;
  if link is not null and (link !~* '^https?://[^\s/]+\.[^\s]+$' or char_length(link) > 500) then
    raise exception 'Enter the full review link, starting with https://' using errcode = '22023';
  end if;
  if requested_review_delay_days is null or requested_review_delay_days not between 0 and 365
    or requested_aftercare_delay_days is null or requested_aftercare_delay_days not between 0 and 365 then
    raise exception 'Choose between 0 and 365 days.' using errcode = '22023';
  end if;
  update public.organizations set
    settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('reviews', jsonb_build_object(
      'link', link,
      'request_delay_days', requested_review_delay_days,
      'aftercare_delay_days', requested_aftercare_delay_days)),
    updated_at = now()
  where id = company;
end
$$;

-- Adds a ready-made review request or aftercare check-in step to a completed
-- jobs stage, timed from the review settings. The stage's drips switch is
-- left as it is, so nothing starts sending until staff turn the stage on.
create function public.add_drip_template(requested_stage uuid, requested_template text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  stage public.pipeline_stages%rowtype;
  reviews jsonb;
  step_id uuid := gen_random_uuid();
begin
  select * into stage from public.pipeline_stages where id = requested_stage for update;
  if not found or not private.is_org_manager(stage.org_id) then
    raise exception 'Only managers can edit drips.' using errcode = '42501';
  end if;
  if stage.pipeline <> 'jobs' or stage.record_status <> 'completed' then
    raise exception 'Templates go on a completed jobs stage.' using errcode = '22023';
  end if;
  if requested_template is null or requested_template not in ('review_request', 'aftercare') then
    raise exception 'Unknown template.' using errcode = '22023';
  end if;
  select coalesce(settings -> 'reviews', '{}'::jsonb) into reviews from public.organizations where id = stage.org_id;
  if requested_template = 'review_request' and nullif(reviews ->> 'link', '') is null then
    raise exception 'Add your review link in Settings first.' using errcode = '22023';
  end if;
  insert into public.drip_steps (id, org_id, stage_id, position, delay_minutes, channel, subject, body)
  values (
    step_id, stage.org_id, stage.id,
    coalesce((select max(position) from public.drip_steps where stage_id = stage.id), 0) + 1,
    1440 * case requested_template
      when 'review_request' then coalesce((reviews ->> 'request_delay_days')::integer, 3)
      else coalesce((reviews ->> 'aftercare_delay_days')::integer, 30) end,
    'email',
    case requested_template
      when 'review_request' then 'How did we do, {{first_name}}?'
      else 'Checking in on your project' end,
    case requested_template
      when 'review_request' then
        E'Hi {{first_name}},\n\nThank you for choosing {{company}}. We hope you love how everything turned out.\n\n'
        || E'If you have a minute, a quick review would mean a lot to our team:\n{{review_link}}\n\nThank you,\n{{company}}'
      else
        E'Hi {{first_name}},\n\nIt''s been a little while since we finished your project, and we wanted to check in. '
        || E'How is everything holding up?\n\nIf anything needs attention, reply to this email or call us at '
        || E'{{company_phone}} and we''ll take care of it.\n\nThanks again,\n{{company}}' end);
  return step_id;
end
$$;

-- A deal's drips -------------------------------------------------------------

-- The deal page's Drips block: paused or not, the stage, and what is queued.
create function public.get_deal_drips(requested_record uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.org_of_project(requested_record);
  stage public.pipeline_stages%rowtype;
  vals jsonb;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see drips.' using errcode = '42501';
  end if;
  select * into stage from public.pipeline_stages where id = private.current_pipeline_stage(requested_record);
  vals := private.placeholder_values(requested_record, company, null, null, false);
  return jsonb_build_object(
    'paused', coalesce((select drips_paused from public.deal_settings where record_id = requested_record), false),
    'stage', case when stage.id is null then null
      else jsonb_build_object('id', stage.id, 'name', stage.name, 'dripsEnabled', stage.drips_enabled) end,
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'channel', m.channel,
          'subject', private.render_placeholders(m.subject, vals),
          'body', left(private.render_placeholders(m.body, vals), 280),
          'scheduledFor', m.scheduled_for)
        order by m.scheduled_for)
      from public.outbound_messages m
      where m.record_id = requested_record and m.status = 'queued' and m.drip_step_id is not null), '[]'::jsonb));
end
$$;

-- Pausing cancels what is queued. Resuming queues the current stage's steps
-- that are still ahead, at their original times; steps whose time passed
-- while paused and messages staff skipped stay unsent. A deal that changed
-- stage while paused starts that stage's drips from now.
create function public.set_deal_drips_paused(requested_record uuid, requested_paused boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.require_project_manager(requested_record);
  was_paused boolean;
  enrollment public.drip_enrollments%rowtype;
begin
  if requested_paused is null then
    raise exception 'Choose whether drips are paused.' using errcode = '22023';
  end if;
  select drips_paused into was_paused from public.deal_settings where record_id = requested_record for update;
  insert into public.deal_settings as d (record_id, org_id, drips_paused)
  values (requested_record, company, requested_paused)
  on conflict (record_id) do update set drips_paused = excluded.drips_paused, updated_at = now();

  if requested_paused then
    update public.outbound_messages set status = 'cancelled', error = 'Drips paused for this deal.'
    where record_id = requested_record and status = 'queued' and drip_step_id is not null;
    return;
  end if;
  if not coalesce(was_paused, false) then
    return;
  end if;

  select * into enrollment from public.drip_enrollments
  where record_id = requested_record and left_at is null
  order by entered_at desc limit 1
  for update;
  if not found or enrollment.stage_id is distinct from private.current_pipeline_stage(requested_record) then
    perform private.sync_drips(requested_record);
    return;
  end if;
  insert into public.outbound_messages (
    org_id, record_id, contact_id, enrollment_id, drip_step_id, channel, subject, body,
    scheduled_for, created_by)
  select company, requested_record,
    coalesce((select contact_id from public.leads where id = requested_record),
      (select contact_id from public.jobs where id = requested_record)),
    enrollment.id, s.id, s.channel, s.subject, s.body,
    enrollment.entered_at + make_interval(mins => s.delay_minutes), null
  from public.drip_steps s
  join public.pipeline_stages ps on ps.id = s.stage_id and ps.drips_enabled
  where s.stage_id = enrollment.stage_id and s.is_enabled
    and enrollment.entered_at + make_interval(mins => s.delay_minutes) > now()
    and not exists (
      select 1 from public.outbound_messages m
      where m.enrollment_id = enrollment.id and m.drip_step_id = s.id and m.status <> 'cancelled');
end
$$;

-- Staff skip one queued message; it shows as skipped and is not re-queued.
create function public.skip_queued_message(requested_message uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  message public.outbound_messages%rowtype;
begin
  select * into message from public.outbound_messages where id = requested_message for update;
  if not found or not private.is_org_manager(message.org_id) then
    raise exception 'Only managers can change messages.' using errcode = '42501';
  end if;
  if message.status <> 'queued' then
    raise exception 'This message is no longer queued.' using errcode = '22023';
  end if;
  update public.outbound_messages set status = 'skipped',
    error = 'Skipped by ' || coalesce((select nullif(btrim(full_name), '') from public.employees where id = auth.uid()), 'staff') || '.'
  where id = requested_message;
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'get_drip_preview_records(text)',
    'preview_drip_message(text, text, uuid, text)',
    'send_drip_test(text, text, text, uuid, text)',
    'get_review_settings()',
    'save_review_settings(text, integer, integer)',
    'add_drip_template(uuid, text)',
    'get_deal_drips(uuid)',
    'set_deal_drips_paused(uuid, boolean)',
    'skip_queued_message(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
