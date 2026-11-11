import { sendEmail } from "./email.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Delivers queued customer messages (drips, appointment and job reminders,
// and messages staff send with a proposal, change order or invoice, or as a
// reply). Runs every minute from pg_cron. Email goes through the authenticated Cloudflare
// email relay; texts go through each company's own Quo number and API key,
// saved in Settings. When INBOUND_EMAIL_DOMAIN is set, customers' email
// replies go to reply+<message id>@ that domain and land in the inbox. Photos
// staff attach are emailed as attachments; Quo's API can't send picture
// messages, so a text carries their links.

type Claimed = {
  id: string;
  channel: "email" | "sms";
  kind: "drip" | "reminder" | "document" | "manual";
  to: string | null;
  subject: string | null;
  body: string;
  attachments: { url: string; name: string | null; contentType: string | null }[];
  proposalToken: string | null;
  documentPath: string | null;
  inReplyTo: string | null;
  companyName: string;
  replyTo: string | null;
  quoApiKey: string | null;
  quoFrom: string | null;
};

type Outcome = { status: "sent" | "failed" | "skipped"; error?: string; providerId?: string };

const BATCH_SIZE = 50;

const DOCUMENT_NOUNS: Record<string, string> = { p: "proposal", co: "change order", i: "invoice" };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("MESSAGES_CRON_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !cronSecret) {
    return json({ error: "Missing send-messages environment" }, 500);
  }
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token !== cronSecret) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const appUrl = (Deno.env.get("APP_URL") ?? "https://serviceflowapp.com").replace(/\/+$/, "");

  const { data, error } = await supabase.rpc("claim_outbound_messages", { batch_size: BATCH_SIZE });
  if (error) return json({ error: error.message }, 500);
  const messages = (data ?? []) as Claimed[];

  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (const message of messages) {
    let outcome: Outcome;
    try {
      const proposalLink = message.proposalToken ? `${appUrl}/p/${message.proposalToken}` : "";
      const documentLink = message.documentPath ? `${appUrl}${message.documentPath}` : proposalLink;
      const fill = (text: string) =>
        text.replaceAll("{{proposal_link}}", proposalLink).replaceAll("{{document_link}}", documentLink).trim();
      const unsubscribe = `${appUrl}/u/${message.id}`;
      // Messages staff send one customer (a reply, or a proposal, change order
      // or invoice) read like a normal message, with no opt-out footer;
      // automated drips and reminders keep it.
      const footer = message.kind === "drip" || message.kind === "reminder";
      // A sent document's email shows its link as a button.
      const button = message.kind === "document" && message.documentPath
        ? { url: documentLink, label: `View ${DOCUMENT_NOUNS[message.documentPath.split("/")[1]] ?? "document"}` }
        : undefined;
      outcome =
        message.channel === "email"
          ? await sendEmail(message, fill(message.subject ?? ""), fill(message.body), unsubscribe, footer, button)
          : await sendText(message, fill(message.body), unsubscribe, footer);
    } catch (reason) {
      outcome = { status: "failed", error: reason instanceof Error ? reason.message : String(reason) };
    }
    counts[outcome.status] += 1;
    const { error: completeError } = await supabase.rpc("complete_outbound_message", {
      requested_id: message.id,
      requested_status: outcome.status,
      requested_error: outcome.error ?? null,
      requested_provider_id: outcome.providerId ?? null,
    });
    if (completeError) console.error(JSON.stringify({ message: "complete failed", id: message.id, error: completeError.message }));
  }

  return json({ claimed: messages.length, ...counts });
});

async function sendText(message: Claimed, body: string, unsubscribe: string, footer: boolean): Promise<Outcome> {
  if (!message.quoApiKey || !message.quoFrom) {
    return { status: "skipped", error: "Connect Quo in Settings to send texts." };
  }
  const to = toE164(message.to);
  if (!to) return { status: "skipped", error: "Customer has no valid mobile number." };

  const content = [body, ...message.attachments.map((photo) => photo.url), footer ? `Opt out: ${unsubscribe}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const response = await fetch("https://api.quo.com/v1/messages", {
    method: "POST",
    headers: { Authorization: message.quoApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ content, from: message.quoFrom, to: [to] }),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) return { status: "failed", error: "Quo didn't accept the API key. Reconnect Quo in Settings." };
  if (!response.ok) return { status: "failed", error: result?.message ?? `Quo ${response.status}` };
  return { status: "sent", providerId: result?.data?.id };
}

/** North American numbers without a country code get +1. */
function toE164(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (value.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
