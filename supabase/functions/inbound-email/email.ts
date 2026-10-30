// Parsing for inbound email webhooks: Postmark inbound JSON, Resend
// "email.received" events and plain {from, to, subject, text, html} JSON or
// form posts (SendGrid/Mailgun style).

export type EmailAttachment = {
  name: string;
  contentType: string | null;
  size: number | null;
  inline: boolean;
  /** Base64 file content, when the provider sends it in the webhook. */
  content?: string;
  /** Where to download it, when it doesn't. */
  url?: string;
};

export type ParsedEmail = {
  from: string | null;
  recipients: string[];
  subject: string | null;
  text: string | null;
  /** The provider's own reply-only text, when it has one. */
  strippedText: string | null;
  html: string | null;
  messageId: string | null;
  receivedAt: string | null;
  attachments: EmailAttachment[];
  /** Resend sends only metadata; the body is fetched with this id. */
  resendEmailId: string | null;
};

export type DeliveryEvent = { providerId: string; event: "delivered" | "bounced" | "failed" | "complained"; detail: string | null };

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** "Jane Doe <jane@example.com>" → "jane@example.com". */
export function emailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/<([^<>\s]+@[^<>\s]+)>/) ?? value.match(/([^\s<>,;"']+@[^\s<>,;"']+)/);
  return match ? match[1].toLowerCase() : null;
}

/** Every address in a header value, an array of strings, or Postmark-style objects. */
function addresses(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(addresses);
  const object = asObject(value);
  if (object) return addresses(object.Email ?? object.email ?? object.address);
  const text = asString(value);
  if (!text) return [];
  return text.split(/[,;]/).map(emailAddress).filter((item): item is string => Boolean(item));
}

function header(headers: unknown, name: string): string | null {
  if (Array.isArray(headers)) {
    const found = headers.map(asObject).find((h) => String(h?.Name ?? h?.name ?? "").toLowerCase() === name.toLowerCase());
    return asString(found?.Value ?? found?.value);
  }
  const object = asObject(headers);
  if (!object) return null;
  const key = Object.keys(object).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? asString(object[key]) : null;
}

function validDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function attachmentsOf(value: unknown): EmailAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const a = asObject(item);
    if (!a) return [];
    const content = asString(a.Content ?? a.content);
    const url = asString(a.download_url ?? a.url);
    if (!content && !url) return [];
    const disposition = String(a.content_disposition ?? a.ContentDisposition ?? "").toLowerCase();
    return [{
      name: asString(a.Name ?? a.filename ?? a.name) ?? "attachment",
      contentType: asString(a.ContentType ?? a.content_type ?? a.contentType ?? a.type),
      size: asNumber(a.ContentLength ?? a.size),
      inline: disposition === "inline" || Boolean(asString(a.ContentID ?? a.content_id)),
      ...(content ? { content } : { url: url! }),
    }];
  });
}

/** Delivery reports for email we sent (Resend webhooks), or null. */
export function parseDeliveryEvent(payload: unknown): DeliveryEvent | null {
  const event = asObject(payload);
  const data = asObject(event?.data);
  const providerId = asString(data?.email_id);
  const type = asString(event?.type);
  if (!providerId || !type) return null;
  const kinds: Record<string, DeliveryEvent["event"]> = {
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.failed": "failed",
    "email.complained": "complained",
  };
  if (!kinds[type]) return null;
  const bounce = asObject(data?.bounce);
  const failed = asObject(data?.failed);
  return { providerId, event: kinds[type], detail: asString(bounce?.message) ?? asString(failed?.reason) ?? null };
}

