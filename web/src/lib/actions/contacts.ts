"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { getCustomerList } from "@/lib/contacts";
import { toCsv } from "@/lib/csv";
import { parseCustomerListParams, type CustomerRow } from "@/lib/customer-list";
import { dayKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export async function createContact(input: {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}): Promise<{ id?: string; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_customer_contact", {
    request_id: input.id,
    contact_name: input.name,
    contact_email: input.email,
    contact_phone: input.phone,
    contact_address: input.address,
  });
  if (error) return { error: error.message };
  revalidatePath("/contacts");
  return { id: data };
}

export async function updateCustomer(input: {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}): Promise<{ id?: string; error?: string }> {
  await requireStaff();
  if (
    !input.name.trim() ||
    input.name.trim().length > 160 ||
    input.email.length > 320 ||
    input.phone.length > 60 ||
    input.address.length > 500
  )
    return { error: "Enter a customer name and check the field lengths." };
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("contacts")
    .select("updated_at")
    .eq("id", input.id)
    .eq("kind", "customer")
    .maybeSingle();
  if (readError || !current)
    return { error: "Customer could not be loaded. Try again." };
  const { data, error } = await supabase.rpc("update_customer_contact", {
    contact_id: input.id,
    expected_updated_at: current.updated_at,
    contact_name: input.name,
    contact_email: input.email,
    contact_phone: input.phone,
    contact_address: input.address,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { id: data };
}

const EXPORT_PAGE = 2000;
const EXPORT_LIMIT = 50_000;

/** Every customer matching the list's current URL query, as CSV text. */
export async function exportCustomersCsv(query: string): Promise<{ csv?: string; error?: string }> {
  await requireStaff();
  const params = parseCustomerListParams(Object.fromEntries(new URLSearchParams(query)));
  const rows: CustomerRow[] = [];
  try {
    for (let page = 1; rows.length < EXPORT_LIMIT; page++) {
      const result = await getCustomerList({ ...params, page }, EXPORT_PAGE);
      rows.push(...result.rows);
      if (!result.rows.length || rows.length >= result.total) break;
    }
  } catch {
    return { error: "Could not export customers. Try again." };
  }
  return {
    csv: toCsv(
      ["Name", "Email", "Phone", "Address", "Lead source", "Salesperson", "Deals", "Open deals", "Jobs", "Created", "Last activity"],
      rows.map((row) => [
        row.name,
        row.email,
        row.phone,
        row.address,
        row.source,
        row.salespersonName,
        row.leadCount,
        row.openDealCount,
        row.jobCount,
        dayKey(row.createdAt),
        dayKey(row.lastActivityAt),
      ]),
    ),
  };
}

export type CustomerMatch = { id: string; name: string; email: string | null; phoneKey: string | null };

/** Existing customers whose email (lower-cased) or phone (last ten digits)
 * is among these; for an import's duplicate check. */
export async function findCustomerMatches(input: { emails: string[]; phones: string[] }): Promise<{ matches?: CustomerMatch[]; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_customer_matches", {
    requested_emails: input.emails.slice(0, 10_000),
    requested_phones: input.phones.slice(0, 10_000),
  });
  if (error) return { error: error.message };
  return { matches: data as CustomerMatch[] };
}

export type ImportRow = { id: string; name: string; email: string; phone: string; address: string; source: string };
export type ImportResult = { created: number; duplicates: number; invalid: number; deals: number };

/** Imports up to 500 rows into the home company; rows carry their own ids so
 * a retried chunk is not imported twice. */
export async function importCustomers(input: {
  batchId: string;
  rows: ImportRow[];
  stageId: string | null;
  sendDrips: boolean;
}): Promise<{ result?: ImportResult; error?: string }> {
  await requireStaff();
  if (input.rows.length > 500) return { error: "Import up to 500 rows at a time." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_customers", {
    requested_batch: input.batchId,
    requested_rows: input.rows,
    requested_stage: input.stageId,
    send_drips: input.sendDrips,
  });
  if (error) return { error: error.message };
  revalidatePath("/contacts");
  if (input.stageId) revalidatePath("/pipeline", "layout");
  return { result: data as ImportResult };
}
