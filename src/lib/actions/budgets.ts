"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

/** Store the manually entered pre-HST job amount. */
export async function setJobAmount(input: {
  projectId: string;
  amountBeforeTax: number | null;
  notes?: string | null;
}): Promise<ActionResult> {
  if (
    input.amountBeforeTax != null &&
    (!Number.isFinite(input.amountBeforeTax) || input.amountBeforeTax < 0)
  ) {
    return { ok: false, error: "Enter a valid customer amount." };
  }
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_job_budget", {
    requested_job_id: input.projectId,
    requested_budget_minutes: null,
    requested_hourly_rate_cents: null,
    requested_amount_including_tax_cents:
      input.amountBeforeTax == null ? null : Math.round(input.amountBeforeTax * 100),
    requested_notes: input.notes ?? null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/jobs");
  revalidatePath("/");
  return { ok: true };
}
