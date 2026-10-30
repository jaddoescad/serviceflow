import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type EmailAttachment,
  type ParsedEmail,
  findReplyToken,
  htmlToText,
  parseDeliveryEvent,
  parseInboundEmail,
  stripQuotedReply,
} from "./email.ts";

// Receives customers' email replies. Customer emails go out with Reply-To
// reply+<message id>@INBOUND_EMAIL_DOMAIN; the inbound provider (Resend
// inbound, Postmark, or anything posting {from, to, subject, text, html})
// posts each reply here, and it lands in that customer's conversation.
// Resend delivery webhooks (delivered, bounced, complained) can post here too.
// The URL carries INBOUND_EMAIL_TOKEN; Resend's svix signature is also
// checked when INBOUND_EMAIL_SIGNING_SECRET is set.

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Small inline images are signature logos and icons, not the customer's photos.
const MIN_INLINE_BYTES = 30 * 1024;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expected = Deno.env.get("INBOUND_EMAIL_TOKEN");
  const domain = Deno.env.get("INBOUND_EMAIL_DOMAIN");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Missing environment" }, 500);
  if (!expected || !domain) return json({ error: "Inbound email isn't set up." }, 503);
  if (!timingSafeEqual(new URL(req.url).searchParams.get("token") ?? "", expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    payload = await formPayload(await req.formData());
  } else {
    const raw = await req.text();
    const signingSecret = Deno.env.get("INBOUND_EMAIL_SIGNING_SECRET");
    if (signingSecret && !(await verifySvix(raw, req.headers, signingSecret))) {
      return json({ error: "Invalid signature" }, 401);
    }
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const delivery = parseDeliveryEvent(payload);
  if (delivery) {
    const { error } = await supabase.rpc("record_message_delivery", {
      requested_provider_id: delivery.providerId,
      requested_event: delivery.event,
      requested_detail: delivery.detail,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ delivery: delivery.event });
  }

  let email = parseInboundEmail(payload);
  if (!email) return json({ ignored: "Not an email." });
  const replyToken = findReplyToken(email.recipients, domain);
  // Acknowledged so the provider stops retrying; there is nowhere to put it.
  if (!replyToken) return json({ ignored: "No reply address." });

  const { data: orgId, error: orgError } = await supabase.rpc("resolve_reply_token", { requested_token: replyToken });
  if (orgError) return json({ error: orgError.message }, 500);
  if (!orgId) return json({ ignored: "Unknown reply address." });

  if (email.resendEmailId) email = await withResendContent(email);
  if (email.messageId && (await alreadyStored(supabase, orgId, email.messageId))) {
    return json({ duplicate: true });
  }

  const text = email.strippedText ?? email.text ?? (email.html ? htmlToText(email.html) : "");
  const attachments = await storeAttachments(supabase, orgId, email.attachments);
  const { data, error } = await supabase.rpc("receive_inbound_message", {
    requested_org: null,
    requested_message: {
      channel: "email",
      direction: "inbound",
      from: email.from,
      to: email.recipients.find((address) => address.includes(replyToken)) ?? null,
      subject: email.subject,
      body: stripQuotedReply(text),
      attachments,
      providerId: email.messageId,
      replyToken,
      receivedAt: email.receivedAt,
    },
  });
  if (error) {
    console.error(JSON.stringify({ message: "receive failed", org: orgId, error: error.message }));
    return json({ error: "Could not store the email" }, 500);
  }
  return json(data ?? {});
});

/** Resend's webhook has no body; fetch it and the attachment links. */
async function withResendContent(email: ParsedEmail): Promise<ParsedEmail> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return email;
  const headers = { Authorization: `Bearer ${apiKey}` };
  const base = `https://api.resend.com/emails/receiving/${encodeURIComponent(email.resendEmailId!)}`;
  const [content, files] = await Promise.all([
    fetch(base, { headers }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${base}/attachments`, { headers }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const fetched = content ? parseInboundEmail({ type: "email.received", data: content }) : null;
  const listed = parseInboundEmail({ type: "email.received", data: { from: email.from, attachments: files?.data ?? [] } });
  return {
    ...email,
    text: fetched?.text ?? email.text,
    html: fetched?.html ?? email.html,
    messageId: email.messageId ?? fetched?.messageId ?? null,
    attachments: listed?.attachments.length ? listed.attachments : email.attachments,
  };
}

async function alreadyStored(supabase: SupabaseClient, orgId: string, messageId: string): Promise<boolean> {
  const { data } = await supabase
    .from("conversation_messages")
    .select("id")
    .eq("org_id", orgId)
    .eq("channel", "email")
    .eq("provider_message_id", messageId)
    .limit(1);
  return Boolean(data?.length);
}

/** Copies attachments into the private bucket under the company's folder.
 * A file that can't be copied is skipped; the message still lands. */
async function storeAttachments(supabase: SupabaseClient, orgId: string, attachments: EmailAttachment[]) {
  const folder = `${orgId}/${crypto.randomUUID()}`;
  const stored: { name: string; contentType: string | null; size: number; path: string }[] = [];
  for (const [index, attachment] of attachments.entries()) {
    try {
      const bytes = attachment.content
        ? Uint8Array.from(atob(attachment.content.replace(/\s/g, "")), (char) => char.charCodeAt(0))
        : attachment.url
          ? new Uint8Array(await (await fetch(attachment.url)).arrayBuffer())
          : null;
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;
      if (attachment.inline && bytes.byteLength < MIN_INLINE_BYTES) continue;
      const safeName = attachment.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "attachment";
      const path = `${folder}/${index}-${safeName}`;
      const { error } = await supabase.storage.from("message-attachments").upload(path, bytes, {
        contentType: attachment.contentType ?? "application/octet-stream",
        upsert: false,
      });
      if (error) throw error;
      stored.push({ name: attachment.name, contentType: attachment.contentType, size: bytes.byteLength, path });
    } catch (reason) {
      console.error(JSON.stringify({ message: "attachment skipped", name: attachment.name, error: String(reason) }));
    }
  }
  return stored;
}

/** Form posts (SendGrid, Mailgun): fields as-is, files as base64 attachments. */
async function formPayload(form: FormData): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  const attachments: Record<string, unknown>[] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    } else if (value.size <= MAX_ATTACHMENT_BYTES) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      attachments.push({ filename: value.name || key, contentType: value.type || null, size: value.size, content: btoa(binary) });
    }
  }
  return { ...fields, attachments };
}

/** Resend signs webhooks with svix: base64 HMAC-SHA256 of "id.timestamp.body". */
async function verifySvix(raw: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  const expected = btoa(binary);
  return signatures.split(" ").some((entry) => timingSafeEqual(entry.split(",")[1] ?? "", expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
