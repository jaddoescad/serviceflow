"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./ui";

/** A trigger with a panel under it that closes on an outside click or Escape. */
export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "start",
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    function outside(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) change.current(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") change.current(false);
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {trigger}
      {open ? (
        <div
          className={cn(
            "absolute top-full z-30 mt-1 rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** One choice in a popover menu: 13px row with hover fill. */
export function MenuItem({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] text-[var(--color-text)] outline-none hover:bg-[var(--color-hover)] focus-visible:bg-[var(--color-hover)]",
        active && "bg-[var(--color-selected)] font-medium text-[var(--color-heading)] hover:bg-[var(--color-selected)]",
        className,
      )}
    >
      {children}
    </button>
  );
}
