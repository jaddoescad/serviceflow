import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getProjectMediaData, getProjectPresentation } from "@/lib/project-data";
import { getWorkspaceProject, getProjectLabels } from "@/lib/project-workspace";
import { requireMember } from "@/lib/auth";
import { ProjectProfilePanel } from "@/components/project-profile-panel";
import { PhotosSlot } from "@/components/project-photos-slot";
import { PhotosPanelSkeleton } from "@/components/skeletons";
import { WorkspaceProjectActions } from "@/components/workspace-project-actions";
import { ProjectTabs } from "@/components/project-tabs";
import { ProjectCrumb } from "@/components/job-shell";
import { PageHeader } from "@/components/kpi";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Start the photo gallery now so it loads alongside the header, not after it.
  void getProjectMediaData(id).catch(() => undefined);
  const [presentation, project, labels, profile] = await Promise.all([
    getProjectPresentation(id),
    getWorkspaceProject(id),
    getProjectLabels(),
    requireMember(),
  ]);
  if (presentation?.canonicalJobId)
    redirect(`/jobs/${presentation.canonicalJobId}`);
  if (!presentation || !project) notFound();
  if (
    project.trashed_at &&
    Date.parse(project.trashed_at) <= Date.now() - 90 * 86400000
  )
    notFound();
  return (
    <div>
      <PageHeader
        title={<ProjectCrumb name={project.name} />}
        subtitle={project.address}
        actions={
          <WorkspaceProjectActions
            project={project}
            contact={presentation.contact}
            description={presentation.description}
            labels={labels}
            canManage={["admin", "manager"].includes(profile.role)}
          />
        }
      />
      {project.trashed_at ? (
        <EmptyState>
          This project is in trash. Restore it to access its photos and details.
        </EmptyState>
      ) : (
        <>
          <ProjectTabs
            projectId={id}
            projectName={project.name}
            activeOverride="photos"
          />
          <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              <Suspense fallback={<PhotosPanelSkeleton />}>
                <PhotosSlot projectId={id} showProfile={false} />
              </Suspense>
            </div>
            <ProjectProfilePanel
              projectId={id}
              contact={presentation.contact}
              description={presentation.description}
              canEdit={["admin", "manager"].includes(profile.role)}
            />
          </div>
        </>
      )}
    </div>
  );
}
