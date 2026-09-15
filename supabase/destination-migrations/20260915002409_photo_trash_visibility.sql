-- Read-only accounting copy (pyzejfhsdewpnvmtqtlw) ONLY, before enabling trash
-- in ServiceFlow. Shared file references stay intact; no RPC editing grants.
create policy job_media_hide_trash on public.job_media as restrictive
  for select to authenticated
  using (source_metadata->>'photo_trashed_at' is null);
