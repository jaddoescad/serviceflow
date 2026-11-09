import { redirect } from "next/navigation";
import { dealHref } from "@/lib/pipeline-types";

/** Jobs open on the deal page; this old address forwards there. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(dealHref(decodeURIComponent(id), "documents"));
}
