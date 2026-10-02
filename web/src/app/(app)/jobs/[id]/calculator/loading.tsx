import { RouteLoadingIndicator } from "@/components/route-loading";
import { JobPageSkeleton, CalculatorSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <RouteLoadingIndicator label="Loading calculator" />
      <JobPageSkeleton>
        <CalculatorSkeleton />
      </JobPageSkeleton>
    </>
  );
}
