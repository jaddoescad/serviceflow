import { JobPageSkeleton, PhotosPanelSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <JobPageSkeleton>
      <PhotosPanelSkeleton />
    </JobPageSkeleton>
  );
}
