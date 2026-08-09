-- Labour invoice evidence is stored in a private bucket. Permit only active
-- managers and admins to read archived files through authenticated requests.
drop policy if exists "Managers can read labour invoice files" on storage.objects;

create policy "Managers can read labour invoice files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'labour-invoices'
    and private.is_manager()
  );
