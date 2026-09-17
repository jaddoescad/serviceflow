import { cache } from "react";
import { requireMember } from "@/lib/auth";
import type { WorkspaceProject } from "@/lib/project-workspace";
import { createClient } from "@/lib/supabase/server";

export type ContactSummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  jobCount: number;
  leadCount: number;
  projectCount: number;
  lastActivityAt: string;
};

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

export async function getCustomerContactsPage(
  search: string,
  page: number,
): Promise<{ rows: ContactSummary[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_contacts_page", {
    search_text: search,
    page_number: page,
  });
  if (error) throw new Error(`contacts: ${error.message}`);
  return data;
}

export const getContactDetail = cache(
  async (contactId: string, page = 1): Promise<ContactDetail | null> => {
    await requireMember();
    const supabase = await createClient();
    const [contactResult, countResult] = await Promise.all([
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
    ]);
    if (contactResult.error) throw new Error("Could not load customer.");
    if (countResult.error) throw new Error("Could not load customer projects.");
    const contact = contactResult.data;
    if (!contact) return null;
    const projectCount = countResult.count ?? 0;
    const safePage = Math.min(page, Math.max(1, Math.ceil(projectCount / 40)));
    const projectResult = await supabase
      .from("project_directory")
      .select("*")
      .eq("contact_id", contactId)
      .is("trashed_at", null)
      .order("updated_at", { ascending: false })
      .order("id")
      .range((safePage - 1) * 40, safePage * 40 - 1);
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
