// Only the server-side ServiceFlow message queue may use this relay.
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/send") return Response.json({ error: "Not found" }, { status: 404 });
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    if (!env.EMAIL_RELAY_SECRET || !env.EMAIL_FROM) return Response.json({ error: "Email sending is not configured" }, { status: 503 });
    if (!await authorized(request.headers.get("Authorization") ?? "", env.EMAIL_RELAY_SECRET)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    let message;
    try {
      message = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!message || typeof message.to !== "string" || typeof message.subject !== "string" ||
        typeof message.text !== "string" || typeof message.html !== "string") {
      return Response.json({ error: "Invalid email" }, { status: 400 });
    }
    try {
      const result = await env.EMAIL.send({
        from: { email: env.EMAIL_FROM, name: String(message.companyName ?? "ServiceFlow").replace(/[\r\n]/g, "") },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo || undefined,
        headers: message.headers,
        attachments: message.attachments,
      });
      if (!result?.messageId) throw new Error("Cloudflare returned no message ID");
      return Response.json({ id: result.messageId });
    } catch (error) {
      // Do not retry here: a timeout may occur after Cloudflare accepted mail.
      return Response.json({ error: error instanceof Error ? error.message : "Cloudflare email failed" }, { status: 502 });
    }
  },
};

async function authorized(value, secret) {
  const encode = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(value)),
    crypto.subtle.digest("SHA-256", encode.encode(`Bearer ${secret}`)),
  ]);
  const a = new Uint8Array(actual), b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
