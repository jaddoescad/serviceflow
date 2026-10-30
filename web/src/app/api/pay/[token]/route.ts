import { NextResponse, type NextRequest } from "next/server";
import { createCheckoutSession, serviceClient, type CheckoutContext } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The customer's Pay button posts here with their invoice or accepted
// proposal link's token. We open Stripe Checkout for what is owing, or send
// them back to the page with a reason the Pay button explains.

/** The page the customer came from: only their own invoice or proposal link. */
function returnPath(token: string, from: FormDataEntryValue | null): string {
  const safe = encodeURIComponent(token);
  return from === `/p/${safe}` ? `/p/${safe}` : `/i/${safe}`;
}

function back(request: NextRequest, path: string, reason: string) {
  return NextResponse.redirect(new URL(`${path}?pay_error=${reason}`, request.nextUrl.origin), 303);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await request.formData().catch(() => null);
  const fallback = returnPath(token, form?.get("from") ?? null);
  const supabase = serviceClient();
  if (!supabase) return back(request, fallback, "unavailable");

  const { data, error } = await supabase.rpc("stripe_checkout_context", { requested_token: token });
  if (error) {
    console.error(JSON.stringify({ level: "error", message: "stripe checkout context", error: error.message }));
    return back(request, fallback, "failed");
  }
  const context = data as CheckoutContext | null;
  if (!context) return back(request, fallback, "not_found");
  const path = context.returnPath ?? fallback;
  if (!context.payable) return back(request, path, context.reason ?? "unavailable");

  const origin = request.nextUrl.origin;
  const session = await createCheckoutSession(context, {
    success: `${origin}${path}?paid=1`,
    cancel: `${origin}${path}`,
  });
  if ("error" in session) {
    console.error(
      JSON.stringify({ level: "error", message: "stripe checkout session", invoice: context.invoiceId, error: session.error }),
    );
    return back(request, path, "failed");
  }
  return NextResponse.redirect(session.url, 303);
}
