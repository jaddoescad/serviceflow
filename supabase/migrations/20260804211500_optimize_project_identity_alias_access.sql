-- Keep project alias resolution efficient as DripJobs history grows.

begin;

create index if not exists project_identity_aliases_job_proposal_idx
  on public.project_identity_aliases(job_proposal_id)
  where job_proposal_id is not null;

drop policy if exists "Authenticated users can resolve project aliases"
  on public.project_identity_aliases;
create policy "Authenticated users can resolve project aliases"
  on public.project_identity_aliases for select to authenticated
  using ((select auth.uid()) is not null);

commit;
