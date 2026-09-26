import { RouteLoadingIndicator } from "@/components/route-loading";
import { JobsListSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <RouteLoadingIndicator label="Loading jobs" />
      <JobsListSkeleton />
    </>
  );
}
