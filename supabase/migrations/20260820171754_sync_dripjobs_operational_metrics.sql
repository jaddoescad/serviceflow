begin;

alter table public.jobs
  add column if not exists scheduled_end_on date;

alter table public.leads
  add column if not exists dripjobs_sales_deal_id text;

create unique index if not exists leads_dripjobs_sales_deal_id_uidx
  on public.leads(dripjobs_sales_deal_id)
  where dripjobs_sales_deal_id is not null;

comment on column public.leads.dripjobs_sales_deal_id is
  'Exact /deals/_view identifier captured from the DripJobs Sales List. Kept separate because the live Zap currently supplies a contact identity in dripjobs_deal_id.';

alter table public.jobs
  drop constraint if exists jobs_schedule_range_check;
alter table public.jobs
  add constraint jobs_schedule_range_check check (
    scheduled_on is null
    or scheduled_end_on is null
    or scheduled_end_on >= scheduled_on
  );

comment on column public.jobs.scheduled_on is
  'Planned DripJobs production start date. This is operational scheduling data, not the accounting production month.';
comment on column public.jobs.scheduled_end_on is
  'Planned DripJobs production end date. Synced only from a validated Jobs List schedule range.';

create or replace function private.normalize_dripjobs_lead_channel(raw_source text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(raw_source, ''))) = 'meta-perspective'
      or lower(btrim(coalesce(raw_source, ''))) = 'meta ads'
      or lower(btrim(coalesce(raw_source, ''))) like 'meta ads -%'
      then 'paid_social'
    when lower(btrim(coalesce(raw_source, ''))) in ('facebook', 'instagram')
      then 'organic_social'
    when lower(btrim(coalesce(raw_source, ''))) = 'website'
      or lower(btrim(coalesce(raw_source, ''))) = '/'
      or lower(btrim(coalesce(raw_source, ''))) like '/%'
      then 'website'
    when lower(btrim(coalesce(raw_source, ''))) = 'phone call'
      then 'phone'
    when lower(btrim(coalesce(raw_source, ''))) = 'mail'
      then 'mail'
    when lower(btrim(coalesce(raw_source, ''))) = 'word of mouth'
      then 'referral'
    when lower(btrim(coalesce(raw_source, ''))) = 'google'
      then 'organic_search'
    when lower(btrim(coalesce(raw_source, ''))) = 'other'
      then 'other'
    else 'unknown'
  end
$$;

revoke all on function private.normalize_dripjobs_lead_channel(text)
  from public, anon, authenticated, service_role;

create or replace function private.set_dripjobs_lead_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
    or new.source is distinct from old.source
    or new.normalized_channel = 'unknown' then
    new.normalized_channel := private.normalize_dripjobs_lead_channel(new.source);
  end if;
  return new;
end
$$;

revoke all on function private.set_dripjobs_lead_channel()
  from public, anon, authenticated, service_role;

drop trigger if exists leads_normalize_dripjobs_channel on public.leads;
create trigger leads_normalize_dripjobs_channel
before insert or update of source, normalized_channel on public.leads
for each row execute function private.set_dripjobs_lead_channel();

update public.leads
set normalized_channel = private.normalize_dripjobs_lead_channel(source)
where normalized_channel = 'unknown'
  and private.normalize_dripjobs_lead_channel(source) <> 'unknown';

select pg_notify('pgrst', 'reload schema');

commit;
