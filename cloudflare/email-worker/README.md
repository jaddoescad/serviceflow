# ServiceFlow email

An authenticated relay from the Supabase message queue to Cloudflare Email
Sending. The Worker fixes the sender to `notifications@serviceflowapp.com` and
returns Cloudflare's message ID. It does not retry sends automatically.

## Migration status — November 10, 2026

Cloudflare DNS is active for `serviceflowapp.com`; Email Sending is enabled
with SPF, DKIM and DMARC published. The existing website A/CNAME records remain
DNS-only, pointed at Vercel. Namecheap had no email forwarders or catch-all.

The relay is deployed at `https://serviceflow-email.jadslim-fai.workers.dev/send`.
Its shared secret is configured in Cloudflare and Supabase; `send-messages` and
`inbound-email` are deployed to project `bwbckdkouqghdadpkjvn`. The existing
`send-outbound-messages` cron runs every minute. Supabase Auth already used
Cloudflare SMTP; its sender is now `notifications@serviceflowapp.com` too.

Cloudflare accepted the user-authorized verification email with a text
attachment (message ID `<RsaQ9Qztbg3NXfuKD5aYNA8W986bJlh6K39W@serviceflowapp.com>`).
Inbox placement has not been independently checked. The relay rejected an
unauthenticated request with 401 and an authenticated invalid payload with 400.

Records observed in Namecheap and public DNS before migration:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 216.150.1.1 |
| A | @ | 216.150.16.1 |
| CNAME | www | a0a8777b05ff8d67.vercel-dns-017.com |
| TXT | @ | google-site-verification=aBwSMAFOSPq49D0fDtzyFvyMgSirKDvKDK9r6cWpRGk |
| TXT | @ | v=spf1 include:spf.efwd.registrar-servers.com ~all |
| MX | @ | eforward1.registrar-servers.com (10) |
| MX | @ | eforward2.registrar-servers.com (10) |
| MX | @ | eforward3.registrar-servers.com (10) |
| MX | @ | eforward4.registrar-servers.com (15) |
| MX | @ | eforward5.registrar-servers.com (20) |

DNSSEC was disabled before migration. There were no configured Namecheap
forwarding aliases or catch-all. Registration remains with Namecheap; the
assigned nameservers are `alexis.ns.cloudflare.com` and `susan.ns.cloudflare.com`.

## Setup

First onboard `serviceflowapp.com` to Cloudflare DNS and Email Sending. Preserve
the existing Vercel records, Google verification TXT record and mail forwarding
when moving DNS from Namecheap. Verify SPF/DKIM/DMARC before sending.

Use the repository's pinned Wrangler installation from the repository root:

```sh
cloudflare/project-media-worker/node_modules/.bin/wrangler whoami
cloudflare/project-media-worker/node_modules/.bin/wrangler deploy --config cloudflare/email-worker/wrangler.jsonc
cloudflare/project-media-worker/node_modules/.bin/wrangler secret put EMAIL_RELAY_SECRET --config cloudflare/email-worker/wrangler.jsonc
```

The Worker rejects requests until the secret exists. Generate a strong random
secret; set the same value as `CLOUDFLARE_EMAIL_SECRET` in Supabase and set
`CLOUDFLARE_EMAIL_URL` to the deployed Worker's `/send` URL. Do not store either
secret in Git. No Cloudflare account API token is needed at runtime.

`POST /send` accepts `companyName`, a single `to` address, `subject`, `text`,
`html`, optional `replyTo`, threading/unsubscribe `headers`, and base64
`attachments`. Authorization is `Bearer <EMAIL_RELAY_SECRET>`. Success returns
`{"id":"<Cloudflare message ID>"}`. Failed requests are not reported as sent.
Sending an actual verification message requires an authorized test recipient.

## Checks

```sh
node --test cloudflare/email-worker/test/worker.test.mjs
deno test --allow-env supabase/functions/send-messages/email_test.ts supabase/functions/inbound-email/email_test.ts
deno check supabase/functions/send-messages/index.ts supabase/functions/inbound-email/index.ts
cloudflare/project-media-worker/node_modules/.bin/wrangler deploy --dry-run --config cloudflare/email-worker/wrangler.jsonc
```

Incoming replies use each company's configured mailbox. This Worker does not
replace incoming mail or configure an in-app email inbox. See
[`docs/crm-setup.md`](../../docs/crm-setup.md) for the separate inbound webhook.
