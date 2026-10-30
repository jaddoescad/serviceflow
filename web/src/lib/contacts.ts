import { cache } from "react";
import { requireMember } from "@/lib/auth";
import type { WorkspaceProject } from "@/lib/project-workspace";
import { createClient } from "@/lib/supabase/server";
import {
  CUSTOMER_PAGE_SIZE,
  customerListFilters,
  type CustomerListOptions,
  type CustomerListParams,
  type CustomerRow,
} from "@/lib/customer-list";

export type ContactDetail = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  address: string | null;
  createdAt: string;
  projects: WorkspaceProject[];
  projectCount: number;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** One page of the customers list for these params, in the home company. */
export async function getCustomerList(
  params: CustomerListParams,
  pageSize = CUSTOMER_PAGE_SIZE,
): Promise<{ rows: CustomerRow[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_customer_list", {
    search_text: params.search,
    filters: customerListFilters(params),
    sort_key: params.sort,
    sort_desc: params.desc,
    page_number: params.page,
    page_size: pageSize,
  });
  if (error) throw new Error(`customers: ${error.message}`);
  return data;
}

/** Lead sources, the team and open sales columns, for the list's filters,
 * bulk tools and import. */
export async function getCustomerListOptions(): Promise<CustomerListOptions> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_customer_list_options");
  if (error) throw new Error(`customer options: ${error.message}`);
  return data;
}

export const getContactDetail = cache(
  async (contactId: string, page = 1): Promise<ContactDetail | null> => {
    const supabase = await createClient();
    const projectPage = (pageNumber: number) =>
      supabase
        .from("project_directory")
        .select("*")
        .eq("contact_id", contactId)
        .is("trashed_at", null)
        .order("updated_at", { ascending: false })
        .order("id")
        .range((pageNumber - 1) * 40, pageNumber * 40 - 1);
    // One wave: membership, the customer, the project count and the requested page.
    const [, contactResult, countResult, requestedPage] = await Promise.all([
      requireMember(),
      supabase
        .from("contacts")
        .select("id,name,email,phone,metadata,created_at")
        .eq("id", contactId)
        .eq("kind", "customer")
        .maybeSingle(),
      supabase
        .from("project_directory")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", contactId)
        .is("trashed_at", null),
      projectPage(page),
    ]);
    if (contactResult.error) throw new Error("Could not load customer.");
    if (countResult.error) throw new Error("Could not load customer projects.");
    const contact = contactResult.data;
    if (!contact) return null;
    const projectCount = countResult.count ?? 0;
    const safePage = Math.min(page, Math.max(1, Math.ceil(projectCount / 40)));
    // Only a page past the end (e.g. after deletions) needs a second request.
    const projectResult =
      safePage === page ? requestedPage : await projectPage(safePage);
    if (projectResult.error)
      throw new Error("Could not load customer projects.");
    return {
      id: contact.id,
      name: text(contact.name) ?? "Unnamed customer",
      email: text(contact.email),
      phone: text(contact.phone),
      notes: text(contact.metadata?.customer_notes),
      address: text(contact.metadata?.address),
      createdAt: contact.created_at,
      projects: (projectResult.data ?? []) as WorkspaceProject[],
      projectCount,
    };
  },
);
