"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
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
