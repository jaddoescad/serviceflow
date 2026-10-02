import { RouteLoadingIndicator } from "@/components/route-loading";
import { JobPageSkeleton, PhotosPanelSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <RouteLoadingIndicator label="Loading job" />
      <JobPageSkeleton>
        <PhotosPanelSkeleton />
      </JobPageSkeleton>
    </>
  );
}
