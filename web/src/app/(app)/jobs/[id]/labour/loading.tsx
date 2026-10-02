import { RouteLoadingIndicator } from "@/components/route-loading";
import { JobPageSkeleton, OverviewPanelSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <RouteLoadingIndicator label="Loading labour budget" />
      <JobPageSkeleton>
        <OverviewPanelSkeleton />
      </JobPageSkeleton>
    </>
  );
}
