export type EmailMessage = {
  id: string;
  to: string | null;
  companyName: string;
  replyTo: string | null;
  inReplyTo: string | null;
  attachments: { url: string; name: string | null; contentType: string | null }[];
};

type Outcome = { status: "sent" | "failed" | "skipped"; error?: string; providerId?: string };

export async function sendEmail(
  message: EmailMessage,
  subject: string,
  body: string,
  unsubscribe: string,
  footer: boolean,
): Promise<Outcome> {
  const relayUrl = Deno.env.get("CLOUDFLARE_EMAIL_URL");
  const relaySecret = Deno.env.get("CLOUDFLARE_EMAIL_SECRET");
  if (!relayUrl || !relaySecret) return { status: "skipped", error: "Email sending isn't set up yet." };
  if (!message.to) return { status: "skipped", error: "Customer has no email address." };

  const inboundDomain = Deno.env.get("INBOUND_EMAIL_DOMAIN")?.trim().replace(/^@/, "");
  const replyTo = inboundDomain ? `reply+${message.id.replaceAll("-", "")}@${inboundDomain}` : message.replyTo;
  const headers: Record<string, string> = { "List-Unsubscribe": `<${unsubscribe}>` };
  if (message.inReplyTo) {
    headers["In-Reply-To"] = message.inReplyTo;
    headers["References"] = message.inReplyTo;
  }
  const text = footer ? `${body}\n\n—\nUnsubscribe: ${unsubscribe}` : body;
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#26303f">` +
    `${escapeHtml(body).replace(/\n/g, "<br>")}` +
    (footer
      ? `<p style="margin-top:32px;font-size:12px;color:#6b7688"><a href="${unsubscribe}" style="color:#6b7688">Unsubscribe</a></p>`
      : "") +
    `</div>`;
  const attachments = await loadAttachments(message.attachments ?? []);
  const response = await fetch(relayUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${relaySecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: message.companyName,
      to: message.to,
      subject: subject || message.companyName,
      text,
      html,
      replyTo: replyTo ?? undefined,
      headers,
      attachments,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result?.id !== "string" || !result.id) {
    return { status: "failed", error: result?.error ?? `Cloudflare email ${response.status}: missing delivery acknowledgement` };
  }
  return { status: "sent", providerId: result?.id };
}

// Leave room for MIME/base64 overhead under Cloudflare's 25 MiB message limit.
const MAX_ATTACHMENT_BYTES = 17 * 1024 * 1024;

async function loadAttachments(photos: EmailMessage["attachments"]) {
  let remaining = MAX_ATTACHMENT_BYTES;
  const attachments = [];
  for (const [index, photo] of photos.entries()) {
    const url = new URL(photo.url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Email attachments require an HTTPS URL.");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error(`Could not load email attachment ${index + 1}.`);
    if (Number(response.headers.get("content-length")) > remaining) {
      await response.body.cancel();
      throw new Error("Email attachments exceed the 17 MiB limit.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > remaining) {
          await reader.cancel();
          throw new Error("Email attachments exceed the 17 MiB limit.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    remaining -= length;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    attachments.push({
      content: btoa(binary),
      filename: photo.name ?? `photo-${index + 1}.jpg`,
      type: photo.contentType ?? response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
      disposition: "attachment",
    });
  }
  return attachments;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
