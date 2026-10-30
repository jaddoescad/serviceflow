"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProjectDeal } from "@/lib/proposals";
import type { ProposalBody } from "@/lib/proposal-types";
import { publicWrite, staffWrite, type ActionResult } from "./rpc";

const PROPOSAL_PATHS = ["/proposals", "/jobs", "/pipeline"];

function bodyArgs(body: ProposalBody) {
  return {
    requested_name: body.name,
    requested_items: body.items,
    requested_tax_rate: body.taxRatePercent,
    requested_deposit_percent: body.depositPercent,
    requested_deposit_cents: body.depositCents,
    requested_intro: body.intro,
    requested_terms: body.terms,
    requested_packages: body.packages,
    requested_selected_package: body.selectedPackageId,
    requested_discount_percent: body.discountPercent,
    requested_discount_cents: body.discountCents,
  };
}

export async function saveProposal(input: {
  id: string;
  leadId: string;
  body: ProposalBody;
  templateId?: string | null;
}): Promise<ActionResult> {
  return staffWrite(
    "save_proposal",
    {
      requested_id: input.id,
      requested_lead: input.leadId,
      ...bodyArgs(input.body),
      requested_template: input.templateId ?? null,
      requested_valid_until: input.body.validUntil || null,
    },
    PROPOSAL_PATHS,
  );
}

/**
 * Copies a proposal into a new draft: on its own deal, or on the deal behind
 * `projectId` (a deal or the job it became). Returns the new proposal's id.
 */
export async function duplicateProposal(input: {
  id: string;
  projectId?: string | null;
}): Promise<ActionResult & { id?: string }> {
  await requireStaff();
  let leadId: string | null = null;
  if (input.projectId) {
    const deal = await getProjectDeal(input.projectId);
    if (!deal?.leadId) return { ok: false, error: "That project has no deal to add a proposal to." };
    leadId = deal.leadId;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_proposal", {
    requested_id: input.id,
    requested_lead: leadId,
  });
  if (error) return { ok: false, error: error.message };
  for (const path of PROPOSAL_PATHS) revalidatePath(path, "layout");
  return { ok: true, id: data as string };
}

/** The language the deal's customer reads proposals, change orders and invoices in. */
export async function setDealCustomerLanguage(leadId: string, language: "en" | "fr" | null): Promise<ActionResult> {
  return staffWrite(
    "set_deal_customer_language",
    { requested_lead: leadId, requested_language: language },
    PROPOSAL_PATHS,
  );
}

export async function deleteProposal(id: string): Promise<ActionResult> {
  return staffWrite("delete_proposal", { requested_id: id }, PROPOSAL_PATHS);
}

/** Whether the customer's link offers the company's insurance and other documents. */
export async function setProposalCompanyDocuments(id: string, include: boolean): Promise<ActionResult> {
  return staffWrite(
    "set_proposal_company_documents",
    { requested_id: id, requested_include: include },
    PROPOSAL_PATHS,
  );
}

export async function saveProposalTemplate(input: { id: string; body: ProposalBody }): Promise<ActionResult> {
  return staffWrite("save_proposal_template", { requested_id: input.id, ...bodyArgs(input.body) }, ["/proposals"]);
}

export async function deleteProposalTemplate(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("proposal_templates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals", "layout");
  return { ok: true };
}

export async function saveCatalogItem(input: {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
}): Promise<ActionResult> {
  return staffWrite(
    "save_catalog_item",
    {
      requested_id: input.id,
      requested_name: input.name,
      requested_description: input.description,
      requested_unit_price_cents: input.unitPriceCents,
    },
    ["/proposals"],
  );
}

export async function deleteCatalogItem(id: string): Promise<ActionResult> {
  return staffWrite("delete_catalog_item", { requested_id: id }, ["/proposals"]);
}

export async function acceptPublicProposal(input: {
  token: string;
  signer: string;
  selected: string[];
  /** The drawn signature as a PNG data URL. */
  signature: string;
  /** The package the customer chose, when the proposal offers packages. */
  package?: string | null;
}): Promise<ActionResult> {
  return publicWrite(
    "accept_public_proposal",
    {
      requested_token: input.token,
      requested_signer: input.signer,
      requested_selected: input.selected,
      requested_signature: input.signature,
      requested_package: input.package ?? null,
    },
    [`/p/${input.token}`],
  );
}

export async function declinePublicProposal(input: { token: string; reason: string }): Promise<ActionResult> {
  return publicWrite(
    "decline_public_proposal",
    { requested_token: input.token, requested_reason: input.reason },
    [`/p/${input.token}`],
  );
}
