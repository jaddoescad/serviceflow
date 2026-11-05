-- The webhook also gets the company's own Quo number, so a call that only
-- lists its participants is filed under the customer, not the company's line.
create or replace function public.get_quo_webhook(requested_token text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('orgId', org_id, 'number', quo_from_number,
    'secrets', to_jsonb(array_remove(array[quo_webhook_secret, quo_call_webhook_secret], null)))
  from private.org_messaging
  where quo_webhook_token = requested_token and length(requested_token) >= 24
$$;
