import type { ProjectMediaItem } from "./project-data";

export type GalleryFilters = {
  type: "all" | "image" | "video";
  order: "newest" | "oldest";
  creator: string; tag: string; from: string; to: string;
};
export type GalleryCursor = { at: string; id: string };
export type GalleryPage = {
  items: ProjectMediaItem[]; total: number; hasMore: boolean;
  cursor: GalleryCursor | null;
  options: { creators: string[]; tags: string[] } | null;
};
export const DEFAULT_GALLERY_FILTERS: GalleryFilters = {
  type:"all",order:"newest",creator:"",tag:"",from:"",to:"",
};

export function galleryArguments(projectId:string,filters:GalleryFilters,cursor:GalleryCursor|null=null) {
  return {requested_project_id:projectId,requested_type:filters.type,requested_order:filters.order,
    requested_creator:filters.creator||null,requested_tag:filters.tag||null,
    requested_from:filters.from||null,requested_to:filters.to||null,
    cursor_at:cursor?.at??null,cursor_id:cursor?.id??null,requested_limit:48};
}

/** Live updates may move a record across a page boundary. Keep original IDs. */
export function appendGalleryPage(current:ProjectMediaItem[],next:ProjectMediaItem[]) {
  const rows=new Map(current.map(item=>[item.id,item]));
  for(const item of next)rows.set(item.id,item);
  return [...rows.values()];
}
