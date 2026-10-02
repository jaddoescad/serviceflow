import { cache } from "react";
import { requireStaff } from "@/lib/auth";
import { selectCanonicalJobId } from "@/lib/project-routing";
import { createClient } from "@/lib/supabase/server";

export type LeadProjectResolution = {
  leadId: string;
  jobId: string | null;
};

/**
 * Resolves a lead UUID to the job UUID used by Jobs & Budgets. This is only
 * called after a direct job lookup fails, so normal job pages keep their
 * existing single-row fast path.
 */
export const resolveLeadProject = cache(
  async (leadId: string): Promise<LeadProjectResolution | null> => {
    const supabase = await createClient();
    const [, { data: lead, error: leadError }, { data: quotes, error: quotesError }] =
      await Promise.all([
        requireStaff(),
        supabase.from("leads").select("id").eq("id", leadId).maybeSingle(),
        supabase
          .from("quotes")
          .select("id,status,accepted_at,updated_at,job:jobs(id,is_feed_visible)")
          .eq("lead_id", leadId)
          .order("accepted_at", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false }),
      ]);

    if (leadError) throw new Error(`lead project lookup: ${leadError.message}`);
    if (!lead) return null;

    if (quotesError) {
      throw new Error(`lead project jobs lookup: ${quotesError.message}`);
    }

    const candidates = (quotes ?? []).flatMap((quote: any) => {
      const relatedJobs = Array.isArray(quote.job)
        ? quote.job
        : quote.job
          ? [quote.job]
          : [];

      return relatedJobs.map((job: any) => ({
        jobId: String(job.id),
        acceptedAt: quote.accepted_at,
        updatedAt: quote.updated_at,
        isFeedVisible: job.is_feed_visible,
        quoteStatus: quote.status,
      }));
    });

    return {
      leadId: lead.id,
      jobId: selectCanonicalJobId(candidates),
    };
  },
);
