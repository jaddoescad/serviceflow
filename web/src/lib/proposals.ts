import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { reviveLineItems, revivePackages, type CatalogItem } from "@/lib/line-items";
import {
  reviveProposalPage,
  type Proposal,
  type ProposalStatus,
  type ProposalSummary,
  type ProposalTemplate,
  type PublicDocument,
} from "@/lib/proposal-types";

type Row = Record<string, any>;

const PROPOSAL_FIELDS =
  "id,lead_id,name,status,source,amount_cents,line_items,tax_rate_percent,deposit_percent,deposit_cents,discount_percent,discount_cents,packages,selected_package_id,intro,terms,public_token,sent_at,viewed_at,signed_name,signed_at,declined_at,decline_reason,updated_at,include_company_documents";

const TEMPLATE_FIELDS =
  "id,name,line_items,tax_rate_percent,deposit_percent,deposit_cents,discount_percent,discount_cents,packages,selected_package_id,intro,terms,updated_at";

const num = (value: unknown) => (value == null ? null : Number(value));

/** The pricing parts of a proposal or template row. */
function pricing(row: Row) {
  return {
    items: reviveLineItems(row.line_items),
    taxRatePercent: Number(row.tax_rate_percent ?? 0),
    depositPercent: num(row.deposit_percent),
    depositCents: num(row.deposit_cents),
    discountPercent: num(row.discount_percent),
    discountCents: num(row.discount_cents),
    packages: revivePackages(row.packages),
    selectedPackageId: (row.selected_package_id as string | null) ?? null,
  };
}

function toProposal(row: Row): Proposal {
  return {
    id: row.id,
    leadId: row.lead_id,
    name: row.name ?? "",
    status: row.status,
    source: row.source,
    amountCents: Number(row.amount_cents ?? 0),
    ...pricing(row),
    intro: row.intro ?? "",
    terms: row.terms ?? "",
    publicToken: row.public_token,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    signedName: row.signed_name,
    signedAt: row.signed_at,
    declinedAt: row.declined_at,
    declineReason: row.decline_reason,
    updatedAt: row.updated_at,
    includeCompanyDocuments: row.include_company_documents !== false,
  };
}

function toTemplate(row: Row): ProposalTemplate {
  return {
    id: row.id,
    name: row.name,
    ...pricing(row),
    intro: row.intro ?? "",
    terms: row.terms ?? "",
    updatedAt: row.updated_at,
  };
}

/** The deal behind a project page: a lead id, or the job's originating lead. */
export const getProjectDeal = cache(async (projectId: string) => {
  const supabase = await createClient();
  const [{ data: job }, { data: lead }] = await Promise.all([
    supabase.from("jobs").select("id,lead_id").eq("id", projectId).maybeSingle(),
    supabase.from("leads").select("id").eq("id", projectId).maybeSingle(),
  ]);
  if (job) return { leadId: (job.lead_id as string | null) ?? null, jobId: job.id as string };
  if (lead) return { leadId: lead.id as string, jobId: null };
  return null;
});

export async function getLeadProposals(leadId: string): Promise<Proposal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(PROPOSAL_FIELDS)
    .eq("lead_id", leadId)
    // Calculator quotes are the calculator's working records, not proposals.
    .not("source", "in", "(app,calculator)")
    .neq("status", "superseded")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`proposals: ${error.message}`);
  return (data ?? []).map(toProposal);
}

