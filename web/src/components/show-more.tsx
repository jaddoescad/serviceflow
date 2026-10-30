"use client";

import { useEffect, useRef } from "react";
import { cn } from "./ui";

/** The rest of a long list, drawn as it scrolls near (or on a click), so a
 * board with hundreds of cards only draws the ones in reach. */
export function ShowMore({ count, onMore, className }: { count: number; onMore: () => void; className?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const more = useRef(onMore);
  more.current = onMore;

  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) more.current();
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);

  return (
    <button
      ref={button}
      type="button"
      onClick={() => more.current()}
      className={cn(
        "h-8 w-full shrink-0 rounded-[var(--radius-control)] px-1.5 text-xs font-medium text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]",
        className,
      )}
    >
      Show {count.toLocaleString("en-CA")} more
    </button>
  );
}
