"use server";

import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { staffRead, type ActionResult } from "./rpc";

export type LeadIntakeSource = "zapier" | "facebook" | "google";

export type LeadIntakeDelivery = {
  id: string;
  source: LeadIntakeSource;
  status: "created" | "duplicate" | "test" | "rejected";
  summary: string | null;
  error: string | null;
  leadId: string | null;
  receivedAt: string;
};

export type LeadIntakeSettings = {
  /** Webhook address without the source, e.g. https://….supabase.co/functions/v1/lead-intake?token=… */
  endpoint: string;
  deliveries: LeadIntakeDelivery[];
};

function endpointFor(token: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "");
  return `${base}/functions/v1/lead-intake?token=${encodeURIComponent(token)}`;
}

/** The company's webhook address (its token is made on first look) and the last 20 posts. */
export async function getLeadIntakeSettings(): Promise<LeadIntakeSettings> {
  const data = await staffRead<{ token: string; deliveries: LeadIntakeDelivery[] }>("get_lead_intake_settings");
  return { endpoint: endpointFor(data.token), deliveries: data.deliveries };
}

/** A new secret; the old addresses stop working at once. */
export async function regenerateLeadIntakeToken(): Promise<ActionResult & { endpoint?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("regenerate_lead_intake_token");
  if (error) return { ok: false, error: error.message };
  return { ok: true, endpoint: endpointFor(data as string) };
}
