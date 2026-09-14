import Link from "next/link";
import { notFound } from "next/navigation";
import { JobShell } from "@/components/job-shell";
import { Kpi, PageHeader } from "@/components/kpi";
import { ProjectTabs, type LocalTabKey } from "@/components/project-tabs";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

async function getLeadDetail(leadId: string) {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: lead, error }, { data: quotes }] = await Promise.all([
    supabase
      .from("leads")
      .select("*,contact:contacts(name,email,phone)")
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("quotes")
      .select("*,job:jobs(id,name,status)")
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false }),
  ]);

  if (error) throw new Error(error.message);
  if (!lead) notFound();

  const contact = Array.isArray(lead.contact) ? lead.contact[0] : lead.contact;
  return {
    lead,
    quotes: quotes ?? [],
    contact,
    name: contact?.name || "Unnamed lead",
  };
}

function EmptyLeadTasks() {
  return (
    <Card>
      <CardHeader title="Tasks" subtitle="Tasks for this lead will appear here" />
      <EmptyState>No tasks yet.</EmptyState>
    </Card>
  );
}

export async function LeadDetailView({
  leadId,
  initialTab,
}: {
  leadId: string;
  initialTab: LocalTabKey;
}) {
  const { lead, quotes, contact, name } = await getLeadDetail(leadId);
  const latestQuote = quotes[0];
  const overview = (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Stage" value={lead.status.replaceAll("_", " ")} hint="DripJobs pipeline" />
        <Kpi
          label="Created"
          value={fmtDate(lead.created_at)}
          hint={lead.dripjobs_deal_id ? `Deal ${lead.dripjobs_deal_id}` : "Legacy estimate"}
        />
        <Kpi
          label="Latest quote"
          value={latestQuote ? fmtMoney(Number(latestQuote.amount_cents) / 100) : "—"}
          hint={latestQuote?.status ?? "No quote yet"}
        />
        <Kpi
          label="Jobs"
          value={String(quotes.filter((quote) => quote.job).length)}
          hint="Accepted quote conversions"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contact" subtitle="One identity shared by this lead and its jobs" />
          <div className="space-y-2 p-4 text-sm">
            <div>{contact?.email || "No email"}</div>
            <div>{contact?.phone || "No phone"}</div>
            <div>{lead.address || "No address"}</div>
            <div>{[lead.city, lead.province, lead.postal_code].filter(Boolean).join(", ")}</div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Quotes and jobs" subtitle="The lead stays intact when a quote becomes a job" />
          <div className="divide-y divide-[var(--color-border)]">
            {quotes.map((quote) => (
              <div key={quote.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <div className="font-medium">{quote.name}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {fmtMoney(Number(quote.amount_cents) / 100)}
                  </div>
                </div>
                {quote.job ? (
                  <Link href={`/jobs/${quote.job.id}`} className="text-[var(--color-brand-strong)] hover:underline">
                    {quote.job.name}
                  </Link>
                ) : (
                  <Badge tone="neutral">{quote.status}</Badge>
                )}
              </div>
            ))}
            {quotes.length === 0 ? (
              <div className="p-4 text-sm text-[var(--color-muted)]">
                No quotes yet. Open Accepted Quote / Calculator to start one.
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );

  return (
    <JobShell
      projectId={leadId}
      name={name}
      address={lead.address ?? null}
      status={lead.status}
      isLead
      activeTab={initialTab}
    >
      {initialTab === "tasks" ? <EmptyLeadTasks /> : overview}
    </JobShell>
  );
}
