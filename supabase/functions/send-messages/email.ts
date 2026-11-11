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
  button?: { url: string; label: string },
): Promise<Outcome> {
  const relayUrl = Deno.env.get("CLOUDFLARE_EMAIL_URL");
  const relaySecret = Deno.env.get("CLOUDFLARE_EMAIL_SECRET");
  if (!relayUrl || !relaySecret) return { status: "skipped", error: "Email sending isn't set up yet." };
  if (!message.to) return { status: "skipped", error: "Customer has no email address." };

  const inboundDomain = Deno.env.get("INBOUND_EMAIL_DOMAIN")?.trim().replace(/^@/, "");
  const replyTo = inboundDomain ? `reply+${message.id.replaceAll("-", "")}@${inboundDomain}` : message.replyTo;
  const headers: Record<string, string> = {};
  if (message.inReplyTo) {
    headers["In-Reply-To"] = message.inReplyTo;
    headers["References"] = message.inReplyTo;
  }
  const html = renderHtml(message.companyName, body, button);
  const attachments = await loadAttachments(message.attachments ?? []);
  const response = await fetch(relayUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${relaySecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: message.companyName,
      to: message.to,
      subject: subject || message.companyName,
      text: body,
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

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The message as written, one paragraph per blank-line-separated block, with
 * links clickable. A document's email sits on a card under the company's name,
 * and the paragraph that is just its link becomes a button.
 */
export function renderHtml(
  companyName: string,
  body: string,
  button?: { url: string; label: string },
): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) =>
      button && isLinkTo(block, button.url)
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr>` +
          `<td style="border-radius:8px;background:#1f2937">` +
          `<a href="${escapeHtml(button.url)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(button.label)}</a>` +
          `</td></tr></table>`
        : `<p style="margin:0 0 16px">${linkify(escapeHtml(block)).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  if (!button) {
    return `<div style="font-family:${FONT};font-size:15px;line-height:1.55;color:#26303f">${paragraphs}</div>`;
  }
  return (
    `<div style="margin:0;padding:32px 16px;background:#f3f4f6">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">` +
    `<tr><td style="padding:22px 32px;border-bottom:1px solid #eef0f3;font-family:${FONT};font-size:17px;font-weight:600;color:#111827">${escapeHtml(companyName)}</td></tr>` +
    `<tr><td style="padding:28px 32px 12px;font-family:${FONT};font-size:15px;line-height:1.6;color:#26303f">${paragraphs}</td></tr>` +
    `</table>` +
    `</div>`
  );
}

/** A paragraph that is only a link to the document, on whichever domain it was written. */
function isLinkTo(block: string, url: string): boolean {
  if (!/^https?:\/\/\S+$/.test(block)) return false;
  try {
    return new URL(block).pathname === new URL(url).pathname;
  } catch {
    return false;
  }
}

/** Makes http(s) links in already-escaped text clickable. */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)'"&]/g, (url) => `<a href="${url}" style="color:#2563eb">${url}</a>`);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
