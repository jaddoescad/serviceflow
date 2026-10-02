"use server";

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

export type LoadCalculatorResult =
  | {
      ok: true;
      doc: ProjectCalculator | null;
      companyRates: CalculatorRates;
    }
  | { ok: false; error: string };

// The calculator only reads a quote's id and saved calculator document.
const QUOTE_FIELDS = "id,calculator_doc";

/**
 * Resolves the job or lead and the quote whose calculator to open. The job
 * (with its accepted quote embedded) and the lead's quotes are looked up in one
 * wave; only a job without an accepted quote needs its lead's quotes after.
 */
async function context(supabase: Awaited<ReturnType<typeof createClient>>, entityId: string) {
  const latestQuotes = (leadId: string) =>
    Promise.all([
      supabase
        .from("quotes")
        .select(QUOTE_FIELDS)
        .eq("lead_id", leadId)
        .not("calculator_doc", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("quotes")
        .select(QUOTE_FIELDS)
        .eq("lead_id", leadId)
        .order("updated_at", { ascending: false })
        .limit(1),
    ]).then(([withDoc, latest]) => {
      if (withDoc.error) throw new Error(withDoc.error.message);
      if (latest.error) throw new Error(latest.error.message);
      return { withDoc: withDoc.data?.[0] ?? null, latest: latest.data?.[0] ?? null };
    });

  const [{ data: job, error: jobError }, { data: lead, error: leadError }, leadQuotes] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(`id,lead_id,accepted_quote_id,accepted_quote:quotes!jobs_accepted_quote_id_fkey(${QUOTE_FIELDS})`)
        .eq("id", entityId)
        .maybeSingle(),
      supabase.from("leads").select("id").eq("id", entityId).maybeSingle(),
      latestQuotes(entityId),
    ]);
  if (jobError) throw new Error(jobError.message);
  if (job) {
    if (job.accepted_quote_id) {
      const accepted = Array.isArray(job.accepted_quote) ? job.accepted_quote[0] : job.accepted_quote;
      return { kind: "job" as const, entityId, leadId: job.lead_id, quote: accepted ?? null };
    }
    if (!job.lead_id) return { kind: "job" as const, entityId, leadId: null, quote: null };
    const { latest } = await latestQuotes(job.lead_id);
    return { kind: "job" as const, entityId, leadId: job.lead_id, quote: latest };
  }
  if (leadError) throw new Error(leadError.message);
  if (!lead) return null;
  // A lead opens the most recent quote that has a calculator, else its latest quote.
  return { kind: "lead" as const, entityId, leadId: entityId, quote: leadQuotes.withDoc ?? leadQuotes.latest };
}

export async function loadCalculator(entityId: string): Promise<LoadCalculatorResult> {
  const supabase = await createClient();
  // Start the reads alongside the staff check, but await the check outside the
  // try so its not-authorized redirect is not turned into an error message.
  const reads = Promise.all([
    context(supabase, entityId),
    supabase.from("app_config").select("settings").eq("id", "default").maybeSingle(),
  ]);
  reads.catch(() => undefined);
  await requireStaff();
  try {
    const [resolved, settings] = await reads;
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
