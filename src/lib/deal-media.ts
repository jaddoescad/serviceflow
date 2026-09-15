import { createClient } from "@/lib/supabase/client";
import { getProjectMediaPreviews } from "@/lib/project-media-previews";
import type { MarketingLead } from "@/lib/types";
export async function getDealMedia(leads: MarketingLead[]) {
  const mediaByOwner = await getProjectMediaPreviews(createClient(), leads.map(lead => ({
    id: lead.job?.jobId ?? lead.leadId, kind: lead.job ? "job" : "lead",
  })));
  return leads.map(lead => ({ ...lead, ...(mediaByOwner.get(lead.job?.jobId ?? lead.leadId) ?? { media: [], mediaCount: 0 }) }));
}