export function parseInboundEmail(payload: unknown): ParsedEmail | null {
  const root = asObject(payload);
  if (!root) return null;

  // Resend: {type: "email.received", data: {email_id, from, to, subject, ...}}
  if (root.type === "email.received") {
    const data = asObject(root.data);
    if (!data) return null;
    return {
      from: emailAddress(asString(data.from)),
      recipients: [...addresses(data.to), ...addresses(data.cc), ...addresses(data.bcc)],
      subject: asString(data.subject),
      text: asString(data.text),
      strippedText: null,
      html: asString(data.html),
      messageId: asString(data.message_id),
      receivedAt: validDate(asString(data.created_at)),
      attachments: attachmentsOf(data.attachments),
      resendEmailId: asString(data.email_id),
    };
  }

  // Postmark inbound.
  if ("FromFull" in root || "TextBody" in root || "HtmlBody" in root) {
    const fromFull = asObject(root.FromFull);
    return {
      from: emailAddress(asString(fromFull?.Email) ?? asString(root.From)),
      recipients: [
        ...addresses(root.ToFull ?? root.To),
        ...addresses(root.CcFull ?? root.Cc),
        ...addresses(root.BccFull ?? root.Bcc),
        ...addresses(root.OriginalRecipient),
      ],
      subject: asString(root.Subject),
      text: asString(root.TextBody),
      strippedText: asString(root.StrippedTextReply),
      html: asString(root.HtmlBody),
      messageId: header(root.Headers, "Message-ID") ?? (asString(root.MessageID) ? `<${root.MessageID}>` : null),
      receivedAt: validDate(asString(root.Date)),
      attachments: attachmentsOf(root.Attachments),
      resendEmailId: null,
    };
  }

  // Generic JSON or form fields.
  const from = emailAddress(asString(root.from) ?? asString(root.sender) ?? asString(root.From));
  if (!from) return null;
  return {
    from,
    recipients: [
      ...addresses(root.to ?? root.recipient ?? root.To),
      ...addresses(root.cc ?? root.Cc),
      ...addresses(root.envelope_to),
    ],
    subject: asString(root.subject ?? root.Subject),
    text: asString(root.text ?? root["body-plain"] ?? root.plain),
    strippedText: asString(root["stripped-text"]),
    html: asString(root.html ?? root["body-html"]),
    messageId: asString(root.message_id ?? root.messageId ?? root["Message-Id"]) ?? header(root.headers, "Message-ID"),
    receivedAt: validDate(asString(root.date ?? root.Date)),
    attachments: attachmentsOf(root.attachments),
    resendEmailId: null,
  };
}

/** The token in a reply+<token>@<domain> recipient. */
export function findReplyToken(recipients: string[], domain: string): string | null {
  const wanted = domain.trim().toLowerCase().replace(/^@/, "");
  for (const recipient of recipients) {
    const [local, host] = recipient.toLowerCase().split("@");
    if (host !== wanted) continue;
    const match = local?.match(/^reply\+([0-9a-f]{32})$/);
    if (match) return match[1];
  }
  return null;
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** Readable text from an HTML email, without the quoted thread below the reply. */
export function htmlToText(html: string): string {
  let body = html
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const quoteStart = body.search(
    /<(div|blockquote)[^>]*(class="[^"]*(gmail_quote|moz-cite-prefix|yahoo_quoted)[^"]*"|id="(appendonsend|divRplyFwdMsg)")|<blockquote[^>]*type="cite"/i,
  );
  if (quoteStart > 0) body = body.slice(0, quoteStart);
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (entity, code: string) => {
      const lower = code.toLowerCase();
      if (ENTITIES[lower]) return ENTITIES[lower];
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
      return entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_HEADER = [
  /^On .{3,200}wrote:\s*$/i,
  /^Le .{3,200}a écrit\s*:\s*$/i,
  /^-{2,}\s*(Original Message|Message d'origine|Courriel original)\s*-{2,}/i,
  /^_{10,}\s*$/,
];
const OUTLOOK_HEADER = /^(From|De)\s?:\s/i;
const OUTLOOK_NEXT = /^(Sent|Date|To|Envoyé|À|Subject|Objet)\s?:\s/i;
const SIGN_OFF = /^(Sent from my |Envoyé de mon |Get Outlook for |Sent from Yahoo Mail|Sent from Mail for Windows)/i;

/** The new part of a reply: everything above "On … wrote:" or a forwarded
 * header, without trailing "> quoted" lines or a "Sent from my iPhone" line. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const joined = `${line} ${lines[i + 1]?.trim() ?? ""}`;
    if (
      QUOTE_HEADER.some((pattern) => pattern.test(line)) ||
      (/^(On|Le) /.test(line) && QUOTE_HEADER.slice(0, 2).some((pattern) => pattern.test(joined))) ||
      (OUTLOOK_HEADER.test(line) && OUTLOOK_NEXT.test(lines[i + 1]?.trim() ?? ""))
    ) {
      end = i;
      break;
    }
  }
  const kept = lines.slice(0, end);
  while (kept.length && (/^\s*(>.*)?$/.test(kept[kept.length - 1]) || SIGN_OFF.test(kept[kept.length - 1].trim()))) {
    kept.pop();
  }
  const reply = kept.join("\n").trim();
  return reply || text.trim();
}
