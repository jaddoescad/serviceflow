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

/**
 * Mark a job's labour as settled, or reopen it.
 *
 * Closing means every painter invoice for the job is in, so its labour cost is
 * final and the job can join the headline labour-share number. Jobs left open
 * carry a partial cost against a full contract value, which is why they are
 * reported separately instead of averaged in.
 */
export async function setLabourClosed(input: {
  projectId: string;
  closed: boolean;
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_job_status", {
    requested_job_id: input.projectId,
    requested_status: input.closed ? "completed" : "active",
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/jobs");
  revalidatePath("/");
  revalidatePath(`/jobs/${input.projectId}`);
  return { ok: true };
}
