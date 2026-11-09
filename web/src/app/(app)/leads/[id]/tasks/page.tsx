import { permanentRedirect } from "next/navigation";
import { dealHref } from "@/lib/pipeline-types";

export default async function LegacyLeadTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(dealHref(decodeURIComponent(id), "tasks"));
}
