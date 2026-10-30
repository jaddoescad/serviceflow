"use server";

import { requireStaff } from "@/lib/auth";
import type { ChannelMode, PortalLanguage, PreferredTime } from "@/lib/portal-types";
import { createClient } from "@/lib/supabase/server";
import { publicWrite, type ActionResult } from "./rpc";

/** Staff: the customer's portal token, created the first time it's asked for. */
export async function getCustomerPortalToken(contactId: string): Promise<ActionResult & { token?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_customer_portal_token", { requested_contact: contactId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token: data as string };
}

// The customer's own actions; the portal token is the only credential.

export async function requestPortalAppointment(input: {
  token: string;
  times: PreferredTime[];
  note: string;
}): Promise<ActionResult> {
  return publicWrite("request_portal_appointment", {
    requested_token: input.token,
    requested_times: input.times,
    requested_note: input.note,
  });
}

export async function savePortalPreferences(input: {
  token: string;
  email: ChannelMode;
  sms: ChannelMode;
}): Promise<ActionResult> {
  return publicWrite("save_portal_preferences", {
    requested_token: input.token,
    requested_email: input.email,
    requested_sms: input.sms,
  });
}

export async function setPortalLanguage(input: { token: string; language: PortalLanguage }): Promise<ActionResult> {
  return publicWrite("set_portal_language", {
    requested_token: input.token,
    requested_language: input.language,
  });
}
