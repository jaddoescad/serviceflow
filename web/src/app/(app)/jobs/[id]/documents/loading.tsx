import { JobPageSkeleton, TasksPanelSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <JobPageSkeleton>
      <TasksPanelSkeleton />
    </JobPageSkeleton>
  );
}
