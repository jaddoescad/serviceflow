"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CalculatorRates,
  ProjectCalculator,
  Quote,
  computeTotals,
  mergeRates,
  reviveProjectCalculator,
} from "@/lib/calculator/engine";
import { buildLabourBudgetDraft } from "@/lib/calculator/labour-budget";

export type LabourBudgetTaskSelection = {
  id: string;
  sourceKind: "room" | "exterior" | "washing" | "custom";
  sourceItemId: string;
  title: string;
  calculatedHours: number;
  manualBudgetedHours: number | null;
  budgetedHours: number;
  sortOrder: number;
};

export type DefaultCalculatorSelection = {
  id: string;
  projectId: string;
  quoteId: string;
  quoteName: string;
  sourceQuoteUpdatedAt: string;
  calculatedHours: number;
  budgetedHours: number;
  taskCount: number;
  tasks: LabourBudgetTaskSelection[];
  revision: number;
  publishedAt: string;
};

export type LoadCalculatorResult =
  | {
      ok: true;
      doc: ProjectCalculator | null;
      companyRates: CalculatorRates;
      defaultCalculator: DefaultCalculatorSelection | null;
      defaultCalculatorError?: string;
    }
  | { ok: false; error: string };

type LabourBudgetRow = {
  id?: string;
  labour_budget_id?: string;
  companycam_project_id: string;
  source_quote_id: string;
  source_quote_name: string;
  source_quote_updated_at: string;
  calculated_hours: number | string;
  budgeted_hours: number | string;
  revision: number;
  published_at: string;
};

type LabourBudgetTaskRow = {
  id: string;
  source_kind: LabourBudgetTaskSelection["sourceKind"];
  source_item_id: string;
  title: string;
  calculated_hours: number | string;
  manual_budgeted_hours: number | string | null;
  budgeted_hours: number | string;
  sort_order: number;
};

function toLabourBudgetTaskSelection(row: LabourBudgetTaskRow): LabourBudgetTaskSelection {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceItemId: row.source_item_id,
    title: row.title,
    calculatedHours: Number(row.calculated_hours) || 0,
    manualBudgetedHours:
      row.manual_budgeted_hours === null ? null : Number(row.manual_budgeted_hours) || 0,
    budgetedHours: Number(row.budgeted_hours) || 0,
    sortOrder: Number(row.sort_order) || 0,
  };
}

function toDefaultCalculatorSelection(
  row: LabourBudgetRow,
  taskRows: LabourBudgetTaskRow[],
): DefaultCalculatorSelection {
  const tasks = taskRows.map(toLabourBudgetTaskSelection);
  return {
    id: row.id ?? row.labour_budget_id ?? "",
    projectId: row.companycam_project_id,
    quoteId: row.source_quote_id,
    quoteName: row.source_quote_name,
    sourceQuoteUpdatedAt: row.source_quote_updated_at,
    calculatedHours: Number(row.calculated_hours) || 0,
    budgetedHours: Number(row.budgeted_hours) || 0,
    taskCount: tasks.length,
    tasks,
    revision: Number(row.revision) || 1,
    publishedAt: row.published_at,
  };
}

async function loadDefaultCalculatorSelection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<{ selection: DefaultCalculatorSelection | null; error?: string }> {
  const budgetRes = await supabase
    .from("project_labour_budgets")
    .select("id,companycam_project_id,source_quote_id,source_quote_name,source_quote_updated_at,calculated_hours,budgeted_hours,revision,published_at")
    .eq("companycam_project_id", projectId)
    .eq("is_active", true)
    .maybeSingle<LabourBudgetRow>();

  if (budgetRes.error) return { selection: null, error: budgetRes.error.message };
  if (!budgetRes.data) return { selection: null };

  const taskRes = await supabase
    .from("project_labour_tasks")
    .select("id,source_kind,source_item_id,title,calculated_hours,manual_budgeted_hours,budgeted_hours,sort_order")
    .eq("labour_budget_id", budgetRes.data.id ?? budgetRes.data.labour_budget_id ?? "")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (taskRes.error) return { selection: null, error: taskRes.error.message };
  return {
    selection: toDefaultCalculatorSelection(
      budgetRes.data,
      (taskRes.data ?? []) as LabourBudgetTaskRow[],
    ),
  };
}

