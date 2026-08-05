# DripJobs Zapier sync

DripJobs leads and accepted proposals continue the existing audited export.
Zapier sends events to the `dripjobs-events` Supabase Edge Function. The
server-only `DRIPJOBS_ZAPIER_WEBHOOK_SECRET` must be sent as:

Existing CompanyCam IDs are preserved as optional photo links on canonical
`jobs` rows. New DripJobs jobs do not create or require CompanyCam projects.
Every operational reference uses the canonical job UUID.

```text
https://<project-ref>.supabase.co/functions/v1/dripjobs-events
```

```text
Authorization: Bearer <secret>
Content-Type: application/json
```

Never place the secret in Expo public environment variables or client code.

## Zap 1: New Lead Created

Use **DripJobs / New Lead Created**, followed by **Webhooks by Zapier / Custom
Request**. Send `POST` with this JSON field mapping:

```json
{
  "version": 1,
  "event_type": "lead.created",
  "deal_id": "<DripJobs Deal ID>",
  "contact_uuid": "<DripJobs Contact ID, when available>",
  "created_at": "<lead creation timestamp>",
  "first_name": "<first name>",
  "last_name": "<last name>",
  "email": "<email>",
  "phone": "<phone>",
  "lead_source": "<lead source>",
  "address": "<full job address>",
  "postal_code": "<postal code>"
}
```

`deal_id` and `created_at` are required. Set `is_test` to `true` while testing
the Zap; test deliveries are audited but do not change leads or jobs.

## Zap 2: Proposal Accepted

Use **DripJobs / Proposal Accepted** with the same webhook action:

```json
{
  "version": 1,
  "event_type": "proposal.accepted",
  "proposal_id": "<DripJobs Proposal ID>",
  "deal_id": "<originating DripJobs Deal ID>",
  "contact_uuid": "<DripJobs Contact ID, when available>",
  "accepted_at": "<proposal accepted timestamp>",
  "job_name": "<job or deal name>",
  "first_name": "<first name>",
  "last_name": "<last name>",
  "email": "<email>",
  "phone": "<phone>",
  "amount": "<accepted proposal amount>",
  "job_address": "<street address>",
  "job_city": "<city>",
  "job_state": "<province>",
  "job_zip": "<postal code>",
  "country": "Canada"
}
```

`proposal_id`, `deal_id`, and `accepted_at` are required. An exact `deal_id`
creates the confirmed originating lead relationship. A missing Deal ID fails
the delivery rather than guessing from repeat-customer contact details.

## Response behavior

- `processed`: the canonical lead or job was created or continued.
- `duplicate`: a replay was accepted without creating a duplicate row.
- `ignored`: a test delivery was audited without changing canonical data.
- `400`: invalid field mapping.
- `401`: missing or incorrect webhook secret.
- `500`: backend processing failed; inspect sync health and function logs before
  replaying the Zapier task.
