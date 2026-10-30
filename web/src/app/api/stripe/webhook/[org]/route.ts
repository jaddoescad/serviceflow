import { NextResponse, type NextRequest } from "next/server";
import { METADATA, serviceClient, verifyStripeSignature } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Each company adds this endpoint (with its org id) in its own Stripe account
// for checkout.session.completed and checkout.session.async_payment_succeeded.
// A verified, paid session that we created records the payment once; anything
// else is acknowledged and ignored. A non-2xx answer makes Stripe retry.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CheckoutSession = {
  id: string;
  amount_total: number | null;
  currency: string | null;
  payment_status: string;
  payment_intent: string | { id: string } | null;
  metadata: Record<string, string> | null;
};

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!UUID.test(org)) return reply(404, { error: "Unknown endpoint." });
  const supabase = serviceClient();
  if (!supabase) return reply(503, { error: "Online payments are not set up on this server." });

  const { data: secret, error: secretError } = await supabase.rpc("stripe_webhook_secret", { requested_org: org });
  if (secretError) return reply(500, { error: "Could not load the webhook settings." });
  if (!secret) return reply(404, { error: "This company has no webhook signing secret." });

  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret as string)) {
    return reply(400, { error: "Invalid signature." });
  }

  let event: { id: string; type: string; created: number; data: { object: CheckoutSession } };
  try {
    event = JSON.parse(payload);
  } catch {
    return reply(400, { error: "Invalid payload." });
  }
  const session = event.data?.object;
  const paid =
    (event.type === "checkout.session.completed" && session?.payment_status === "paid") ||
    event.type === "checkout.session.async_payment_succeeded";
  const invoiceId = session?.metadata?.[METADATA.invoice];
  // Other events, unpaid sessions and the company's own non-ServiceFlow checkouts.
  if (!paid || !invoiceId || !UUID.test(invoiceId) || session.metadata?.[METADATA.org] !== org) {
    return reply(200, { received: true, ignored: true });
  }

  const total = Number(session.amount_total ?? 0);
  const fee = Math.min(Math.max(Math.round(Number(session.metadata?.[METADATA.fee] ?? 0)) || 0, 0), total);
  const paymentIntent =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? session.id;
  const { data: outcome, error } = await supabase.rpc("record_stripe_payment", {
    requested_org: org,
    requested_event: event.id,
    requested_invoice: invoiceId,
    requested_amount_cents: total - fee,
    requested_fee_cents: fee,
    requested_payment_intent: paymentIntent,
    requested_paid_at: new Date((event.created || Date.now() / 1000) * 1000).toISOString(),
  });
  if (error) {
    console.error(JSON.stringify({ level: "error", message: "stripe webhook record", event: event.id, error: error.message }));
    return reply(500, { error: "Could not record the payment." });
  }
  return reply(200, { received: true, outcome });
}
