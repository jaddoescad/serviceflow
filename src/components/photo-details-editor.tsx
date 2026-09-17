"use client";

import { useEffect, useRef, useState } from "react";
import { PhotoTagPicker } from "./photo-tag-picker";
import { savePhotoDetails } from "@/lib/actions/photo-details";

export function PhotoDetailsEditor({
  projectId,
  mediaId,
  description,
  tags,
  availableTags = [],
  revision,
  onDirtyChange,
  onSaved,
}: {
  onSaved?: () => void;
  projectId: string;
  mediaId: string;
  description: string | null;
  tags: string[];
  availableTags?: string[];
  revision: string | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState<"description" | "tags" | null>(null);
  const [draft, setDraft] = useState(description ?? "");
  const [draftTags, setDraftTags] = useState(tags);
  const [saved, setSaved] = useState({
    description: description ?? "",
    tags,
    revision,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const attempt = useRef<{ content: string; revision: string } | null>(null);
  const dirty =
    draft !== saved.description ||
    JSON.stringify(draftTags) !== JSON.stringify(saved.tags);
  useEffect(() => {
    onDirtyChange(dirty || busy);
  }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  async function save() {
    const nextTags = [
      ...new Set(draftTags.map((tag) => tag.trim()).filter(Boolean)),
    ];
    if (nextTags.length > 30 || nextTags.some((tag) => tag.length > 60)) {
      setMessage("Use up to 30 tags, with no more than 60 characters per tag.");
      return;
    }
    const content = JSON.stringify([draft, nextTags, saved.revision]);
    if (attempt.current?.content !== content)
      attempt.current = { content, revision: crypto.randomUUID() };
    setBusy(true);
    setMessage("");
    try {
      const result = await savePhotoDetails({
        projectId,
        mediaId,
        expectedRevision: saved.revision,
        revision: attempt.current.revision,
        description: draft,
        tags: nextTags,
      });
      if (!result.ok) {
        setMessage(result.error);
        setConflict(result.conflict);
        return;
      }
      setDraft(result.description);
      setDraftTags(result.tags);
      setSaved({
        description: result.description,
        tags: result.tags,
        revision: result.revision,
      });
      setMessage("");
      setEditing(null);
      setConflict(false);
      attempt.current = null;
      onSaved?.();
    } catch {
      setMessage("Could not confirm the save. Try again to check it safely.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(saved.description);
    setDraftTags(saved.tags);
    setMessage("");
    setEditing(null);
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="text-sm"
    >
      <div className="border-b border-slate-200 px-5 pb-5">
        {editing === "tags" ? (
          <div className="space-y-3">
            <PhotoTagPicker
              value={draftTags}
              options={availableTags}
              disabled={busy || conflict}
              onChange={setDraftTags}
            />
            {controls()}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {saved.tags.map((tag) => (
              <button
                type="button"
                key={tag}
                disabled={editing !== null}
                onClick={() => setEditing("tags")}
                className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
              >
                {tag}
              </button>
            ))}
            <button
              type="button"
              disabled={editing !== null}
              onClick={() => setEditing("tags")}
              className="text-xs font-semibold text-blue-600"
            >
              {saved.tags.length ? "Edit Tags" : "Add Tags"}
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between bg-slate-50 px-5 py-2 text-xs font-semibold">
        <span>Description</span>
        <button
          type="button"
          disabled={editing !== null}
          onClick={() => setEditing("description")}
          className="text-blue-600 disabled:opacity-40"
        >
          Edit
        </button>
      </div>
      <div className="min-h-32 p-5">
        {editing === "description" ? (
          <div className="space-y-3">
            <textarea
              autoFocus
              aria-label="Photo description"
              value={draft}
              maxLength={10000}
              disabled={busy || conflict}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              className="w-full resize-y rounded border border-slate-300 p-2"
            />
            {controls()}
          </div>
        ) : (
          <button
            type="button"
            disabled={editing !== null}
            onClick={() => setEditing("description")}
            className={`w-full whitespace-pre-wrap text-left text-sm ${saved.description ? "text-slate-700" : "text-slate-400"}`}
          >
            {saved.description || "Add a description…"}
          </button>
        )}
      </div>
      {message ? (
        <p role="status" className="px-5 pb-3 text-red-700">
          {message}
        </p>
      ) : null}
      {conflict ? (
        <p className="px-5 pb-3 text-slate-600">
          Your draft is still here. Copy it before reloading.
        </p>
      ) : null}
    </form>
  );
  function controls() {
    return (
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy || !dirty || conflict}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={cancel}
          className="text-xs text-slate-500"
        >
          Cancel
        </button>
      </div>
    );
  }
}
