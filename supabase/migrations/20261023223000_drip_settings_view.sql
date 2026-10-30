-- The Drips page: a pipeline's columns with their drip steps, for the
-- company the web admin acts in.
create function public.get_drip_settings(requested_pipeline text)
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
revoke all on function public.get_drip_settings(text) from public, anon;
grant execute on function public.get_drip_settings(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
