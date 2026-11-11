# CRM delivery setup

The CRM code is complete but nothing is delivered until these are switched on.
Until then, emails and texts stay queued or are marked skipped with the reason,
and Google Calendar changes wait in the sync queue.

## Email (drips, reminders, confirmations, documents)

Email delivery uses the authenticated `cloudflare/email-worker` Worker and
Cloudflare Email Sending. The sender is `notifications@serviceflowapp.com`;
the display name and Reply-To come from each company's messaging settings.

Before activating production:

1. Onboard `serviceflowapp.com` to Cloudflare DNS, preserving its website,
   verification records and existing mail forwarding. Enable Email Sending and
   verify its SPF, DKIM and DMARC records. Domain registration can remain at
   Namecheap. DNS hosting must be Cloudflare for Email Sending.
2. Deploy the Worker with `EMAIL_RELAY_SECRET` set to a random secret. Its
   `EMAIL_FROM` and binding restrict mail to the configured sender.
3. Set these Supabase Edge Function secrets (project `bwbckdkouqghdadpkjvn`):
   - `CLOUDFLARE_EMAIL_URL` — the Worker's HTTPS `/send` endpoint.
   - `CLOUDFLARE_EMAIL_SECRET` — the same value as `EMAIL_RELAY_SECRET`.
4. Deploy `send-messages` and `inbound-email` with JWT verification disabled;
   both authenticate their server-to-server requests themselves.
5. Send an authorized test email before enabling normal delivery. Keep the
   relay secret server-side; never use a `NEXT_PUBLIC_` variable.

There is no Resend dependency. Replies go to the company's Reply-To address
unless a separate inbound email integration is enabled below. Cloudflare
acceptance is recorded as sent with its message ID; later delivery/bounce
callbacks are not configured. Attachments are encoded as base64, with a
17 MiB combined source-file limit to leave room under the 25 MiB MIME limit.

See [the email Worker](../cloudflare/email-worker/README.md) for deployment and
verification commands.

## Texts (Quo)

Each company connects its own Quo API key and number in Settings → Messaging.
Texts are skipped until then.

## Google Calendar

1. Google Cloud console: create an OAuth client (Web application) and enable
   the Google Calendar API. Authorized redirect URIs:
   - `https://serviceflow-admin.vercel.app/api/google-calendar/callback`
   - `http://localhost:3100/api/google-calendar/callback` for local testing.
2. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel (admin) and in
   Supabase Edge Function secrets (the `calendar-sync` function refreshes tokens).
3. Each person connects their own calendar in Settings → Google Calendar.
   Appointments assigned to them sync by default; the job schedule is optional.

`calendar-sync` and `send-messages` run every minute from pg_cron with the
`messages_cron_secret` Vault secret.

## Online card payments (Stripe)

Customers pay an invoice's balance, or an accepted proposal's deposit, by card
on Stripe Checkout. Each company uses its own Stripe account; no card data
touches ServiceFlow. Until this is set up the Pay button stays hidden and
invoices take manual payments only.

1. Vercel (admin), server-only: `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_URL`
   if it differs from `NEXT_PUBLIC_SUPABASE_URL`). The `/api/pay/<token>`
   checkout route reads the company's Stripe key with it, and the webhook
   records payments with it. Without it, checkout and webhooks answer
   "unavailable" and Settings says so.
2. An owner or admin opens Settings → Online payments and pastes the Stripe
   secret key (`sk_live_…`, or a restricted key `rk_live_…` with Checkout
   Sessions write access).
