-- Shared pieces several CRM features build on: staff notifications, a
-- customer's preferred language, opt-outs by message category, and messages
-- sent to someone other than the deal's customer (test sends).
begin;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  record_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, update (read_at) on public.notifications to authenticated;
create policy own_read on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy own_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Tells the people responsible for a deal or job: its salesperson and project
-- manager (a job falls back to its deal's), or the company's managers when
-- nobody is assigned. The person who caused it is not told.
create function private.notify_record(
  company uuid, requested_record uuid, requested_kind text,
  requested_title text, requested_body text default null, requested_link text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  owners uuid[];
begin
  select array_remove(array[d.salesperson_id, d.project_manager_id], null) into owners
  from public.deal_settings d
  where d.record_id in (requested_record, (select lead_id from public.jobs where id = requested_record))
    and d.org_id = company
    and (d.salesperson_id is not null or d.project_manager_id is not null)
  order by (d.record_id = requested_record) desc
  limit 1;
  if coalesce(cardinality(owners), 0) = 0 then
    select array_agg(m.user_id) into owners
    from public.org_members m
    where m.org_id = company and m.is_active and m.role in ('owner', 'admin', 'manager');
  end if;
  insert into public.notifications (org_id, user_id, kind, title, body, link, record_id)
  select distinct company, person, requested_kind, left(requested_title, 200), left(requested_body, 1000),
    requested_link, requested_record
  from unnest(coalesce(owners, '{}')) person
  where person is distinct from auth.uid();
end
$$;
revoke all on function private.notify_record(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- Customer pages and forms open in this language when set.
alter table public.contacts add column preferred_language text
  check (preferred_language in ('en', 'fr'));

-- A customer can stop one kind of message ('drips', 'reminders') or all of
-- them on a channel. Existing rows mean everything.
alter table public.message_opt_outs drop constraint message_opt_outs_pkey;
alter table public.message_opt_outs add column category text not null default 'all'
  check (category in ('all', 'drips', 'reminders'));
alter table public.message_opt_outs add primary key (contact_id, channel, category);

-- Test sends and staff copies go here instead of to the customer.
alter table public.outbound_messages add column to_override text;

select pg_notify('pgrst', 'reload schema');

commit;
