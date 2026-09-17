create function public.publish_calculator_budget(requested_job_id uuid, payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  task jsonb;
  target_job public.jobs%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into target_job from public.jobs where id = requested_job_id;
  if not found then raise exception 'Job not found'; end if;
  if target_job.started_on < date '2026-06-01'
    or (target_job.started_on is null and target_job.status in ('completed', 'archived')) then
    raise exception 'Historical job accounting is locked';
  end if;
  -- Existing mutation functions enforce manager access and accounting rules.
  -- Any failure rolls back tasks, budget, and quote together.
  for task in select value from jsonb_array_elements(payload->'tasks') loop
    perform public.save_job_task(
      requested_job_id, (task->>'id')::uuid, task->>'title', task->>'notes',
      (task->>'minutes')::integer, (task->>'sortOrder')::integer
    );
  end loop;
  perform public.save_job_budget(
    requested_job_id, (payload->>'minutes')::integer, null::integer,
    null::bigint, payload->>'notes'
  );
  perform public.publish_quote(
    (payload->>'leadId')::uuid, (payload->>'quoteId')::uuid,
    payload->>'quoteName', (payload->>'quoteAmountCents')::bigint,
    payload->'doc', payload->>'quoteStatus'
  );
end;
$$;
revoke all on function public.publish_calculator_budget(uuid,jsonb) from public,anon;
grant execute on function public.publish_calculator_budget(uuid,jsonb) to authenticated;
