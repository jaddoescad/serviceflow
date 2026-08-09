import { CalculatorPage } from "@/components/calculator/calculator";
import { getProjectById } from "@/lib/queries";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function JobCalculatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { id } = await params;
  const { name } = await searchParams;
  const jobId = decodeURIComponent(id);
  const job = await getProjectById(jobId);
  if (job) {
    return (
      <CalculatorPage
        projectId={jobId}
        projectName={job.name || name || null}
        isLead={false}
      />
    );
  }

  await requireStaff();
  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id,contact:contacts(name)")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead) notFound();
  const contact = Array.isArray(lead.contact) ? lead.contact[0] : lead.contact;
  return (
    <CalculatorPage
      projectId={jobId}
      projectName={contact?.name || name || "Lead"}
      isLead
    />
  );
}
