import { PhotoFeed } from "@/components/photo-feed";
import { getPhotoFeed } from "@/lib/photo-feed";

export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  const { batch, summary } = await getPhotoFeed();

  return <PhotoFeed initialBatch={batch} summary={summary!} />;
}