3. In Stripe → Developers → Webhooks, add the endpoint shown in Settings
   (`https://serviceflow-admin.vercel.app/api/stripe/webhook/<company id>`) for
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`,
   then paste its signing secret (`whsec_…`) into Settings.
4. Turn on "Accept card payments". An optional card fee (0–10%) is added to the
   charge, shown to the customer and stored on the payment, never on the invoice.

Paid sessions are recorded once per Stripe event and per payment intent as
method "card" with the payment intent as reference, and the job's salesperson
and project manager (or the managers) are notified. Jobs locked by the June 1,
2026 accounting cutoff can't be paid online; a payment that still arrives for
one, or for a void invoice, is not recorded and staff are told to review it in
Stripe. Refunds are made in Stripe; then remove the payment on the invoice.

## Inbox: customers' texts and email replies

Customers' texts and email replies land in Inbox, one conversation per
customer, next to everything sent to them. Replies from the inbox or a deal's
Communications tab go through the same queue as drips. Inbox › Sent lists every
queued, sent, failed and skipped message with the reason. Until the steps below
are done the inbox simply stays empty; nothing fails.

### Texts (each company, in the app)

1. Connect Quo in Settings → Messaging. An "Incoming texts" webhook URL appears
   (`…/functions/v1/quo-webhook?token=…`, unique to the company).
2. In Quo → Settings → Webhooks, add that URL for `message.received` and
   `message.delivered`.
3. Optional: paste the webhook's signing secret into Settings → Messaging.
   Every webhook must then carry a valid `openphone-signature`.

Texts from numbers that aren't a customer get their own conversation and join
the customer's thread once a customer with that number texts again. Texts staff
send from the Quo app also appear in the thread; texts sent from ServiceFlow
are marked delivered.

### Email replies (once, for every company)

The current sender setup uses each company's existing Reply-To mailbox. An
in-app inbox for email replies requires a separate inbound integration:

1. Choose a receiving domain, e.g. `in.example.com`, and an inbound service
   that posts complete JSON or form fields (`from`, `to`, `subject`,
   `text`/`html`, and optional base64 attachments). A Cloudflare Email Worker
   can parse MIME and forward this format, but that inbound Worker is not part
   of the outbound sender.
2. Set Supabase secrets `INBOUND_EMAIL_DOMAIN` and `INBOUND_EMAIL_TOKEN`
   (a long random secret).
3. Point the trusted inbound integration at
   `https://bwbckdkouqghdadpkjvn.supabase.co/functions/v1/inbound-email?token=<INBOUND_EMAIL_TOKEN>`.
4. Set `INBOUND_EMAIL_DOMAIN` in Vercel to the same value so Settings shows
   email replies as on. Do not set it until receiving and forwarding work.

Customer emails then go out with Reply-To `reply+<message id>@<domain>`, so a
reply threads to that customer and deal even from another address; quoted
history and "Sent from my iPhone" lines are trimmed, and attachments are kept
(private `message-attachments` bucket). Until then Reply-To stays the company's
reply-to address. Until `INBOUND_EMAIL_TOKEN` and `INBOUND_EMAIL_DOMAIN` are
set, the function answers 503.

### Customers' choices

Automated emails and texts link to `/u/<message id>`, where the customer picks,
per channel, everything, no follow-ups (drips), no reminders, or nothing.
Proposals, invoices and messages staff write are blocked only by "nothing".
Messages staff write to one customer carry no unsubscribe footer.

## Lead intake webhooks (Zapier, Make, Facebook Lead Ads, Google Ads)

The `lead-intake` edge function is deployed with `--no-verify-jwt`:

```sh
supabase functions deploy lead-intake --no-verify-jwt --project-ref bwbckdkouqghdadpkjvn
```

It needs no extra secrets. Each company's URLs are in Settings › Lead intake:
`https://bwbckdkouqghdadpkjvn.supabase.co/functions/v1/lead-intake?token=<company token>&source=<zapier|facebook|google>`.
The token can also come as `Authorization: Bearer <token>` or Google's
`google_key`. "New URL" replaces the token at once; update every connection.

- **Zapier or Make (any form):** a Webhooks by Zapier POST action, or Make's
  HTTP "Make a request" (POST). JSON or form data. Recognised fields include
  `name` (or `first_name` + `last_name`), `email`, `phone`, `address`, `city`,
  `province`, `postal_code`, `service`, `notes`/`message` and `source`. Other
  fields are kept as a note on the deal.
- **Facebook Lead Ads:** Zapier's "New Lead" trigger into a Webhooks POST with
  the `facebook` URL (Data empty sends everything). Make's raw `field_data`
  format also works. Source defaults to `Meta Ads` (paid social).
- **Google Ads lead forms:** lead form asset › Export leads › Other data
  integration options. Webhook URL = the `google` URL, Key = the token. "Send
  test data" is logged as Test and adds no lead. Source defaults to `Google Ads`.

Each lead matches an existing customer by email or the phone's last 10 digits
(missing email/phone are filled in, nothing is overwritten), or a new customer
is created. The deal goes into the first open sales column with the raw
payload (secrets removed) in `leads.metadata.intake.payload`, and staff get the
usual new-lead notification. A repeat of the same Google/Facebook lead id (or
the identical body) within 30 days returns the first lead instead of adding
another. Posts without an email or phone are rejected (HTTP 422). More than
300 posts an hour per company are refused (HTTP 429). The last 20 deliveries
show in Settings; deliveries are kept 90 days.
