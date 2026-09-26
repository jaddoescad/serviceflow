import { Zip, ZipPassThrough } from "fflate";

export type ArchiveFile = {
  name: string;
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
};
export const MAX_ARCHIVE_BYTES = 3_500_000_000;

export function archiveFilename(
  name: string | null,
  id: string,
  extension: string,
): string {
  const safe = (name ?? "")
    .replace(/[\\/\x00-\x1f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 160);
  return `${id}-${safe || `media.${extension}`}`;
}

/** Pull one source chunk at a time; downstream backpressure bounds memory usage. */
export function mediaZipStream(
  files: ArchiveFile[],
): ReadableStream<Uint8Array> {
  const abort = new AbortController();
  async function* chunks() {
    const output: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      output.push(chunk);
    });
    let bytes = 0;
    try {
      for (const source of files) {
        abort.signal.throwIfAborted();
        const reader = (await source.open(abort.signal)).getReader();
        const file = new ZipPassThrough(source.name);
        zip.add(file);
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_ARCHIVE_BYTES)
              throw new Error("Selection exceeds the download size limit.");
            file.push(value);
            while (output.length) yield output.shift()!;
          }
          file.push(new Uint8Array(), true);
          while (output.length) yield output.shift()!;
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      zip.end();
      while (output.length) yield output.shift()!;
    } finally {
      zip.terminate();
      abort.abort();
    }
  }
  const iterator = chunks();
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      abort.abort();
      await iterator.return(undefined);
    },
  });
}
