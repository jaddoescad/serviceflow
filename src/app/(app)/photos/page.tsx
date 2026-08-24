import { PhotoFeed } from "@/components/photo-feed";
import { getPhotoFeed } from "@/lib/photo-feed";

export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  const photos = await getPhotoFeed();

  return <PhotoFeed photos={photos} />;
}
