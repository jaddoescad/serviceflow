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
  const profile = await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("project_budgets").upsert(
    {
      companycam_project_id: input.projectId,
      // Keep using the existing column for database compatibility. Its value
      // is now the manually entered pre-HST amount.
      amount_including_tax: input.amountBeforeTax,
      notes: input.notes ?? null,
      updated_by: profile.user_id,
    },
    { onConflict: "companycam_project_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/projects");
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
  const profile = await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("project_budgets").upsert(
    {
      companycam_project_id: input.projectId,
      labour_closed_at: input.closed ? new Date().toISOString() : null,
      labour_closed_by: input.closed ? profile.user_id : null,
      updated_by: profile.user_id,
    },
    { onConflict: "companycam_project_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/projects");
  revalidatePath("/");
  revalidatePath(`/projects/${input.projectId}`);
  return { ok: true };
}
