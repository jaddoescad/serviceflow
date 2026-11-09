import { notFound } from "next/navigation";
import { DealProjectPanel } from "@/components/deal-project-panels";
import { DealRecord } from "@/components/deal-record";
import { requireStaff } from "@/lib/auth";
import { getDealRecord, markLeadOpened } from "@/lib/pipeline";
import { isDealProjectTab, isDealTab } from "@/lib/pipeline-types";
import { getProjectPresentation } from "@/lib/project-data";
import { getProjectLabels, getWorkspaceProject } from "@/lib/project-workspace";
import { WorkspaceProjectActions } from "@/components/workspace-project-actions";

export const dynamic = "force-dynamic";

/** The one page for a deal or job: its details, activity and every project tab. */
export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [profile, record, labels] = await Promise.all([requireStaff(), getDealRecord(decodeURIComponent(id)), getProjectLabels()]);
  if (!record) notFound();
  await markLeadOpened(record.deal.id);
  // Old links opened an "Attachments" tab; it is Documents now.
  const requested = query.tab === "attachments" ? "documents" : query.tab;
  const tab = isDealTab(requested) ? requested : "communications";
  // Photos, documents and the rest belong to the job once there is one.
  const projectId = record.extras.job?.id ?? record.deal.id;
  const [project, presentation] = await Promise.all([getWorkspaceProject(projectId), getProjectPresentation(projectId)]);
  return (
    <DealRecord
      key={record.deal.id}
      {...record}
      allLabels={labels}
      initialTab={tab}
      projectId={projectId}
      actions={
        project && presentation ? (
          <WorkspaceProjectActions
            project={project}
            contact={presentation.contact}
            description={presentation.description}
            labels={labels}
            canManage={["admin", "manager"].includes(profile.role)}
            showLabels={false}
          />
        ) : null
      }
      panelTab={tab}
      panel={
        isDealProjectTab(tab) ? (
          <DealProjectPanel tab={tab} projectId={projectId} hasJob={record.extras.job != null} />
        ) : null
      }
    />
  );
}
