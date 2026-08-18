-- The Hermes importer also derives deterministic UUIDs from the attachment
-- SHA-256. These partial indexes provide a second database-level guard without
-- changing uniqueness semantics for any existing import source.
create unique index if not exists invoices_gmail_contractor_invoice_external_uidx
  on public.invoices (source_system, external_id)
  where source_system = 'gmail_contractor_invoice'
    and external_id is not null;

create unique index if not exists documents_gmail_contractor_invoice_sha256_uidx
  on public.documents (content_sha256)
  where content_sha256 is not null
    and metadata ->> 'source' = 'gmail_contractor_invoice';
