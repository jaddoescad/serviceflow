import { notFound } from "next/navigation";
import { getProjectData } from "@/lib/project-data";
import { ProjectOverviewPanel } from "@/components/project-detail";
import { ProjectTasksPanel } from "@/components/project-tasks";

export async function OverviewSlot({ projectId }: { projectId: string }) {
  const data = await getProjectData(projectId);
  if (!data) notFound();
  return <ProjectOverviewPanel project={data.project} detail={data.detail} canManage={data.canManage} />;
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
