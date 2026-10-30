import { JobPageSkeleton, OverviewPanelSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <JobPageSkeleton>
      <OverviewPanelSkeleton />
    </JobPageSkeleton>
  );
}
