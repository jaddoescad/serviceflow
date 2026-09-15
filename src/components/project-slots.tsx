import { notFound } from "next/navigation";
import { getProjectData, getProjectMediaData } from "@/lib/project-data";
import { ProjectOverviewPanel } from "@/components/project-detail";
import { ProjectPhotosPanel } from "@/components/project-photos";
import { ProjectTasksPanel } from "@/components/project-tasks";

export async function PhotosSlot({ projectId }: { projectId: string }) {
  const data = await getProjectMediaData(projectId);
  if (!data) notFound();
  return (
    <ProjectPhotosPanel
      projectId={projectId}
      contact={data.contact}
      description={data.description}
      notes={data.notes}
      galleryPage={data.galleryPage}
      isLead={data.isLead}
    />
  );
}

export async function OverviewSlot({ projectId }: { projectId: string }) {
  const data = await getProjectData(projectId);
  if (!data) notFound();
  return (
    <ProjectOverviewPanel
      project={data.project}
      detail={data.detail}
      canManage={data.canManage}
    />
  );
}

export async function TasksSlot({ projectId }: { projectId: string }) {
  const data = await getProjectData(projectId);
  if (!data) notFound();
  return (
    <ProjectTasksPanel
      projectId={projectId}
      projectName={data.project.name}
      taskProgress={data.taskProgress}
      canManage={data.canManage}
    />
  );
}
