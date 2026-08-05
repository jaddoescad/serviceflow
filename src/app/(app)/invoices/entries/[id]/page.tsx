import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function InvoiceLineRedirect({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoice_lines").select("invoice_id").eq("id", decodeURIComponent(id)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) notFound();
  redirect(`/invoices/${data.invoice_id}`);
}
