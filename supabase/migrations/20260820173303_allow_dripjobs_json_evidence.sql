begin;

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/json')
where id = 'material-invoices'
  and not ('application/json' = any(coalesce(allowed_mime_types, '{}'::text[])));

commit;
