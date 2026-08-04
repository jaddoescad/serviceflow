-- Preserve original HTML order confirmations when they are the supplier's source document.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/html'
]::text[]
where id = 'material-invoices';
