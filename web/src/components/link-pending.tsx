"use client";

import { useLinkStatus } from "next/link";
import { Spinner } from "./ui";

/** A spinner inside a Link while the page it opens is loading. */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} /> : null;
}
