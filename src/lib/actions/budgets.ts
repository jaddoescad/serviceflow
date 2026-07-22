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
