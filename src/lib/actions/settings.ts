"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LabourBudgetSettings = {
  hourlyRate: number;
  crewHoursPercent: number;
  costTargetPercent: number;
  canEdit: boolean;
};

function fromRpc(data: Record<string, unknown>): LabourBudgetSettings {
  return {
    hourlyRate: Number(data.hourly_rate_cents) / 100,
    crewHoursPercent: Number(data.crew_hours_percent),
    costTargetPercent: Number(data.cost_target_percent),
    canEdit: Boolean(data.can_edit),
  };
}

export async function getLabourBudgetSettings(): Promise<LabourBudgetSettings> {
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_labour_budget_settings");
  if (error || !data) throw new Error("Could not load labour budget settings.");
  return fromRpc(data);
}

/** Save the labour budget settings. They apply to jobs created from now on. */
export async function saveLabourBudgetSettings(input: {
  hourlyRate: number;
  crewHoursPercent: number;
  costTargetPercent: number;
}): Promise<{ ok: true; settings: LabourBudgetSettings } | { ok: false; error: string }> {
  if (!Number.isFinite(input.hourlyRate) || input.hourlyRate < 1 || input.hourlyRate > 500) {
    return { ok: false, error: "Enter an hourly rate between $1 and $500." };
  }
  for (const [label, value] of [
    ["crew hours percentage", input.crewHoursPercent],
    ["labour cost target", input.costTargetPercent],
  ] as const) {
    if (!Number.isFinite(value) || value < 1 || value > 100) {
      return { ok: false, error: `Enter a ${label} between 1 and 100.` };
    }
  }
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_labour_budget_settings", {
    requested_hourly_rate_cents: Math.round(input.hourlyRate * 100),
    requested_crew_hours_percent: input.crewHoursPercent,
    requested_cost_target_percent: input.costTargetPercent,
  });
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save settings." };

  revalidatePath("/settings");
  return { ok: true, settings: fromRpc(data) };
}
