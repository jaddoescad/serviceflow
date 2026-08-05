import { notFound } from "next/navigation";
import { CalculatorPage } from "@/components/calculator/calculator";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LeadCalculatorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const leadId = decodeURIComponent(id);
  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id,contact:contacts(name)")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead) notFound();
  const contact = Array.isArray(lead.contact) ? lead.contact[0] : lead.contact;
  return <CalculatorPage projectId={leadId} projectName={contact?.name ?? "Lead"} isLead />;
}
