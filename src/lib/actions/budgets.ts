"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

/** Store the single customer amount. Labour figures remove HST at read time. */
export async function setJobAmount(input: {
  projectId: string;
  amountIncludingTax: number | null;
  notes?: string | null;
}): Promise<ActionResult> {
  if (
    input.amountIncludingTax != null &&
    (!Number.isFinite(input.amountIncludingTax) || input.amountIncludingTax < 0)
  ) {
    return { ok: false, error: "Enter a valid customer amount." };
  }
  const profile = await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("project_budgets").upsert(
    {
      companycam_project_id: input.projectId,
      amount_including_tax: input.amountIncludingTax,
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
