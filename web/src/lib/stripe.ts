import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only: imported by the /api/pay and /api/stripe route handlers and by
// server actions. Each company takes cards through its own Stripe account;
// its keys are read here with the service role and never reach the browser.

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2024-06-20";
/** Stripe's default; older signed events are refused as possible replays. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export const CARD_CURRENCY = "cad";

/** Elevated database access for the checkout and webhook routes; null until SUPABASE_SERVICE_ROLE_KEY is set. */
export function serviceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function onlinePaymentsAvailable(): boolean {
  return Boolean((process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** What stripe_checkout_context returns for a payable link. */
export type CheckoutContext = {
  payable: boolean;
  reason: "off" | "void" | "paid" | "locked" | null;
  invoiceNumber: number;
  invoiceName: string;
  invoiceKind: string;
  balanceCents: number;
  feePercent: number;
  feeCents: number;
  chargeCents: number;
  orgId: string;
  invoiceId: string;
  jobId: string;
  returnPath: string;
  secretKey: string;
  companyName: string;
  customerEmail: string | null;
};

/** Metadata on every session we create; the webhook ignores sessions without it. */
export const METADATA = {
  org: "serviceflow_org_id",
  invoice: "serviceflow_invoice_id",
  fee: "serviceflow_fee_cents",
} as const;

/** Creates a Checkout Session for the invoice balance plus any card fee. */
export async function createCheckoutSession(
  context: CheckoutContext,
  urls: { success: string; cancel: string },
): Promise<{ url: string } | { error: string }> {
  const title = context.invoiceKind === "deposit" ? "Deposit" : context.invoiceName;
  const form = new URLSearchParams({
    mode: "payment",
    success_url: urls.success,
    cancel_url: urls.cancel,
    "payment_method_types[0]": "card",
    client_reference_id: context.invoiceId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": CARD_CURRENCY,
    "line_items[0][price_data][unit_amount]": String(context.balanceCents),
    "line_items[0][price_data][product_data][name]": `${context.companyName} · Invoice #${context.invoiceNumber} ${title}`.slice(0, 250),
    "payment_intent_data[description]": `${context.companyName} invoice #${context.invoiceNumber}`.slice(0, 250),
  });
  if (context.feeCents > 0) {
    form.set("line_items[1][quantity]", "1");
    form.set("line_items[1][price_data][currency]", CARD_CURRENCY);
    form.set("line_items[1][price_data][unit_amount]", String(context.feeCents));
    form.set("line_items[1][price_data][product_data][name]", `Card processing fee (${Number(context.feePercent)}%)`);
  }
  const metadata = {
    [METADATA.org]: context.orgId,
    [METADATA.invoice]: context.invoiceId,
    [METADATA.fee]: String(context.feeCents),
  };
  for (const [key, value] of Object.entries(metadata)) {
    form.set(`metadata[${key}]`, value);
    form.set(`payment_intent_data[metadata][${key}]`, value);
  }
  if (context.customerEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(context.customerEmail)) {
    form.set("customer_email", context.customerEmail);
  }
  const response = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${context.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      // A double click or a second tab within ten minutes reuses the same session.
      "Idempotency-Key": `sf-${context.invoiceId}-${context.chargeCents}-${Math.floor(Date.now() / 600_000)}`,
    },
    body: form,
    cache: "no-store",
  }).catch((error: unknown) => ({ ok: false, status: 0, json: async () => ({ error: { message: String(error) } }) }));
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!response.ok || !body.url) return { error: body.error?.message ?? `Stripe responded ${response.status}` };
  return { url: body.url };
}

/**
 * Checks a Stripe-Signature header (t=…,v1=…) against the raw body with the
 * endpoint's signing secret, in constant time and within the tolerance.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((piece) => piece?.trim());
    if (key === "t") timestamp = Number(value);
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest();
  return signatures.some((signature) => {
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
