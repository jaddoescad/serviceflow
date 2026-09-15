/** Bound transfers across every project opened in this browser tab. */
export function createUploadSlots(limit = 2) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    acquire(): Promise<() => void> {
      return new Promise(resolve => {
        const start = () => {
          active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active--;
            waiting.shift()?.();
          });
        };
        if (active < limit) start(); else waiting.push(start);
      });
    },
  };
}
export const projectUploadSlots = createUploadSlots();
