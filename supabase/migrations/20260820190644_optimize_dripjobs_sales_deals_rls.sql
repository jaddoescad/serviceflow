begin;

drop policy if exists "authenticated_read" on public.dripjobs_sales_deals;
create policy "authenticated_read"
  on public.dripjobs_sales_deals for select to authenticated
  using ((select auth.uid()) is not null);

commit;
