import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getProjectPresentation } from "@/lib/project-data";
import { getWorkspaceProject, getProjectLabels } from "@/lib/project-workspace";
import { requireMember } from "@/lib/auth";
import { ProjectProfilePanel } from "@/components/project-profile-panel";
import { PhotosSlot } from "@/components/project-photos-slot";
import { PhotosPanelSkeleton } from "@/components/skeletons";
import { WorkspaceProjectActions } from "@/components/workspace-project-actions";

export const dynamic = "force-dynamic";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
    <div
      data-project-workspace
      className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="min-w-0">
        <header className="mb-7 pt-2">
          <Link
            href="/projects"
            className="text-sm font-semibold text-slate-600 hover:text-blue-600"
          >
            ‹ Projects
          </Link>
          <h1 className="mt-7 text-3xl font-bold tracking-tight sm:text-4xl">
            {project.name}
          </h1>
          {project.address ? (
            <p className="mt-2 text-sm text-slate-500">{project.address}</p>
          ) : null}
          <div className="mt-4">
            <WorkspaceProjectActions
              project={project}
              contact={presentation.contact}
              description={presentation.description}
              labels={labels}
              canManage={["admin", "manager"].includes(profile.role)}
            />
          </div>
        </header>
        {project.trashed_at ? (
          <p className="border-t border-slate-200 py-12 text-sm text-slate-600">
            This project is in trash. Restore it to access its photos and
            details.
          </p>
        ) : (
          <>
            <div className="mb-6 border-b border-slate-200">
              <span className="inline-block border-b-2 border-slate-900 pb-3 text-sm font-semibold">
                Photos
              </span>
            </div>
            <Suspense fallback={<PhotosPanelSkeleton />}>
              <PhotosSlot projectId={id} showProfile={false} />
            </Suspense>
          </>
        )}
      </div>
      {!project.trashed_at ? (
        <ProjectProfilePanel
          projectId={id}
          contact={presentation.contact}
          description={presentation.description}
          canEdit={["admin", "manager"].includes(profile.role)}
        />
      ) : null}
    </div>
  );
}
