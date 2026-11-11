"use client";

import { useEffect, useState } from "react";

const TOAST_EVENT = "serviceflow:toast";
const SHOW_MS = 4_000;

/** Shows a short confirmation at the bottom of the page, e.g. "Proposal sent to Jane". */
export function showToast(text: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: text }));
}

export function Toast() {
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);

  useEffect(() => {
    const onToast = (event: Event) => setToast({ text: String((event as CustomEvent).detail), at: Date.now() });
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[var(--radius)] bg-[var(--color-heading)] px-3 py-2 text-[13px] font-medium text-[var(--color-bg)] shadow-[var(--shadow-pop)] print:hidden"
    >
      {toast.text}
    </div>
  );
}
