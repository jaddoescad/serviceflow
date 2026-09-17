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

async function context(supabase: Awaited<ReturnType<typeof createClient>>, entityId: string) {
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,lead_id,accepted_quote_id")
    .eq("id", entityId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (job) {
    if (!job.accepted_quote_id && !job.lead_id) {
      return { kind: "job" as const, entityId, leadId: null, quote: null };
    }
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
