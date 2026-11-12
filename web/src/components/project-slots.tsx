import { notFound } from "next/navigation";
import { getProjectData, getProjectTasks } from "@/lib/project-data";
import { ProjectOverviewPanel } from "@/components/project-detail";
import { ProjectTasksPanel } from "@/components/project-tasks";
import { ProjectDocumentsPanel } from "@/components/project-documents";
import { getProjectDocuments } from "@/lib/project-documents";
import { getTaskTemplates } from "@/lib/actions/task-templates";
import { requireMember } from "@/lib/auth";

export async function OverviewSlot({ projectId }: { projectId: string }) {
  const data = await getProjectData(projectId);
  if (!data) notFound();
  return (
    <ProjectOverviewPanel
      project={data.project}
      detail={data.detail}
      budgetUse={data.budgetUse}
    />
  );
}

export async function TasksSlot({ projectId }: { projectId: string }) {
  const data = await getProjectTasks(projectId);
  if (!data) notFound();
  const templates = data.canManage ? await getTaskTemplates() : [];
  return (
    <ProjectTasksPanel
      projectId={projectId}
      taskProgress={data.taskProgress}
      canManage={data.canManage}
      templates={templates}
    />
  );
}

export async function DocumentsSlot({ projectId }: { projectId: string }) {
  const [{ documents, folders }, profile] = await Promise.all([
    getProjectDocuments(projectId),
    requireMember(),
  ]);
  return (
    <ProjectDocumentsPanel
      projectId={projectId}
      documents={documents}
      folders={folders}
      canManage={["admin", "manager"].includes(profile.role)}
    />
  );
}
