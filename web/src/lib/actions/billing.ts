"use server";

import { headers } from "next/headers";
import type { BillingBody, PaymentMethod, PaymentSettings, PublicPaymentOptions } from "@/lib/billing-types";
import { onlinePaymentsAvailable } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { publicWrite, staffRead, staffWrite, type ActionResult } from "./rpc";

const BILLING_PATHS = ["/jobs", "/invoices", "/change-orders", "/pipeline"];

export async function saveChangeOrder(input: { id: string; jobId: string; body: BillingBody }) {
  return staffWrite(
    "save_change_order",
    {
      requested_id: input.id,
      requested_job: input.jobId,
      requested_name: input.body.name,
      requested_items: input.body.items,
      requested_tax_rate: input.body.taxRatePercent,
      requested_intro: input.body.message,
    },
    BILLING_PATHS,
  );
}

export async function closeChangeOrder(id: string, action: "cancel" | "delete") {
  return staffWrite("set_change_order_closed", { requested_id: id, requested_action: action }, BILLING_PATHS);
}

export async function saveInvoice(input: { id: string; jobId: string; body: BillingBody }) {
  return staffWrite(
    "save_invoice",
    {
      requested_id: input.id,
      requested_job: input.jobId,
      requested_name: input.body.name,
      requested_kind: input.body.invoiceKind,
      requested_items: input.body.items,
      requested_tax_rate: input.body.taxRatePercent,
      requested_issued_on: input.body.issuedOn || null,
      requested_due_on: input.body.dueOn || null,
      requested_notes: input.body.message,
    },
    BILLING_PATHS,
  );
}

export async function closeInvoice(id: string, action: "void" | "delete") {
  return staffWrite("set_invoice_closed", { requested_id: id, requested_action: action }, BILLING_PATHS);
}

export async function recordInvoicePayment(input: {
  invoiceId: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
}) {
  return staffWrite(
    "record_invoice_payment",
    {
      requested_invoice: input.invoiceId,
      requested_amount_cents: input.amountCents,
      requested_paid_on: input.paidOn || null,
      requested_method: input.method,
      requested_reference: input.reference,
    },
    BILLING_PATHS,
  );
}

export async function deleteInvoicePayment(id: string) {
  return staffWrite("delete_invoice_payment", { requested_payment: id }, BILLING_PATHS);
}

export async function acceptPublicChangeOrder(input: {
  token: string;
  signer: string;
  selected: string[];
  /** The drawn signature as a PNG data URL. */
  signature: string;
}): Promise<ActionResult> {
  return publicWrite(
    "accept_public_change_order",
    {
      requested_token: input.token,
      requested_signer: input.signer,
      requested_selected: input.selected,
      requested_signature: input.signature,
    },
    [`/co/${input.token}`],
  );
}

export async function declinePublicChangeOrder(input: { token: string; reason: string }): Promise<ActionResult> {
  return publicWrite(
    "decline_public_change_order",
    { requested_token: input.token, requested_reason: input.reason },
    [`/co/${input.token}`],
  );
}

/** What the customer's Pay button offers; null when the company doesn't take cards online. */
export async function getPublicPaymentOptions(token: string): Promise<PublicPaymentOptions | null> {
  if (!onlinePaymentsAvailable() || typeof token !== "string" || token.length < 24) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_payment_options", { requested_token: token });
  if (error) return null;
  return (data as PublicPaymentOptions | null) ?? null;
}

/** The company's Stripe connection for Settings, with the webhook address to paste into Stripe. */
export async function getPaymentSettings(): Promise<PaymentSettings> {
  const [settings, requestHeaders] = await Promise.all([
    staffRead<Omit<PaymentSettings, "webhookUrl" | "serverReady">>("get_payment_settings"),
    headers(),
  ]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "serviceflow-admin.vercel.app";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return {
    ...settings,
    cardFeePercent: Number(settings.cardFeePercent ?? 0),
    webhookUrl: `${protocol}://${host}/api/stripe/webhook/${settings.orgId}`,
    serverReady: onlinePaymentsAvailable(),
  };
}

/** A null key or secret keeps the saved one; an empty string removes it. */
export async function savePaymentSettings(input: {
  secretKey: string | null;
  webhookSecret: string | null;
  acceptCards: boolean;
  cardFeePercent: number;
}) {
  return staffWrite(
    "save_payment_settings",
    {
      requested_secret_key: input.secretKey,
      requested_webhook_secret: input.webhookSecret,
      requested_accept_cards: input.acceptCards,
      requested_card_fee_percent: input.cardFeePercent,
    },
    ["/settings", "/invoices", "/jobs"],
  );
}
