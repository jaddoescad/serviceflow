begin;

update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']::text[]
where id = 'material-invoices';

commit;