export async function loadCalculator(projectId: string): Promise<LoadCalculatorResult> {
  await requireStaff();
  const supabase = await createClient();

  const [calcRes, settingsRes, defaultCalculatorRes] = await Promise.all([
    supabase
      .from("project_calculators")
      .select("doc")
      .eq("companycam_project_id", projectId)
      .maybeSingle(),
    supabase.from("calculator_settings").select("rates").eq("id", "default").maybeSingle(),
    loadDefaultCalculatorSelection(supabase, projectId),
  ]);

  if (calcRes.error) return { ok: false, error: calcRes.error.message };

  return {
    ok: true,
    doc: calcRes.data ? reviveProjectCalculator(calcRes.data.doc) : null,
    companyRates: mergeRates((settingsRes.data?.rates as Partial<CalculatorRates> | undefined) ?? undefined),
    defaultCalculator: defaultCalculatorRes.selection,
    defaultCalculatorError: defaultCalculatorRes.error,
  };
}

export async function saveCalculator(
  projectId: string,
  doc: ProjectCalculator,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireStaff();
  const clean = reviveProjectCalculator(doc);
  if (!clean) return { ok: false, error: "Invalid calculator document." };

  const supabase = await createClient();
  const { error } = await supabase.from("project_calculators").upsert(
    {
      companycam_project_id: projectId,
      doc: clean,
      updated_by: profile.user_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "companycam_project_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function saveCompanyRates(
  rates: CalculatorRates,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("calculator_settings").upsert(
    {
      id: "default",
      rates: mergeRates(rates),
      updated_by: profile.user_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type MakeCalculatorDefaultResult =
  | { ok: true; defaultCalculator: DefaultCalculatorSelection }
  | { ok: false; error: string };

/**
 * Save the calculator and publish one quote as the job default. The same
 * transaction synchronizes the quote's HST-inclusive total to the job amount.
 * The UI calls this both when a manager selects a default and when autosave
 * republishes edits to that default. Other quotes never replace it implicitly.
 * Older task snapshots remain inactive so time history is not destroyed.
 */
export async function makeCalculatorDefault(
  projectId: string,
  doc: ProjectCalculator,
  quoteId: string,
): Promise<MakeCalculatorDefaultResult> {
  await requireStaff();
  if (!projectId.trim()) return { ok: false, error: "A job is required." };

  const clean = reviveProjectCalculator(doc);
  if (!clean) return { ok: false, error: "Invalid calculator document." };

  const quote: Quote | undefined = clean.quotes.find((candidate) => candidate.id === quoteId);
  if (!quote) return { ok: false, error: "Choose a calculator before making it the default." };

  const draft = buildLabourBudgetDraft(quote);
  const amountIncludingTax = Math.round(computeTotals(quote).totalWithHst * 100) / 100;
  if (!Number.isFinite(amountIncludingTax) || amountIncludingTax < 0) {
    return { ok: false, error: "The calculator client total must be zero or greater." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_project_calculator_default", {
    requested_project_id: projectId,
    calculator_doc: clean,
    requested_quote_id: quote.id,
    task_payloads: draft.tasks,
    requested_amount_including_tax: amountIncludingTax,
  });

  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as LabourBudgetRow | null;
  if (!row) return { ok: false, error: "The labour budget was not returned by the database." };

  const refreshed = await loadDefaultCalculatorSelection(supabase, projectId);
  if (refreshed.error || !refreshed.selection) {
    return { ok: false, error: refreshed.error ?? "The published labour tasks could not be loaded." };
  }

  revalidatePath(`/projects/${encodeURIComponent(projectId)}/calculator`);
  revalidatePath("/projects");
  revalidatePath("/");
  return { ok: true, defaultCalculator: refreshed.selection };
}

export type SetLabourTaskBudgetHoursResult =
  | { ok: true; defaultCalculator: DefaultCalculatorSelection }
  | { ok: false; error: string };

/** Set a manager override, or pass null to restore the stored calculated hours. */
export async function setLabourTaskBudgetHours(
  projectId: string,
  taskId: string,
  budgetedHours: number | null,
): Promise<SetLabourTaskBudgetHoursResult> {
  await requireStaff();
  if (!projectId.trim() || !taskId.trim()) {
    return { ok: false, error: "A job and painter task are required." };
  }
  if (budgetedHours !== null && (!Number.isFinite(budgetedHours) || budgetedHours < 0)) {
    return { ok: false, error: "Task hours must be zero or greater." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_project_labour_task_budget_hours", {
    requested_project_id: projectId,
    requested_task_id: taskId,
    requested_budgeted_hours: budgetedHours,
  });
  if (error) return { ok: false, error: error.message };

  const refreshed = await loadDefaultCalculatorSelection(supabase, projectId);
  if (refreshed.error || !refreshed.selection) {
    return { ok: false, error: refreshed.error ?? "The updated labour budget could not be loaded." };
  }

  revalidatePath(`/projects/${encodeURIComponent(projectId)}/calculator`);
  revalidatePath("/projects");
  revalidatePath("/");
  return { ok: true, defaultCalculator: refreshed.selection };
}
