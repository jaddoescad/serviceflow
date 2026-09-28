-- `address` clashed with organizations.address inside the invitation loop.
-- Joins every company that invited the signed-in person's confirmed email.
create or replace function public.accept_my_invitations()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  me uuid := auth.uid();
  my_email text;
  invitation public.org_invitations%rowtype;
  joined jsonb := '[]'::jsonb;
  company_name text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select lower(email) into my_email from auth.users where id = me and email_confirmed_at is not null;
  if my_email is null then
    return joined;
  end if;

  for invitation in
    select i.* from public.org_invitations i join public.organizations o on o.id = i.org_id
    where lower(i.email) = my_email and i.accepted_at is null and i.revoked_at is null
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