/** The company's most recently changed proposal: what Settings previews the customer page with. */
export async function getLatestProposalId(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quotes")
    .select("id")
    .eq("org_id", orgId)
    .eq("source", "proposal")
    .neq("status", "superseded")
    .order("updated_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

export const getProposal = cache(async (id: string): Promise<Proposal | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("quotes").select(PROPOSAL_FIELDS).eq("id", id).maybeSingle();
  if (error) throw new Error(`proposal: ${error.message}`);
  return data ? toProposal(data) : null;
});

export async function listProposals(status: ProposalStatus | null): Promise<ProposalSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("quotes")
    .select(
      "id,lead_id,name,status,source,amount_cents,sent_at,viewed_at,updated_at,lead:leads(contact:contacts(name)),job:jobs!jobs_accepted_quote_id_fkey(id)",
    )
    .neq("status", "superseded")
    // Calculator quotes are the calculator's working records, not proposals.
    .not("source", "in", "(app,calculator)")
    .order("updated_at", { ascending: false })
    .limit(300);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`proposals list: ${error.message}`);
  return (data ?? []).map((row: Row) => {
    const job = Array.isArray(row.job) ? row.job[0] : row.job;
    return {
      id: row.id,
      leadId: row.lead_id,
      name: row.name ?? "",
      status: row.status,
      source: row.source,
      amountCents: Number(row.amount_cents ?? 0),
      sentAt: row.sent_at,
      viewedAt: row.viewed_at,
      updatedAt: row.updated_at,
      customerName: row.lead?.contact?.name ?? "Unnamed customer",
      projectId: job?.id ?? row.lead_id,
    };
  });
}

export const getProposalTemplates = cache(async (): Promise<ProposalTemplate[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_templates")
    .select(TEMPLATE_FIELDS)
    .order("name");
  if (error) throw new Error(`proposal templates: ${error.message}`);
  return (data ?? []).map(toTemplate);
});

/** The signed-in company's products and services, by name. */
export const getCatalogItems = cache(async (): Promise<CatalogItem[]> => {
  const supabase = await createClient();
  const { data: company, error: companyError } = await supabase.rpc("get_home_company");
  if (companyError) throw new Error(`catalog company: ${companyError.message}`);
  if (!company) return [];
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id,name,description,unit_price_cents")
    .eq("org_id", (company as Row).id)
    .order("name");
  if (error) throw new Error(`catalog: ${error.message}`);
  return (data ?? []).map((row: Row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    unitPriceCents: Number(row.unit_price_cents ?? 0),
  }));
});

/** Cached per request: the page and its title share one lookup. */
export const getPublicDocument = cache(async (
  kind: PublicDocument["kind"],
  token: string,
): Promise<PublicDocument | null> => {
  const supabase = await createClient();
  const fn = {
    proposal: "view_public_proposal",
    change_order: "view_public_change_order",
    invoice: "view_public_invoice",
  }[kind];
  const { data, error } = await supabase.rpc(fn, { requested_token: token });
  if (error) throw new Error(`public ${kind}: ${error.message}`);
  return data ? publicDocument(data as Row) : null;
});

/**
 * Staff's "Customer view" of any proposal, drafts included: the customer's
 * page without a link, and without marking it viewed.
 */
export async function getProposalPreview(id: string): Promise<PublicDocument | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_proposal", { requested_id: id });
  if (error) throw new Error(`proposal preview: ${error.message}`);
  return data ? publicDocument(data as Row) : null;
}

function publicDocument(doc: Row): PublicDocument {
  return {
    ...(doc as PublicDocument),
    company: { ...(doc.company as PublicDocument["company"]), page: reviveProposalPage(doc.company?.page) },
    items: reviveLineItems(doc.items),
    packages: revivePackages(doc.packages),
    discount: doc.discount
      ? { percent: num(doc.discount.percent), cents: num(doc.discount.cents) }
      : undefined,
    discountCents: Number(doc.discountCents ?? 0),
    portalToken: typeof doc.portalToken === "string" ? doc.portalToken : null,
    depositPaid: doc.depositPaid === true,
    payments: ((doc.payments ?? []) as Row[]).map((payment) => ({
      id: payment.id,
      amountCents: Number(payment.amountCents ?? 0),
      paidOn: payment.paidOn,
      method: payment.method,
      reference: payment.reference ?? null,
    })),
    assets: doc.assets ?? [],
    companyDocuments: doc.companyDocuments ?? [],
  };
}
