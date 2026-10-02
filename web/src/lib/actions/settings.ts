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

export type CompanyProfile = {
  name: string;
  trade: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  createdAt: string;
};

export type CompanySettings = {
  company: CompanyProfile;
  myRole: string | null;
  canEdit: boolean;
  team: {
    active: number;
    inactive: number;
    owners: number;
    admins: number;
    managers: number;
    crew: number;
  };
  /** Managers only. */
  integrations: {
    dripjobs: { events: number; events30d: number; failed30d: number; lastReceivedAt: string | null };
    companycam: { photos: number; lastImportedAt: string | null };
    appPhotos: { photos: number; lastUploadedAt: string | null };
  } | null;
};

type Row = Record<string, unknown>;
const row = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});
const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

function labourFromRpc(data: Row): LabourBudgetSettings {
  return {
    hourlyRate: Number(data.hourly_rate_cents) / 100,
    crewHoursPercent: Number(data.crew_hours_percent),
    costTargetPercent: Number(data.cost_target_percent),
    canEdit: Boolean(data.can_edit),
  };
}

function companyFromRpc(data: Row): CompanySettings {
  const company = row(data.company);
  const team = row(data.team);
  const integrations = data.integrations ? row(data.integrations) : null;
  const dripjobs = row(integrations?.dripjobs);
  const companycam = row(integrations?.companycam);
  const appPhotos = row(integrations?.app_photos);
  return {
    company: {
      name: text(company.name) ?? "Your company",
      trade: text(company.trade),
      phone: text(company.phone),
      address: text(company.address),
      timezone: text(company.timezone) ?? "America/Toronto",
      createdAt: text(company.created_at) ?? "",
    },
    myRole: text(data.my_role),
    canEdit: Boolean(data.can_edit),
    team: {
      active: Number(team.active ?? 0),
      inactive: Number(team.inactive ?? 0),
      owners: Number(team.owners ?? 0),
      admins: Number(team.admins ?? 0),
      managers: Number(team.managers ?? 0),
      crew: Number(team.crew ?? 0),
    },
    integrations: integrations
      ? {
          dripjobs: {
            events: Number(dripjobs.events ?? 0),
            events30d: Number(dripjobs.events_30d ?? 0),
            failed30d: Number(dripjobs.failed_30d ?? 0),
            lastReceivedAt: text(dripjobs.last_received_at),
          },
          companycam: {
            photos: Number(companycam.photos ?? 0),
            lastImportedAt: text(companycam.last_imported_at),
          },
          appPhotos: {
            photos: Number(appPhotos.photos ?? 0),
            lastUploadedAt: text(appPhotos.last_uploaded_at),
          },
        }
      : null,
  };
}

export async function getLabourBudgetSettings(): Promise<LabourBudgetSettings> {
  const supabase = await createClient();
  const [, { data, error }] = await Promise.all([
    requireMember(),
    supabase.rpc("get_labour_budget_settings"),
  ]);
  if (error || !data) throw new Error("Could not load labour budget settings.");
  return labourFromRpc(row(data));
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const supabase = await createClient();
  const [, { data, error }] = await Promise.all([
    requireMember(),
    supabase.rpc("get_company_settings"),
  ]);
  if (error || !data) throw new Error("Could not load company settings.");
  return companyFromRpc(row(data));
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
  return { ok: true, settings: labourFromRpc(row(data)) };
}

export async function saveCompanyProfile(input: {
  name: string;
  trade: string | null;
  phone: string;
  address: string;
}): Promise<{ ok: true; settings: CompanySettings } | { ok: false; error: string }> {
  if (!input.name.trim() || input.name.trim().length > 120) {
    return { ok: false, error: "Enter a company name (up to 120 characters)." };
  }
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_company_profile", {
    requested_name: input.name,
    requested_trade: input.trade,
    requested_phone: input.phone,
    requested_address: input.address,
  });
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the company." };

  revalidatePath("/settings");
  return { ok: true, settings: companyFromRpc(row(data)) };
}
