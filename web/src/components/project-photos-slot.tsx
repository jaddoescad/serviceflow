import { notFound } from "next/navigation";
import { getProjectMediaData } from "@/lib/project-data";
import { ProjectPhotosPanel } from "@/components/project-photos";

export async function PhotosSlot({
  projectId,
  showProfile = true,
}: {
  projectId: string;
  showProfile?: boolean;
}) {
  const data = await getProjectMediaData(projectId);
  if (!data) notFound();
  return (
    <ProjectPhotosPanel
      projectId={projectId}
      showProfile={showProfile}
      projectName={data.name}
      contact={data.contact}
      description={data.description}
      galleryPage={data.galleryPage}
      isLead={data.isLead}
    />
  );
}
