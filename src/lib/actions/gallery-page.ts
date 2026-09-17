"use server";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  galleryArguments,
  type GalleryFilters,
  type GalleryCursor,
  type GalleryPage,
} from "@/lib/gallery-page";

export async function loadGalleryPage(
  projectId: string,
  filters: GalleryFilters,
  cursor: GalleryCursor | null = null,
): Promise<GalleryPage> {
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "project_gallery_filtered_page",
    galleryArguments(projectId, filters, cursor),
  );
  if (error) throw new Error("Could not load photos. Try again.");
  return data as GalleryPage;
}
