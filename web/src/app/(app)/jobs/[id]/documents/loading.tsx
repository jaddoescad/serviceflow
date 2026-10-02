import { RouteLoadingIndicator } from "@/components/route-loading";
import { JobPageSkeleton, TasksPanelSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <RouteLoadingIndicator label="Loading documents" />
      <JobPageSkeleton>
        <TasksPanelSkeleton />
      </JobPageSkeleton>
    </>
  );
}
