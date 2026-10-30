"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { searchProjects } from "@/lib/actions/project-search";
import { duplicateProposal } from "@/lib/actions/proposals";
import { DialogFooter } from "./document-dialogs";
import { ProjectModal } from "./project-profile-panel";
import { Button, Input, cn } from "./ui";

type Project = { id: string; name: string; address: string | null };

/**
 * Copies a proposal (lines, packages, discount, deposit, message, terms and
 * attachments) into a new draft on this deal or another one, then opens it.
 */
export function DuplicateProposalDialog({
  proposalId,
  projectId,
  projectName,
  onClose,
}: {
  proposalId: string;
  /** The project page the proposal lives under. */
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<"same" | "other">("same");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Project[]>([]);
  const [picked, setPicked] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (target !== "other" || !query.trim()) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      searchProjects(query).then(
        (found) => active && setResults(found.filter((project) => project.id !== projectId)),
        () => active && setResults([]),
      );
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, target, projectId]);

  function duplicate() {
    const destination = target === "same" ? projectId : picked?.id;
    if (!destination) {
      setError("Choose the deal to copy it to.");
      return;
    }
    startTransition(async () => {
      setError("");
      const result = await duplicateProposal({ id: proposalId, projectId: target === "same" ? null : destination });
      if (!result.ok || !result.id) {
        setError(result.error ?? "Could not copy the proposal.");
        return;
      }
      router.push(`/jobs/${encodeURIComponent(destination)}/proposals/${result.id}`);
      router.refresh();
    });
  }

  const choice = (value: "same" | "other", label: React.ReactNode) => (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] px-1 py-1.5 text-[13px] text-[var(--color-text)]">
      <input
        type="radio"
        name="duplicate-target"
        checked={target === value}
        onChange={() => {
          setTarget(value);
          setError("");
        }}
      />
      {label}
    </label>
  );

  return (
    <ProjectModal title="Duplicate proposal" onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          duplicate();
        }}
      >
        <div className="space-y-2 p-5">
          {choice(
            "same",
            <span className="min-w-0 truncate">
              This deal <span className="text-[var(--color-muted)]">· {projectName}</span>
            </span>,
          )}
          {choice("other", "Another deal")}
          {target === "other" ? (
            <div className="space-y-1 pl-6">
              <Input
                autoFocus
                aria-label="Search deals"
                placeholder="Search by customer or project"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPicked(null);
                }}
              />
              {results.length ? (
                <ul className="max-h-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)]">
                  {results.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        aria-pressed={picked?.id === project.id}
                        onClick={() => setPicked(project)}
                        className={cn(
                          "flex w-full flex-col items-start px-3 py-2 text-left text-[13px] hover:bg-[var(--color-hover)]",
                          picked?.id === project.id && "bg-[var(--color-brand-soft)]",
                        )}
                      >
                        <span className="font-medium text-[var(--color-heading)]">{project.name}</span>
                        {project.address ? (
                          <span className="text-xs text-[var(--color-muted)]">{project.address}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() ? (
                <p className="px-1 text-xs text-[var(--color-muted)]">No matching deals.</p>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-[var(--color-bad)]">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="subtle" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || (target === "other" && !picked)}>
            {pending ? "Copying…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </form>
    </ProjectModal>
  );
}

/** A row action in proposal lists: opens the duplicate dialog. */
export function DuplicateProposalButton({
  proposalId,
  projectId,
  projectName,
  className,
}: {
  proposalId: string;
  projectId: string;
  projectName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" className={className} onClick={() => setOpen(true)}>
        Duplicate
      </Button>
      {/* Outside the table row, so clicks in the dialog don't open the row. */}
      {open
        ? createPortal(
            <DuplicateProposalDialog
              proposalId={proposalId}
              projectId={projectId}
              projectName={projectName}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}
