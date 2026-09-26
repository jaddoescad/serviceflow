/** Bound transfers across every project opened in this browser tab. */
export function createUploadSlots(limit = 2) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    acquire(signal?: AbortSignal): Promise<() => void> {
      return new Promise((resolve, reject) => {
        const abort = () => {
          const index = waiting.indexOf(start);
          if (index >= 0) waiting.splice(index, 1);
          reject(new DOMException("Upload cancelled", "AbortError"));
        };
        const start = () => {
          signal?.removeEventListener("abort", abort);
          active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active--;
            waiting.shift()?.();
          });
        };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener("abort", abort, { once: true });
        if (active < limit) start(); else waiting.push(start);
      });
    },
  };
}
export const projectUploadSlots = createUploadSlots();
