-- Extend the shared feed with an exact ServiceFlow uploader filter.
begin;
drop function public.get_workspace_media_page(uuid[],text[],text,timestamptz,date,jsonb,boolean);
create function public.get_workspace_media_page(
  project_filters uuid[] default null,
  creator_filters text[] default null,
  media_filter text default null,
  since_filter timestamptz default null,
  until_filter date default null,
  after_cursor jsonb default null,
  oldest_first boolean default false,
  uploader_filter uuid default null
) returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp as $$
declare
  result jsonb;
  direction text := case when oldest_first then 'asc' else 'desc' end;
  null_order text := case when oldest_first then 'first' else 'last' end;
  comparison text := case when oldest_first then '>' else '<' end;
  reverse_direction text := case when oldest_first then 'desc' else 'asc' end;
  reverse_null_order text := case when oldest_first then 'last' else 'first' end;
begin
  if cardinality(project_filters) > 100 or cardinality(creator_filters) > 100 then
    raise exception 'Too many filters';
  end if;
  -- Only fixed SQL keywords are interpolated. Filter values remain parameters.
  execute format($query$
    with batch as materialized (
      select * from public.admin_photo_feed p
      where ($1 is null or p.owner_id = any($1))
        and ($2 is null or p.creator_name = any($2))
        and ($7 is null or exists (select 1 from public.job_media m where m.id = p.id and m.uploaded_by = $7))
        and ($3 is null or p.media_type = $3)
        and ($4 is null or p.display_at >= $4)
        and ($5 is null or p.display_at < (($5 + 1)::timestamp at time zone 'America/Toronto'))
        and ($6 is null or
          (coalesce(p.captured_at, '-infinity'::timestamptz), p.created_at, p.id) %3$s
          (coalesce(($6->>'capturedAt')::timestamptz, '-infinity'::timestamptz),
           ($6->>'createdAt')::timestamptz, ($6->>'id')::uuid))
      order by p.captured_at %1$s nulls %2$s, p.created_at %1$s, p.id %1$s
      limit 61
    ), page as materialized (
      select * from batch
      order by captured_at %1$s nulls %2$s, created_at %1$s, id %1$s limit 60
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'ownerProjectId', owner_id, 'ownerKind', owner_kind,
        'projectName', project_name, 'address', address, 'mediaType', media_type,
        'mimeType', mime_type, 'durationMs', duration_ms, 'capturedAt', display_at,
        'creatorName', creator_name, 'description', description
      ) order by captured_at %1$s nulls %2$s, created_at %1$s, id %1$s) from page), '[]'::jsonb),
      'nextCursor', case when (select count(*) from batch) > 60 then
        (select jsonb_build_object('capturedAt', captured_at, 'createdAt', created_at, 'id', id)
         from page order by captured_at %4$s nulls %5$s, created_at %4$s, id %4$s limit 1)
      end
    )
  $query$, direction, null_order, comparison, reverse_direction, reverse_null_order)
  into result using project_filters, creator_filters, media_filter, since_filter, until_filter, after_cursor, uploader_filter;
  return result;
end;
$$;
revoke all on function public.get_workspace_media_page(uuid[],text[],text,timestamptz,date,jsonb,boolean,uuid) from public, anon;
grant execute on function public.get_workspace_media_page(uuid[],text[],text,timestamptz,date,jsonb,boolean,uuid) to authenticated;

commit;
