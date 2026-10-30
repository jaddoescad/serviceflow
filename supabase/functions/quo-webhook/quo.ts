// Quo (formerly OpenPhone) webhook parsing and signature checks.

export type InboundMessage = {
  channel: "sms";
  direction: "inbound" | "outbound";
  from: string | null;
  to: string | null;
  body: string;
  providerId: string | null;
  receivedAt: string | null;
  attachments: { url: string; contentType: string | null; name: string | null }[];
};

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const firstString = (value: unknown): string | null =>
  Array.isArray(value) ? value.map(asString).find(Boolean) ?? null : asString(value);

/** message.received is a customer's text; message.delivered is a text that went
 * out (from ServiceFlow or the Quo app). Legacy webhooks nest the message at
 * data.object; newer ones at data.resource, with the numbers in data.context.
 * Anything else returns null. */
export function parseQuoEvent(payload: unknown): InboundMessage | null {
  const event = asObject(payload);
  const type = asString(event?.type);
  const data = asObject(event?.data);
  const message = asObject(data?.object) ?? asObject(data?.resource);
  const context = asObject(data?.context);
  if (!message || (type !== "message.received" && type !== "message.delivered")) return null;
  if (message.object && message.object !== "message") return null;

  const direction = type === "message.received" || message.direction === "incoming" ? "inbound" : "outbound";
  const media = Array.isArray(message.media) ? message.media : [];
  return {
    channel: "sms",
    direction,
    from: firstString(message.from) ?? asString(context?.senderIdentifier),
    to: firstString(message.to) ?? firstString(context?.recipientIdentifiers),
    body: asString(message.body) ?? asString(message.text) ?? asString(message.content) ?? "",
    providerId: asString(message.id),
    receivedAt: asString(message.createdAt) ?? asString(event?.createdAt),
    attachments: media.flatMap((item) => {
      const entry = asObject(item);
      const url = asString(entry?.url) ?? asString(item);
      return url ? [{ url, contentType: asString(entry?.type), name: null }] : [];
    }),
  };
}

export type QuoCall = {
  id: string;
  direction: "incoming" | "outgoing";
  from: string | null;
  to: string | null;
  status: string | null;
  createdAt: string | null;
  duration?: number;
  answered?: boolean;
  recorded?: true;
  voicemail?: { duration: number | null };
};

/** call.completed is a finished, missed or voicemail call; call.recording.completed
 * adds its recording. Either payload shape; anything else returns null. */
export function parseQuoCall(payload: unknown): QuoCall | null {
  const event = asObject(payload);
  const type = asString(event?.type);
  if (type !== "call.completed" && type !== "call.recording.completed") return null;
  const data = asObject(event?.data);
  const call = asObject(data?.object) ?? asObject(data?.resource);
  const context = asObject(data?.context);
  const id = asString(call?.id);
  if (!call || !id || (call.object && call.object !== "call")) return null;

  const result: QuoCall = {
    id,
    direction: call.direction === "incoming" ? "incoming" : "outgoing",
    from: firstString(call.from) ?? asString(context?.senderIdentifier),
    to: firstString(call.to) ?? firstString(context?.recipientIdentifiers),
    status: asString(call.status),
    createdAt: asString(call.createdAt) ?? asString(event?.createdAt),
  };
  if (type === "call.recording.completed") return { ...result, recorded: true };

  const answeredAt = asString(call.answeredAt);
  const completedAt = asString(call.completedAt);
  const duration =
    typeof call.duration === "number"
      ? call.duration
      : answeredAt && completedAt
        ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(answeredAt)) / 1000))
        : undefined;
  result.answered = Boolean(answeredAt) || (call.status === "answered" && (duration ?? 0) > 0);
  if (duration !== undefined && Number.isFinite(duration)) result.duration = duration;
  const voicemail = asObject(call.voicemail);
  if (voicemail) result.voicemail = { duration: typeof voicemail.duration === "number" ? voicemail.duration : null };
  return result;
}

/** Quo signs webhooks one of two ways. Legacy webhooks send
 * "openphone-signature: hmac;1;<timestamp>;<base64 digest>" over
 * "<timestamp>.<body>"; newer ones send webhook-id, webhook-timestamp and
 * "webhook-signature: v1,<base64 digest> …" over "<id>.<timestamp>.<body>".
 * The key is the webhook's base64 key, without any "whsec_" prefix. */
export async function verifyQuoSignature(raw: string, headers: Headers, secret: string): Promise<boolean> {
  const key = await hmacKey(secret);
  const legacy = headers.get("openphone-signature");
  if (legacy) {
    const [scheme, , timestamp, digest] = legacy.split(";");
    if (scheme !== "hmac" || !timestamp || !digest) return false;
    // Quo signs the compact JSON; accept the raw body too in case it differs.
    const bodies = [raw];
    try {
      const compact = JSON.stringify(JSON.parse(raw));
      if (compact !== raw) bodies.push(compact);
    } catch {
      // Not JSON; only the raw body can match.
    }
    for (const body of bodies) {
      if (timingSafeEqual(await sign(key, `${timestamp}.${body}`), digest.trim())) return true;
    }
    return false;
  }

  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) return false;
  // Older than five minutes (or from the future) is a replay.
  if (!(Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300)) return false;
  const expected = await sign(key, `${id}.${timestamp}.${raw}`);
  return signatures.split(" ").some((entry) => {
    const [version, digest] = entry.split(",");
    return version === "v1" && Boolean(digest) && timingSafeEqual(expected, digest.trim());
  });
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const encoded = secret.trim().replace(/^whsec_/, "");
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } catch {
    keyBytes = new TextEncoder().encode(encoded);
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(key: CryptoKey, content: string): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content))));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
