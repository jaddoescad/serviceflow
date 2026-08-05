begin;

do $open_checks$
begin
  if (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') <> 30 then
    raise exception 'Refusing to reopen: unexpected public table count';
  end if;
  if exists (
    select 1 from public.time_entries entry
    left join public.jobs job on job.id = entry.job_id
    where entry.job_id is not null and job.id is null
  ) or exists (
    select 1 from public.job_tasks task
    left join public.jobs job on job.id = task.job_id
    where job.id is null
  ) or exists (
    select 1 from public.invoice_job_allocations allocation
    left join public.jobs job on job.id = allocation.job_id
    where job.id is null
  ) then
    raise exception 'Refusing to reopen: an operational row is orphaned';
  end if;
  if exists (
    select 1
    from public.quotes quote
    where quote.dripjobs_proposal_id is not null
      and quote.status = 'accepted'
      and (select count(*) from public.jobs job where job.accepted_quote_id = quote.id) <> 1
  ) then
    raise exception 'Refusing to reopen: accepted proposal mapping is incomplete';
  end if;
end
$open_checks$;

update public.app_config
set maintenance_mode = false,
    updated_at = now()
where id = 'default' and schema_version = 2;

commit;
