-- Invitations go to an email address instead of a code. When someone signs in
-- with a confirmed email that a company invited, they join it automatically;
-- a person invited by two companies belongs to both and switches in the app.

alter table public.org_invitations alter column code_hash drop not null;

-- One open invitation per person per company; inviting again refreshes it.
create unique index if not exists org_invitations_open_email_idx
  on public.org_invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

drop function if exists public.accept_invitation(text);
drop function if exists public.create_invitation(text, text, uuid);

create or replace function public.invite_to_company(
  requested_email text,
  requested_role text default 'crew',
  requested_org_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  company uuid := coalesce(requested_org_id, private.acting_org_id());
  address text := lower(btrim(coalesce(requested_email, '')));
  company_name text;
  invitation public.org_invitations%rowtype;
begin
  perform private.set_acting_org(company);
  if not private.is_org_manager(company) then
    raise exception 'Manager access required.' using errcode = '42501';
  end if;
  if address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if requested_role not in ('admin', 'manager', 'crew') then
    raise exception 'Choose a role: admin, manager or crew.' using errcode = '22023';
  end if;
  if requested_role = 'admin' and private.org_role(company) not in ('owner', 'admin') then
    raise exception 'Only admins can invite admins.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.org_members m join auth.users u on u.id = m.user_id
    where m.org_id = company and m.is_active and lower(u.email) = address
  ) then
    raise exception '% is already a member.', address using errcode = '22023';
  end if;
  if (select count(*) from public.org_invitations
      where org_id = company and created_at > now() - interval '1 day') >= 100 then
    raise exception 'Too many invitations today. Try again tomorrow.' using errcode = '22023';
  end if;

  insert into public.org_invitations (org_id, email, role, invited_by)
  values (company, address, requested_role, auth.uid())
  on conflict (org_id, email) where accepted_at is null and revoked_at is null
  do update set role = excluded.role, invited_by = excluded.invited_by,
                created_at = now(), expires_at = now() + interval '14 days'
  returning * into invitation;

  select name into company_name from public.organizations where id = company;
  return jsonb_build_object(
    'id', invitation.id, 'email', invitation.email, 'role', invitation.role,
    'company', company_name, 'expires_at', invitation.expires_at);
end
$$;

-- Joins every company that invited the signed-in person's confirmed email.
create or replace function public.accept_my_invitations()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  me uuid := auth.uid();
  address text;
  invitation public.org_invitations%rowtype;
  joined jsonb := '[]'::jsonb;
  company_name text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select lower(email) into address from auth.users where id = me and email_confirmed_at is not null;
  if address is null then
    return joined;
  end if;

  for invitation in
    select i.* from public.org_invitations i join public.organizations o on o.id = i.org_id
    where lower(i.email) = address and i.accepted_at is null and i.revoked_at is null
      and i.expires_at > now() and o.status = 'active'
    for update of i
  loop
    perform private.ensure_my_profile(case invitation.role when 'crew' then 'painter' else invitation.role end);
    -- An invitation also brings back someone who was deactivated, in the invited role.
    insert into public.org_members (org_id, user_id, role, is_active)
    values (invitation.org_id, me, invitation.role, true)
    on conflict (org_id, user_id) do update
      set role = case when public.org_members.role = 'owner' then 'owner' else excluded.role end,
          is_active = true, updated_at = now();
    update public.org_invitations set accepted_at = now(), accepted_by = me where id = invitation.id;
    select name into company_name from public.organizations where id = invitation.org_id;
    joined := joined || jsonb_build_object('org_id', invitation.org_id, 'name', company_name, 'role', invitation.role);
  end loop;
  return joined;
end
$$;

revoke all on function public.invite_to_company(text, text, uuid) from public, anon;
revoke all on function public.accept_my_invitations() from public, anon;
grant execute on function public.invite_to_company(text, text, uuid) to authenticated;
grant execute on function public.accept_my_invitations() to authenticated;

-- The company a job belongs to, so the app can show one company at a time.
create or replace view public.job_feed with (security_invoker = true) as
 SELECT job.id,
    job.name,
    job.status,
    job.formatted_address,
    job.address_line_1,
    job.address_line_2,
    job.city,
    job.province,
    job.postal_code,
    job.country,
    job.latitude,
    job.longitude,
    job.companycam_project_ids,
    job.scheduled_on,
    job.started_on,
    job.completed_on,
    job.is_feed_visible,
    job.updated_at,
    budget.budget_minutes,
    usage.used_minutes,
        CASE
            WHEN budget.budget_minutes IS NULL OR budget.budget_minutes = 0 THEN NULL::numeric
            ELSE round(usage.used_minutes::numeric / budget.budget_minutes::numeric * 100::numeric, 2)
        END AS budget_percent_used,
        CASE
            WHEN budget.budget_minutes IS NULL THEN 'not_configured'::text
            WHEN usage.used_minutes > budget.budget_minutes THEN 'over_budget'::text
            WHEN job.status = 'completed'::text THEN 'complete'::text
            ELSE 'active'::text
        END AS budget_status,
    job.lead_id,
    job.org_id
   FROM jobs job
     LEFT JOIN LATERAL ( SELECT source.budget_minutes
           FROM job_budgets source
          WHERE source.job_id = job.id AND (source.status = ANY (ARRAY['active'::text, 'closed'::text]))
          ORDER BY (source.status = 'active'::text) DESC, (source.source = ANY (ARRAY['manual'::text, 'project_budget'::text])) DESC, (source.source = 'manual'::text) DESC, source.version DESC, source.updated_at DESC, source.id
         LIMIT 1) budget ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(entry.ended_at, now()) - entry.started_at) / 60::numeric)), 0::numeric)::integer AS used_minutes
           FROM time_entries entry
          WHERE entry.job_id = job.id AND entry.status <> 'deleted'::text) usage ON true
  WHERE job.is_feed_visible;
