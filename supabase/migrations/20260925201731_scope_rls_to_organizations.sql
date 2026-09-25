-- Phase 1, step 3 of multi-company ServiceFlow. Row-level security moves from
-- "any signed-in user" / "any manager" to "members (or managers) of the row's
-- company". Everyone active today is an Ottawa Painters member with the same
-- role, so what they can see and change is unchanged. Deactivated employees
-- lose read access, since only active memberships count.
--
-- SECURITY DEFINER functions still bypass RLS; they are scoped in step 4.

create function private.my_managed_org_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
    and m.is_active
    and m.role in ('owner', 'admin', 'manager')
    and o.status = 'active'
$$;

revoke all on function private.my_managed_org_ids() from public, anon;
grant execute on function private.my_managed_org_ids() to authenticated;

-- Company data readable by every member of the company.
drop policy authenticated_read on public.contacts;
create policy org_member_read on public.contacts for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.leads;
create policy org_member_read on public.leads for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.quotes;
create policy org_member_read on public.quotes for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.jobs;
create policy org_member_read on public.jobs for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.job_budgets;
create policy org_member_read on public.job_budgets for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.job_assignments;
create policy org_member_read on public.job_assignments for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.job_tasks;
create policy org_member_read on public.job_tasks for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.job_issues;
create policy org_member_read on public.job_issues for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.time_entries;
create policy org_member_read on public.time_entries for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.time_entry_events;
create policy org_member_read on public.time_entry_events for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy authenticated_read on public.employee_pay_rates;
create policy org_member_read on public.employee_pay_rates for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy labels_read on public.project_labels;
create policy org_member_read on public.project_labels for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy label_links_read on public.project_label_links;
create policy org_member_read on public.project_label_links for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy workspace_read on public.project_workspace;
create policy org_member_read on public.project_workspace for select to authenticated
  using (org_id in (select private.my_org_ids()));

drop policy media_creator_links_read on public.media_creator_links;
create policy org_member_read on public.media_creator_links for select to authenticated
  using (org_id in (select private.my_org_ids()));

-- Manager writes, now limited to companies the user manages.
drop policy employee_pay_rates_manager_write on public.employee_pay_rates;
create policy org_manager_write on public.employee_pay_rates for all to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));

drop policy labels_write on public.project_labels;
create policy org_manager_write on public.project_labels for all to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));

drop policy label_links_write on public.project_label_links;
create policy org_manager_write on public.project_label_links for all to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));

drop policy workspace_insert on public.project_workspace;
create policy org_manager_insert on public.project_workspace for insert to authenticated
  with check (org_id in (select private.my_managed_org_ids()));

drop policy workspace_update on public.project_workspace;
create policy org_manager_update on public.project_workspace for update to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));

-- Location data: your own, or anyone's in a company you manage.
drop policy location_points_read on public.employee_location_points;
create policy own_or_org_manager_read on public.employee_location_points for select to authenticated
  using (employee_id = (select auth.uid()) or org_id in (select private.my_managed_org_ids()));

drop policy tracking_status_read on public.employee_tracking_status;
create policy own_or_org_manager_read on public.employee_tracking_status for select to authenticated
  using (employee_id = (select auth.uid()) or org_id in (select private.my_managed_org_ids()));

drop policy location_alerts_read on public.location_alerts;
create policy own_or_org_manager_read on public.location_alerts for select to authenticated
  using (employee_id = (select auth.uid()) or org_id in (select private.my_managed_org_ids()));

-- People: yourself, plus anyone who shares a company with you.
drop policy authenticated_read on public.employees;
create policy self_or_coworker_read on public.employees for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.org_members m
      where m.user_id = employees.id
        and m.org_id in (select private.my_org_ids())
    )
  );

-- Devices: your own, or those of people in a company you manage.
drop policy push_tokens_read on public.push_tokens;
create policy own_or_org_manager_read on public.push_tokens for select to authenticated
  using (
    employee_id = (select auth.uid())
    or exists (
      select 1 from public.org_members m
      where m.user_id = push_tokens.employee_id
        and m.org_id in (select private.my_managed_org_ids())
    )
  );

-- Media: same rules as before, inside the company, and a photo can only be
-- attached to a job or lead of its own company.
drop policy job_media_select on public.job_media;
create policy org_member_read on public.job_media for select to authenticated
  using (
    org_id in (select private.my_org_ids())
    and (
      (job_id is not null and exists (select 1 from public.jobs j where j.id = job_media.job_id))
      or (lead_id is not null and exists (select 1 from public.leads l where l.id = job_media.lead_id))
    )
  );

drop policy job_media_insert on public.job_media;
create policy org_member_insert on public.job_media for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and source_provider = 'app'
    and source_id is null
    and source_project_id is null
    and org_id in (select private.my_org_ids())
    and (
      (job_id is not null and exists (
        select 1 from public.jobs j where j.id = job_media.job_id and j.org_id = job_media.org_id))
      or (lead_id is not null and exists (
        select 1 from public.leads l where l.id = job_media.lead_id and l.org_id = job_media.org_id))
    )
  );

drop policy job_media_delete on public.job_media;
create policy uploader_delete on public.job_media for delete to authenticated
  using (
    uploaded_by = (select auth.uid())
    and org_id in (select private.my_org_ids())
    and (
      (job_id is not null and exists (select 1 from public.jobs j where j.id = job_media.job_id))
      or (lead_id is not null and exists (select 1 from public.leads l where l.id = job_media.lead_id))
    )
  );

-- Ottawa Painters' labour invoice files: Ottawa Painters managers only.
drop policy "Managers can read labour invoice files" on storage.objects;
create policy "Ottawa Painters managers can read labour invoice files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'labour-invoices'
    and (select private.legacy_default_org_id()) in (select private.my_managed_org_ids())
  );
