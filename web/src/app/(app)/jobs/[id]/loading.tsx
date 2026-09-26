import { RouteLoadingIndicator } from "@/components/route-loading";
import { JobPageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <RouteLoadingIndicator label="Loading job" />
      <JobPageSkeleton />
    </>
  );
}
