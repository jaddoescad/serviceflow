"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function createContact(input: { id: string; name: string; email: string; phone: string; address: string }): Promise<{ id?: string; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_customer_contact", {
    request_id: input.id, contact_name: input.name, contact_email: input.email,
    contact_phone: input.phone, contact_address: input.address,
  });
  if (error) return { error: error.message };
  revalidatePath("/contacts");
  return { id: data };
}
