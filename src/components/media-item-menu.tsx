"use client";

import { useId, useRef, useState } from "react";
import { setProjectCover } from "@/lib/actions/project-cover";
import { FeedPhotoActions } from "./feed-photo-actions";

export function MediaItemMenu({
  mediaId,
  mediaType,
  projectId,
  label,
  disabled,
  onBusy,
  onSaved,
}: {
  mediaId: string;
  mediaType: "image" | "video";
  projectId: string;
  label: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: () => void;
}) {
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverMessage, setCoverMessage] = useState("");
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [action, setAction] = useState<
    "add-tags" | "trash" | "duplicate" | null
  >(null);
  function choose(value: "add-tags" | "trash" | "duplicate") {
    menu.current?.hidePopover();
    onBusy(true);
    setAction(value);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-label={label}
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(
              8,
              Math.min(bounds.right - 192, window.innerWidth - 200),
            ),
            top:
              bounds.bottom + 220 < window.innerHeight
                ? bounds.bottom + 4
                : Math.max(8, bounds.top - 220),
          });
        }}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
      >
        ···
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        style={position}
        className="fixed m-0 w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-800 shadow-lg"
      >
        <a
          href={`/api/jobs/${projectId}/media/${mediaId}?download=1`}
          download
          onClick={() => menu.current?.hidePopover()}
          className="block rounded px-4 py-2 hover:bg-slate-100"
        >
          Download
        </a>
        {mediaType === "image" ? (
          <button
            type="button"
            disabled={coverBusy}
            onClick={() => choose("duplicate")}
            className="block w-full rounded px-4 py-2 text-left hover:bg-slate-100"
          >
            Duplicate
          </button>
        ) : null}
        {mediaType === "image" ? (
          <button
            type="button"
            disabled={coverBusy}
            onClick={async () => {
              setCoverBusy(true);
              onBusy(true);
              setCoverMessage("");
              try {
                const result = await setProjectCover(projectId, mediaId);
                setCoverMessage(result.error || "Cover photo updated.");
                if (!result.error) onSaved();
              } catch {
                setCoverMessage("Could not set the cover. Try again.");
              } finally {
                setCoverBusy(false);
                onBusy(false);
              }
            }}
            className="block w-full rounded px-4 py-2 text-left hover:bg-slate-100 disabled:opacity-50"
          >
            {coverBusy ? "Updating cover…" : "Set as Cover Photo"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={coverBusy}
          onClick={() => choose("add-tags")}
          className="block w-full rounded px-4 py-2 text-left hover:bg-slate-100"
        >
          Tag
        </button>
        <button
          type="button"
          disabled={coverBusy}
          onClick={() => choose("trash")}
          className="block w-full rounded px-4 py-2 text-left text-red-700 hover:bg-red-50"
        >
          Move to Trash
        </button>
        {coverMessage ? (
          <p
            role="status"
            className="border-t border-slate-100 px-4 py-2 text-xs"
          >
            {coverMessage}
          </p>
        ) : null}
      </div>
      {action ? (
        <FeedPhotoActions
          ids={[mediaId]}
          initialAction={action}
          onBusy={onBusy}
          onSaved={onSaved}
          onClear={() => {
            setAction(null);
            onBusy(false);
            trigger.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
