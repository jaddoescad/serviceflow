import { PhotoFeed } from "@/components/photo-feed";
import { getPhotoFeed } from "@/lib/photo-feed";

export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  const fetchStarted = performance.now();
  const { batch, summary } = await getPhotoFeed();

  return <><span hidden data-perf-fetch-ms={Math.round(performance.now() - fetchStarted)} /><PhotoFeed initialBatch={batch} summary={summary!} /></>;
}
