"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CalculatorRates,
  ProjectCalculator,
  Quote,
  mergeRates,
  reviveProjectCalculator,
} from "@/lib/calculator/engine";
import { buildLabourBudgetDraft } from "@/lib/calculator/labour-budget";

export type DefaultCalculatorSelection = {
  id: string;
  projectId: string;
  quoteId: string;
  quoteName: string;
  sourceQuoteUpdatedAt: string;
  budgetedHours: number;
  taskCount: number;
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
  budgeted_hours: number | string;
  revision: number;
  published_at: string;
  project_labour_tasks?: Array<{ count: number }>;
  task_count?: number;
};

function toDefaultCalculatorSelection(row: LabourBudgetRow): DefaultCalculatorSelection {
  const relationCount = row.project_labour_tasks?.[0]?.count;
  return {
    id: row.id ?? row.labour_budget_id ?? "",
    projectId: row.companycam_project_id,
    quoteId: row.source_quote_id,
    quoteName: row.source_quote_name,
    sourceQuoteUpdatedAt: row.source_quote_updated_at,
    budgetedHours: Number(row.budgeted_hours) || 0,
    taskCount: Number(row.task_count ?? relationCount) || 0,
    revision: Number(row.revision) || 1,
    publishedAt: row.published_at,
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
    supabase
      .from("project_labour_budgets")
      .select("id,companycam_project_id,source_quote_id,source_quote_name,source_quote_updated_at,budgeted_hours,revision,published_at,project_labour_tasks(count)")
      .eq("companycam_project_id", projectId)
      .eq("is_active", true)
      .eq("project_labour_tasks.is_active", true)
      .maybeSingle<LabourBudgetRow>(),
  ]);

  if (calcRes.error) return { ok: false, error: calcRes.error.message };

  return {
    ok: true,
    doc: calcRes.data ? reviveProjectCalculator(calcRes.data.doc) : null,
    companyRates: mergeRates((settingsRes.data?.rates as Partial<CalculatorRates> | undefined) ?? undefined),
    defaultCalculator: defaultCalculatorRes.data
      ? toDefaultCalculatorSelection(defaultCalculatorRes.data)
      : null,
    defaultCalculatorError: defaultCalculatorRes.error?.message,
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
 * Save the calculator and make one quote the job default. Opening or editing a
 * different quote does not change the default; only this action does. Older
 * default/task snapshots remain inactive so time history is not destroyed.
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

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_project_labour_budget", {
    requested_project_id: projectId,
    calculator_doc: clean,
    requested_quote_id: quote.id,
    task_payloads: draft.tasks,
  });

  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as LabourBudgetRow | null;
  if (!row) return { ok: false, error: "The labour budget was not returned by the database." };

  revalidatePath(`/projects/${encodeURIComponent(projectId)}/calculator`);
  revalidatePath("/projects");
  revalidatePath("/");
  return { ok: true, defaultCalculator: toDefaultCalculatorSelection(row) };
}
