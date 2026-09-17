"use client";

import { useState } from "react";

/** Galleries request thumbnails only; originals load when a user opens an item. */
export function ProjectMediaPreview({
  src,
  alt,
  video = false,
}: {
  src: string;
  alt: string;
  video?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src)
    return (
      <span
        role="img"
        aria-label={alt}
        className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-slate-500"
      >
        {video ? "▶ Open video" : "Preview unavailable"}
      </span>
    );
  return (
    <img
      src={`${src}?preview=1`}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
