"use client";

import { useEffect, useRef, useState } from "react";
import { savePhotoDetails } from "@/lib/actions/photo-details";

export function PhotoDetailsEditor({ projectId, mediaId, description, tags, revision, onDirtyChange }: {
  projectId: string; mediaId: string; description: string | null;
  tags: string[]; revision: string | null; onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(description ?? "");
  const [tagText, setTagText] = useState(tags.join(", "));
  const [saved, setSaved] = useState({ description: description ?? "", tags: tags.join(", "), revision });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const attempt = useRef<{ content: string; revision: string } | null>(null);
  const dirty = draft !== saved.description || tagText !== saved.tags;
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  async function save() {
    const nextTags = [...new Set(tagText.split(",").map((tag) => tag.trim()).filter(Boolean))];
    if (nextTags.length > 30 || nextTags.some((tag) => tag.length > 60)) {
      setMessage("Use up to 30 tags, with no more than 60 characters per tag."); return;
    }
    const content = JSON.stringify([draft, nextTags, saved.revision]);
    if (attempt.current?.content !== content) attempt.current = { content, revision: crypto.randomUUID() };
    setBusy(true); setMessage("");
    try {
      const result = await savePhotoDetails({ projectId, mediaId, expectedRevision: saved.revision,
        revision: attempt.current.revision, description: draft, tags: nextTags });
      if (!result.ok) { setMessage(result.error); setConflict(result.conflict); return; }
      setDraft(result.description); setTagText(result.tags.join(", "));
      setSaved({ description: result.description, tags: result.tags.join(", "), revision: result.revision });
      setMessage("Saved"); attempt.current = null;
    } catch { setMessage("Could not confirm the save. Try again to check it safely."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5 p-5 text-sm">
    <label className="block font-semibold">Description
      <textarea aria-label="Photo description" value={draft} maxLength={10000} disabled={busy || conflict}
        onChange={(event) => { setDraft(event.target.value); setMessage(""); }} rows={6}
        placeholder="Add details about this photo…"
        className="mt-2 block w-full resize-y rounded-lg border border-slate-300 bg-white p-3 font-normal text-slate-900 focus:ring-2 focus:ring-teal-600" />
    </label>
    <label className="block font-semibold">Tags
      <input aria-label="Photo tags" value={tagText} disabled={busy || conflict}
        onChange={(event) => { setTagText(event.target.value); setMessage(""); }} placeholder="Before, Kitchen, Touch-up"
        className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3 font-normal text-slate-900 focus:ring-2 focus:ring-teal-600" />
      <span className="mt-1 block text-xs font-normal text-slate-500">Separate tags with commas.</span>
    </label>
    <button disabled={busy || !dirty || conflict} type="submit"
      className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-40">
      {busy ? "Saving…" : "Save details"}
    </button>
    {message ? <p role="status" className={message === "Saved" ? "text-teal-700" : "text-red-700"}>{message}</p> : null}
    {conflict ? <p className="text-slate-600">Your draft is still here. Copy it before reloading if you want to keep it.</p> : null}
  </form>;
}
