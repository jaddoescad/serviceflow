"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CalculatorRates,
  ProjectCalculator,
  computeTotals,
  mergeCompanyRates,
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

async function context(supabase: Awaited<ReturnType<typeof createClient>>, entityId: string) {
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,lead_id,accepted_quote_id")
    .eq("id", entityId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (job) {
    const quoteQuery = supabase.from("quotes").select("*");
    const { data: quoteRows, error } = job.accepted_quote_id
      ? await quoteQuery.eq("id", job.accepted_quote_id).limit(1)
      : await quoteQuery.eq("lead_id", job.lead_id).order("updated_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return { kind: "job" as const, entityId, leadId: job.lead_id, quote: (quoteRows ?? [])[0] ?? null };
  }
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", entityId)
    .maybeSingle();
  if (leadError) throw new Error(leadError.message);
  if (!lead) return null;
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("lead_id", entityId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const quote = (quotes ?? []).find((row) => row.calculator_doc) ?? (quotes ?? [])[0] ?? null;
  return { kind: "lead" as const, entityId, leadId: entityId, quote };
}

async function defaultSelection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityId: string,
  quote: any,
  knownJob = false,
): Promise<DefaultCalculatorSelection | null> {
  if (!knownJob) {
    const { data: job } = await supabase.from("jobs").select("id").eq("id", entityId).maybeSingle();
    if (!job) return null;
  }
  const [{ data: budgets, error: budgetError }, { data: tasks, error: taskError }] = await Promise.all([
    supabase.from("job_budgets").select("*").eq("job_id", entityId).in("status", ["active", "closed"]).order("version", { ascending: false }).limit(1),
    supabase.from("job_tasks").select("*").eq("job_id", entityId).neq("status", "cancelled").order("sort_order"),
  ]);
  if (budgetError) throw new Error(budgetError.message);
  if (taskError) throw new Error(taskError.message);
  const budget = (budgets ?? [])[0];
  if (!budget || !quote?.calculator_doc) return null;
  const doc = reviveProjectCalculator(quote.calculator_doc);
  const activeQuote = doc?.quotes.find((candidate) => candidate.id === doc.activeQuoteId) ?? doc?.quotes[0];
  const rows: LabourBudgetTaskSelection[] = (tasks ?? []).map((task: any) => ({
    id: task.id,
    sourceKind: task.source_kind,
    sourceItemId: task.source_item_id,
    title: task.title,
    calculatedHours: Number(task.calculated_minutes ?? task.budget_minutes ?? 0) / 60,
    manualBudgetedHours: task.budget_minutes == null ? null : Number(task.budget_minutes) / 60,
    budgetedHours: Number(task.budget_minutes ?? task.calculated_minutes ?? 0) / 60,
    sortOrder: Number(task.sort_order ?? 0),
  }));
  return {
    id: budget.id,
    projectId: entityId,
    quoteId: activeQuote?.id ?? quote.id,
    quoteName: activeQuote?.name ?? quote.name,
    sourceQuoteUpdatedAt: activeQuote?.updatedAt ?? quote.updated_at,
    calculatedHours: Number(budget.calculated_minutes ?? budget.budget_minutes ?? 0) / 60,
    budgetedHours: Number(budget.budget_minutes ?? 0) / 60,
    taskCount: rows.length,
    tasks: rows,
    revision: Number(budget.version ?? 1),
    publishedAt: budget.updated_at,
  };
}

export async function loadCalculator(entityId: string): Promise<LoadCalculatorResult> {
  await requireStaff();
  const supabase = await createClient();
  try {
    const [resolved, settings] = await Promise.all([
      context(supabase, entityId),
      supabase.from("app_config").select("settings").eq("id", "default").maybeSingle(),
    ]);
    if (!resolved) return { ok: false, error: "Lead or job not found." };
    const doc = resolved.quote?.calculator_doc
      ? reviveProjectCalculator(resolved.quote.calculator_doc)
      : null;
    return {
      ok: true,
      doc,
      companyRates: mergeCompanyRates(
        (settings.data?.settings?.calculator_rates as Partial<CalculatorRates> | undefined) ?? undefined,
      ),
      defaultCalculator: resolved.kind === "job"
        ? await defaultSelection(supabase, entityId, resolved.quote, true)
        : null,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Calculator failed to load." };
  }
}

export async function saveCalculator(
  entityId: string,
  doc: ProjectCalculator,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const clean = reviveProjectCalculator(doc);
  if (!clean) return { ok: false, error: "Invalid calculator document." };
  const quote = clean.quotes.find((candidate) => candidate.id === clean.activeQuoteId) ?? clean.quotes[0];
  if (!quote) return { ok: false, error: "Calculator quote not found." };
  const supabase = await createClient();
  try {
    const resolved = await context(supabase, entityId);
    if (!resolved) return { ok: false, error: "Lead or job not found." };
    const totals = computeTotals(quote);
    const status = quote.status === "won" ? "accepted" : quote.status === "lost" ? "declined" : quote.status;
    const { error } = await supabase.rpc("publish_quote", {
      requested_lead_id: resolved.leadId,
      requested_quote_id: resolved.quote?.id ?? null,
      requested_name: quote.name,
      requested_amount_cents: Math.round(totals.price * 100),
      requested_calculator_doc: clean,
      requested_status: status,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Calculator failed to save." };
  }
}

export async function saveCompanyRates(rates: CalculatorRates): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_calculator_rates", {
    requested_rates: mergeRates(rates),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export type MakeCalculatorDefaultResult =
  | { ok: true; defaultCalculator: DefaultCalculatorSelection }
  | { ok: false; error: string };

export async function makeCalculatorDefault(
  projectId: string,
  doc: ProjectCalculator,
  quoteId: string,
): Promise<MakeCalculatorDefaultResult> {
  await requireStaff();
  const clean = reviveProjectCalculator(doc);
  const quote = clean?.quotes.find((candidate) => candidate.id === quoteId);
  if (!clean || !quote) return { ok: false, error: "Choose a calculator before transferring it." };
  const supabase = await createClient();
  const resolved = await context(supabase, projectId);
  if (!resolved || resolved.kind !== "job") {
    return { ok: false, error: "Accept the quote before publishing painter tasks." };
  }
  const draft = buildLabourBudgetDraft(quote);
  const { data: existing, error: existingError } = await supabase
    .from("job_tasks")
    .select("id,source_kind,source_item_id")
    .eq("job_id", projectId);
  if (existingError) return { ok: false, error: existingError.message };
  const existingBySource = new Map((existing ?? []).map((task: any) => [`${task.source_kind}:${task.source_item_id}`, task.id]));
  const activeQuote = clean.quotes.find((candidate) => candidate.id === clean.activeQuoteId) ?? clean.quotes[0];
  const { error } = await supabase.rpc("publish_calculator_budget", {
    requested_job_id: projectId,
    payload: {
      tasks: draft.tasks.map((task) => ({
        id: existingBySource.get(`${task.sourceKind}:${task.sourceItemId}`) ?? null,
        title: task.title,
        notes: task.notes,
        minutes: Math.round(task.budgetedHours * 60),
        sortOrder: task.sortOrder,
      })),
      minutes: Math.round(draft.totalBudgetedHours * 60),
      notes: `Published from ${quote.name}`,
      leadId: resolved.leadId,
      quoteId: resolved.quote?.id ?? null,
      quoteName: activeQuote.name,
      quoteAmountCents: Math.round(computeTotals(activeQuote).price * 100),
      quoteStatus: activeQuote.status === "won" ? "accepted" : activeQuote.status === "lost" ? "declined" : activeQuote.status,
      doc: clean,
    },
  });
  if (error) return { ok: false, error: error.message };
  const selection = await defaultSelection(supabase, projectId, { ...resolved.quote, calculator_doc: clean });
  if (!selection) return { ok: false, error: "Published tasks could not be reloaded." };
  revalidatePath(`/jobs/${projectId}`);
  revalidatePath(`/jobs/${projectId}/tasks`);
  revalidatePath(`/jobs/${projectId}/calculator`);
  return { ok: true, defaultCalculator: selection };
}

export type SetLabourTaskBudgetHoursResult =
  | { ok: true; defaultCalculator: DefaultCalculatorSelection }
  | { ok: false; error: string };

export async function setLabourTaskBudgetHours(
  projectId: string,
  taskId: string,
  budgetedHours: number | null,
): Promise<SetLabourTaskBudgetHoursResult> {
  await requireStaff();
  if (budgetedHours !== null && (!Number.isFinite(budgetedHours) || budgetedHours < 0)) {
    return { ok: false, error: "Task hours must be zero or greater." };
  }
  const supabase = await createClient();
  const { data: task, error: taskError } = await supabase.from("job_tasks").select("*").eq("id", taskId).eq("job_id", projectId).maybeSingle();
  if (taskError || !task) return { ok: false, error: taskError?.message ?? "Task not found." };
  const { error } = await supabase.rpc("save_job_task", {
    requested_job_id: projectId,
    requested_task_id: taskId,
    requested_title: task.title,
    requested_notes: task.notes,
    requested_budget_minutes: budgetedHours == null ? task.calculated_minutes : Math.round(budgetedHours * 60),
    requested_sort_order: task.sort_order,
  });
  if (error) return { ok: false, error: error.message };
  const resolved = await context(supabase, projectId);
  const selection = await defaultSelection(supabase, projectId, resolved?.quote);
  if (!selection) return { ok: false, error: "Updated labour budget could not be loaded." };
  revalidatePath(`/jobs/${projectId}`);
  revalidatePath(`/jobs/${projectId}/tasks`);
  return { ok: true, defaultCalculator: selection };
}
