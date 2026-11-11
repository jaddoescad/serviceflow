import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type EmailAttachment,
  findReplyToken,
  htmlToText,
  parseInboundEmail,
  stripQuotedReply,
} from "./email.ts";

// Receives customer replies from a provider posting complete JSON or form data.
// The URL carries INBOUND_EMAIL_TOKEN. Replies are matched by the address
// reply+<message id>@INBOUND_EMAIL_DOMAIN.

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
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = parseInboundEmail(payload);
  if (!email) return json({ ignored: "Not an email." });
  const replyToken = findReplyToken(email.recipients, domain);
  // Acknowledged so the provider stops retrying; there is nowhere to put it.
  if (!replyToken) return json({ ignored: "No reply address." });

  const { data: orgId, error: orgError } = await supabase.rpc("resolve_reply_token", { requested_token: replyToken });
  if (orgError) return json({ error: orgError.message }, 500);
  if (!orgId) return json({ ignored: "Unknown reply address." });

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

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
