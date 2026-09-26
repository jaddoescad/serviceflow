import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { uploadProjectMedia } from "./projectMedia";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 3000];

function queueReducer(state, action) {
  switch (action.type) {
    case "enqueue":
      return [...state, action.item];
    case "start":
      return state.map((item) =>
        item.localId === action.localId
          ? {
              ...item,
              status: "uploading",
              attempts: item.attempts + 1,
              retryAt: null,
              error: null,
            }
          : item,
      );
    case "success":
      return state.map((item) =>
        item.localId === action.localId
          ? {
              ...item,
              status: "uploaded",
              remote: action.remote,
              retryAt: null,
              error: null,
            }
          : item,
      );
    case "fail":
      // action.retryAt set => schedule an automatic retry; absent => terminal failure
      return state.map((item) =>
        item.localId === action.localId
          ? action.retryAt
            ? { ...item, status: "queued", retryAt: action.retryAt, error: action.error }
            : { ...item, status: "failed", retryAt: null, error: action.error }
          : item,
      );
    case "retry":
      return state.map((item) =>
        item.localId === action.localId
          ? { ...item, status: "queued", attempts: 0, retryAt: null, error: null }
          : item,
      );
    case "retry_all":
      return state.map((item) =>
        item.status === "failed"
          ? { ...item, status: "queued", attempts: 0, retryAt: null, error: null }
          : item,
      );
    case "discard":
      return state.filter((item) => item.localId !== action.localId);
    case "clear_completed":
      return state.filter((item) => item.status !== "uploaded");
    default:
      return state;
  }
}

function makeLocalId() {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useProjectMediaUploadQueue({
  projectId,
  projectKind = "job",
  onUploaded,
}) {
  const [items, dispatch] = useReducer(queueReducer, []);
  const [tick, bumpTick] = useReducer((n) => n + 1, 0);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const wakeTimerRef = useRef(null);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (processingRef.current) return;
    const now = Date.now();
    const next = items.find(
      (item) => item.status === "queued" && (!item.retryAt || item.retryAt <= now),
    );

    if (!next) {
      // No item ready yet — wake up when the earliest scheduled retry comes due.
      const waiting = items.filter(
        (item) => item.status === "queued" && item.retryAt && item.retryAt > now,
      );
      if (waiting.length > 0) {
        const wakeAt = Math.min(...waiting.map((item) => item.retryAt));
        if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
        wakeTimerRef.current = setTimeout(() => {
          wakeTimerRef.current = null;
          if (mountedRef.current) bumpTick();
        }, Math.max(wakeAt - now, 0));
      }
      return;
    }

    processingRef.current = true;
    dispatch({ type: "start", localId: next.localId });

    uploadProjectMedia(next.projectId, next.asset, {
      projectKind: next.projectKind,
    })
      .then((remote) => {
        if (!mountedRef.current) return;
        dispatch({ type: "success", localId: next.localId, remote });
        try {
          onUploadedRef.current?.(remote, next);
        } catch (_error) {
          // The upload already succeeded. A presentation callback must never
          // turn that into a duplicate retry.
        }
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        const attemptCount = next.attempts + 1;
        const retryAt =
          attemptCount < MAX_ATTEMPTS
            ? Date.now() + RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)]
            : null;
        dispatch({
          type: "fail",
          localId: next.localId,
          retryAt,
          error: error?.message || "Upload failed. Tap to retry.",
        });
      })
      .finally(() => {
        processingRef.current = false;
        if (mountedRef.current) bumpTick();
      });
  }, [items, tick]);

  const enqueue = useCallback((asset) => {
    if (!projectId || !asset?.uri) return null;
    const localId = makeLocalId();
    const capturedAt = new Date(asset.creationTime || Date.now()).toISOString();
    dispatch({
      type: "enqueue",
      item: {
        localId,
        projectId,
        projectKind,
        asset,
        kind: String(asset.mimeType || "").startsWith("video/") ? "video" : "image",
        capturedAt,
        status: "queued",
        attempts: 0,
        retryAt: null,
        remote: null,
        error: null,
      },
    });
    return localId;
  }, [projectId, projectKind]);

  const retry = useCallback((localId) => dispatch({ type: "retry", localId }), []);
  const retryAll = useCallback(() => dispatch({ type: "retry_all" }), []);
  const discard = useCallback((localId) => dispatch({ type: "discard", localId }), []);
  const clearCompleted = useCallback(() => dispatch({ type: "clear_completed" }), []);

  const counts = useMemo(() => {
    const queued = items.filter((item) => item.status === "queued").length;
    const uploading = items.filter((item) => item.status === "uploading").length;
    const failed = items.filter((item) => item.status === "failed").length;
    const uploaded = items.filter((item) => item.status === "uploaded").length;
    return {
      queued,
      uploading,
      failed,
      uploaded,
      total: queued + uploading + failed,
    };
  }, [items]);

  return { items, counts, enqueue, retry, retryAll, discard, clearCompleted };
}

export { queueReducer };
