"use client";

import { useState } from "react";
import { getCustomerPortalToken } from "@/lib/actions/portal";
import { Button } from "./ui";

/**
 * Copies the customer's private portal link (created on first use). Managers
 * only; the server refuses anyone else.
 */
export function PortalLinkButton({ contactId, className }: { contactId: string; className?: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "working" | "copied" | "manual">("idle");
  const [error, setError] = useState("");

  async function fetchLink(): Promise<string> {
    if (link) return link;
    const result = await getCustomerPortalToken(contactId);
    if (!result.ok || !result.token) throw new Error(result.error ?? "Could not get the portal link.");
    const next = `${window.location.origin}/portal/${result.token}`;
    setLink(next);
    return next;
  }

  async function copy() {
    setError("");
    setState("working");
    const pending = fetchLink();
    try {
      // Safari only allows the clipboard during the click, so hand it the pending link.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": pending.then((text) => new Blob([text], { type: "text/plain" })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await pending);
      }
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch (copyError) {
      try {
        await pending;
        setState("manual");
      } catch {
        setError((copyError as Error).message);
        setState("idle");
      }
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant="secondary" size="sm" className={className} disabled={state === "working"} onClick={() => void copy()}>
        {state === "copied" ? "Copied" : state === "working" ? "Copying…" : "Copy portal link"}
      </Button>
      {state === "manual" && link ? (
        <input
          aria-label="Portal link"
          readOnly
          value={link}
          onFocus={(event) => event.target.select()}
          className="h-7 w-64 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2 text-xs text-[var(--color-text)]"
        />
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-[var(--color-bad)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
