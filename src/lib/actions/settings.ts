"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LabourBudgetSettings = {
  hourlyRate: number;
  allocationPercent: number;
  canEdit: boolean;
  openFormulaJobs: number;
  lockedFormulaJobs: number;
};

export async function getLabourBudgetSettings(): Promise<LabourBudgetSettings> {
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_labour_budget_settings");
  if (error || !data) throw new Error("Could not load labour budget settings.");
  return {
    hourlyRate: Number(data.hourly_rate_cents) / 100,
    allocationPercent: Number(data.allocation_percent),
    canEdit: Boolean(data.can_edit),
    openFormulaJobs: Number(data.open_formula_jobs),
    lockedFormulaJobs: Number(data.locked_formula_jobs),
  };
}

/** Set the standard hourly rate that turns labour budgets into crew hours. */
export async function saveLabourBudgetRate(input: {
  hourlyRate: number;
  recalculateOpenJobs: boolean;
}): Promise<{ ok: boolean; error?: string; recalculatedJobs?: number }> {
  if (!Number.isFinite(input.hourlyRate) || input.hourlyRate < 1 || input.hourlyRate > 500) {
    return { ok: false, error: "Enter an hourly rate between $1 and $500." };
  }
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_labour_budget_settings", {
    requested_hourly_rate_cents: Math.round(input.hourlyRate * 100),
    recalculate_open_jobs: input.recalculateOpenJobs,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, recalculatedJobs: Number(data?.recalculated_jobs ?? 0) };
}
