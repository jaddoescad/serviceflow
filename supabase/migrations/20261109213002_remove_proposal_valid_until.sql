-- Proposals no longer expire: clear every stored valid-until date, so the
-- customer page, the portal and acceptance never treat one as expired.
update public.quotes set valid_until = null where valid_until is not null;
