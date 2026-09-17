"use client";
import { useEffect, useRef, useState } from "react";
import { loadGalleryPage } from "@/lib/actions/gallery-page";
import {
  appendGalleryPage,
  DEFAULT_GALLERY_FILTERS,
  type GalleryFilters,
  type GalleryPage,
} from "@/lib/gallery-page";

export function useGalleryPages(
  projectId: string,
  initialPage: GalleryPage,
  filters: GalleryFilters,
) {
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const key = JSON.stringify(filters);
  const loadedKey = useRef(key);
  useEffect(() => {
    const request = ++generation.current;
    busy.current = false;
    if (key === JSON.stringify(DEFAULT_GALLERY_FILTERS) && retry === 0) {
      loadedKey.current = key;
      setPage(initialPage);
      setError(null);
      setLoading(false);
      return () => {
        if (generation.current === request) generation.current++;
      };
    }
    setLoading(true);
    setError(null);
    busy.current = true;
    loadGalleryPage(projectId, JSON.parse(key))
      .then((result) => {
        if (generation.current === request) {
          loadedKey.current = key;
          setPage(result);
        }
      })
      .catch(() => {
        if (generation.current === request)
          setError(
            "Could not update the gallery. The previous results are still shown.",
          );
      })
      .finally(() => {
        if (generation.current === request) {
          busy.current = false;
          setLoading(false);
        }
      });
    return () => {
      if (generation.current === request) generation.current++;
    };
  }, [projectId, initialPage, key, retry]);

  async function more() {
    if (
      busy.current ||
      loadedKey.current !== key ||
      !page.hasMore ||
      !page.cursor
    )
      return;
    busy.current = true;
    setLoading(true);
    setError(null);
    const request = generation.current;
    try {
      const result = await loadGalleryPage(projectId, filters, page.cursor);
      if (request === generation.current)
        setPage((current) => ({
          ...result,
          options: result.options ?? current.options,
          items: appendGalleryPage(current.items, result.items),
        }));
    } catch {
      if (request === generation.current)
        setError("Could not load more photos. Try again.");
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }
  return {
    page,
    loading,
    error,
    more,
    reload: () => setRetry((value) => value + 1),
  };
}
